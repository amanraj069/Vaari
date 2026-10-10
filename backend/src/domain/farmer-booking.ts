/**
 * A farmer books a field for their own phone: on the web (/farmer/new) or on WhatsApp (after a
 * Confirm tap). One set of checks for both, so the two ways in cannot drift: the phone needs an
 * account (or a helper's booking), a machine centre must serve the village, Cedar must allow it, at
 * most 10 unsown fields per phone, and the harvest-ready date between a week back and a month ahead.
 * The field then waits for the operator's next published plan like any other booking; the
 * operator's board counts it as a new request.
 */
import type { FarmerPhonePrincipal } from "../auth/farmer-session";
import { accountFromBookings } from "../auth/farmer-otp";
import { authorize } from "../authz/cedar";
import type { Locale } from "../shared";
import type { ChcRecord, FarmerAccountRecord, FieldRecord, VaariStore } from "../store/types";
import type { Planner } from "./planner";

export const MAX_OPEN_FIELDS_PER_PHONE = 10;
export const READY_DAYS_BACK = 7;
export const READY_DAYS_AHEAD = 30;

export type FarmerBookingInput = { villageId: string; acres: number; readyDate: string; waitingLimitDays: number };

export type FarmerBookingRefusal =
  | { ok: false; error: "NOT_REGISTERED" | "NO_CENTRE" | "TOO_MANY_FIELDS" | "READY_DATE_OUT_OF_RANGE" }
  | { ok: false; error: "FORBIDDEN"; reasons: string[] };

/** Everything but the write: used before drafting on WhatsApp, and again when the booking is made. */
export async function checkFarmerBooking(
  deps: { store: VaariStore; planner: Planner },
  principal: FarmerPhonePrincipal,
  input: FarmerBookingInput,
  locale: Locale,
): Promise<{ ok: true; chc: ChcRecord; account: FarmerAccountRecord } | FarmerBookingRefusal> {
  const { store, planner } = deps;
  // Registered, or booked for by a helper (then the account comes from that booking).
  const account = await accountFromBookings(store, principal.phone, locale);
  if (!account) return { ok: false, error: "NOT_REGISTERED" };
  const chc = (await store.listChcs()).find((candidate) => candidate.villageIds.includes(input.villageId));
  if (!chc) return { ok: false, error: "NO_CENTRE" };
  const decision = authorize(principal, "RequestField", { type: "Chc", id: chc.id });
  if (!decision.allowed) return { ok: false, error: "FORBIDDEN", reasons: decision.errors };
  const open = (await store.listFieldsByPhone(principal.phone)).filter((field) => field.state !== "done");
  if (open.length >= MAX_OPEN_FIELDS_PER_PHONE) return { ok: false, error: "TOO_MANY_FIELDS" };
  const today = planner.today();
  const readyDay = planner.isoToDay(input.readyDate);
  if (readyDay < today - READY_DAYS_BACK || readyDay > today + READY_DAYS_AHEAD) return { ok: false, error: "READY_DATE_OUT_OF_RANGE" };
  return { ok: true, chc, account };
}

/** Checks, then books: the phone from the session, the name and consent from the farmer's account. */
export async function bookFieldForPhone(
  deps: { store: VaariStore; planner: Planner },
  principal: FarmerPhonePrincipal,
  input: FarmerBookingInput,
  locale: Locale,
): Promise<{ ok: true; chc: ChcRecord; field: FieldRecord } | FarmerBookingRefusal> {
  const checked = await checkFarmerBooking(deps, principal, input, locale);
  if (!checked.ok) return checked;
  const { chc, account } = checked;
  const field = await deps.planner.requestField(
    chc.id,
    { farmerId: account.farmerId, farmerName: account.name, bookedBy: null, farmerPhone: principal.phone, consentAt: account.consentAt, consentBy: account.consentBy },
    input,
  );
  return { ok: true, chc, field };
}
