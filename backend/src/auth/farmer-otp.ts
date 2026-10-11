/**
 * A farmer signs in on the web with their phone and a one-time code, sent on WhatsApp (an
 * authentication template), or shown on screen for a demo farmer's phone (demo/phones.ts). There is no "register" or "log in"
 * choice: every farmer types their number and gets a code. A right code ends in the same 7-day
 * phone session as a login link (mintFarmerSession), and says whether Vaari knows the phone: a new
 * farmer then gives their name and consent (POST /farmer/account, createFarmerAccount below).
 *
 *   code        six digits, 10 minutes, 5 tries; only an HMAC of it is stored (keyed by
 *               SLOT_TOKEN_SECRET and the phone), and a right code is deleted in a conditional
 *               write, so it works once
 *   sending     a new code at most every 30 seconds per phone, and 5 an hour (each one replaces
 *               the last), so nobody can flood a phone or guess across many codes
 *   bookings    a phone a helper booked for is known at once: its account is made from that
 *               booking (name and the consent the helper recorded), never a second record
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { Config } from "../config";
import { isDemoFarmerPhone } from "../demo/phones";
import { logger } from "../logger";
import type { FarmerOtpSent, farmerOtpRequestSchema } from "../shared";
import type { FarmerAccountRecord, VaariStore } from "../store/types";
import { maskPhone } from "../whatsapp/phone";
import type { WhatsAppSender } from "../whatsapp/sender";
import { PhoneRateLimiter } from "../whatsapp/worker";
import { mintFarmerSession } from "./farmer-session";

export const OTP_SECONDS = 10 * 60;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_CODES_PER_PHONE_PER_HOUR = 5;

export type OtpDeps = { config: Config; store: VaariStore; sender: WhatsAppSender };

/** Why a request or a code was refused: an HTTP status and a code the web turns into words. */
export type OtpRefusal = { status: number; error: string; retryInSeconds?: number; attemptsLeft?: number };

const codeHash = (config: Config, phone: string, code: string) => createHmac("sha256", config.SLOT_TOKEN_SECRET).update(`farmer-otp:${phone}:${code}`).digest("base64url");

const sameHash = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

/** `deps` is read on every call: a demo reset swaps the store. */
export function createFarmerOtp(deps: () => OtpDeps) {
  const hourly = new PhoneRateLimiter(OTP_CODES_PER_PHONE_PER_HOUR);

  async function request(input: z.output<typeof farmerOtpRequestSchema>, now: Date = new Date()): Promise<FarmerOtpSent | OtpRefusal> {
    const { config, store, sender } = deps();
    const { phone } = input;
    // A demo farmer's code is shown on screen; every real farmer's goes to WhatsApp (or nowhere).
    const delivery = isDemoFarmerPhone(config, phone) ? "demo" : config.FARMER_OTP_DELIVERY;
    if (delivery === "off") return { status: 503, error: "OTP_OFF" };

    const previous = await store.getOtpChallenge(phone);
    if (previous) {
      const waited = (now.getTime() - Date.parse(previous.sentAt)) / 1000;
      if (waited < OTP_RESEND_SECONDS) return { status: 429, error: "RESEND_TOO_SOON", retryInSeconds: Math.ceil(OTP_RESEND_SECONDS - waited) };
    }
    if (!hourly.allow(phone, now.getTime())) return { status: 429, error: "TOO_MANY_CODES", retryInSeconds: 3_600 };

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const hash = codeHash(config, phone, code);
    await store.putOtpChallenge({
      phone,
      codeHash: hash,
      language: input.language,
      sentAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OTP_SECONDS * 1000).toISOString(),
      attempts: 0,
    });
    const sent: FarmerOtpSent = { channel: delivery, expiresInSeconds: OTP_SECONDS, resendInSeconds: OTP_RESEND_SECONDS, demoCode: null };
    if (delivery === "demo") return { ...sent, demoCode: code };
    try {
      await sender.authCode(phone, config.WHATSAPP_TEMPLATE_OTP, input.language, code);
    } catch {
      // Never leave a code nobody received; the farmer can ask again at once.
      await store.deleteOtpChallenge(phone, hash);
      logger.warn({ phone: maskPhone(phone) }, "farmer sign-in code not sent");
      return { status: 503, error: "OTP_SEND_FAILED" };
    }
    return sent;
  }

  async function verify(phone: string, code: string, now: Date = new Date()): Promise<{ sessionToken: string; expiresIn: number; registered: boolean } | OtpRefusal> {
    const { config, store } = deps();
    const challenge = await store.getOtpChallenge(phone);
    if (!challenge || Date.parse(challenge.expiresAt) <= now.getTime()) return { status: 401, error: "CODE_EXPIRED" };
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { status: 401, error: "CODE_LOCKED" };
    // Count the try first, in a conditional write: two tries at once cannot share one count.
    if (!(await store.countOtpAttempt(phone, challenge.attempts))) return { status: 401, error: "CODE_WRONG", attemptsLeft: OTP_MAX_ATTEMPTS - challenge.attempts - 1 };
    if (!sameHash(codeHash(config, phone, code), challenge.codeHash)) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - challenge.attempts - 1;
      return attemptsLeft > 0 ? { status: 401, error: "CODE_WRONG", attemptsLeft } : { status: 401, error: "CODE_LOCKED" };
    }
    if (!(await store.deleteOtpChallenge(phone, challenge.codeHash))) return { status: 401, error: "CODE_EXPIRED" };
    const account = await accountFromBookings(store, phone, challenge.language, now);
    return { ...(await mintFarmerSession(config, phone)), registered: account !== null };
  }

  return { request, verify };
}

export type FarmerOtp = ReturnType<typeof createFarmerOtp>;

/**
 * The account of a phone that has one, or of a phone a helper booked for (made on first use, from
 * the newest booking: its name and the consent the helper recorded); null for a phone Vaari has
 * never seen. Used after a right code, and when a farmer who came in by a login link books a field.
 */
export async function accountFromBookings(store: VaariStore, phone: string, language: FarmerAccountRecord["language"], now: Date = new Date()): Promise<FarmerAccountRecord | null> {
  const existing = await store.getFarmerAccount(phone);
  if (existing) return existing;
  const fields = await store.listFieldsByPhone(phone);
  const newest = fields[fields.length - 1];
  if (!newest) return null;
  const at = now.toISOString();
  return store.createFarmerAccount({
    phone,
    farmerId: newest.farmerId,
    name: newest.farmerName,
    language,
    consentAt: newest.consentAt ?? at,
    consentBy: newest.consentBy ?? "farmer",
    createdAt: at,
  });
}

/**
 * A new farmer's own account, after their code proved the phone: the name the operator sees and
 * their consent to messages about their bookings. An existing account (theirs, or one made from a
 * helper's booking) is returned as it is: never renamed, never a second record.
 */
export async function createFarmerAccount(store: VaariStore, phone: string, name: string, language: FarmerAccountRecord["language"], now: Date = new Date()): Promise<{ account: FarmerAccountRecord; created: boolean }> {
  const existing = await accountFromBookings(store, phone, language, now);
  if (existing) return { account: existing, created: false };
  const at = now.toISOString();
  const farmerId = `farmer-${randomUUID().slice(0, 8)}`;
  // A conditional write: if another request made the account first, theirs is kept and returned.
  const account = await store.createFarmerAccount({ phone, farmerId, name, language, consentAt: at, consentBy: "farmer", createdAt: at });
  const created = account.farmerId === farmerId;
  if (created) await store.putFarmer({ id: farmerId, name, phone, language, languageChosen: true, facilitatorId: null });
  return { account, created };
}

export const isRefusal = (value: object): value is OtpRefusal => "error" in value && "status" in value;
