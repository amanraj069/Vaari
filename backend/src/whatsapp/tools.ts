/**
 * The farmer's tools on WhatsApp, bound on the server to the sender's phone (a FarmerPhone
 * principal). No tool takes a phone number, farmer id or field id: a field is chosen by `fieldRef`,
 * its position (1, 2, ...) in THIS farmer's own list, resolved here. Every tool asks Cedar before it
 * reads or drafts anything. The model and the menu buttons call the same tools, so both say exactly
 * what the store and the engine say.
 *
 * cannot_wait_longer and book_field only draft: the change happens when the farmer taps Confirm
 * (worker.ts). book_field takes the farmer's own words (a village name, acres, a day and month) and
 * code does the rest: which village and centre, which year, how many days they can wait.
 * send_my_fields_page only asks for the link: the worker mints and sends it, so the URL never passes
 * through the model.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Locale } from "../shared";
import type { Config } from "../config";
import type { FarmerPhonePrincipal } from "../auth/farmer-session";
import { authorize, fieldResource, type Action } from "../authz/cedar";
import type { EngineClient } from "../engine/client";
import type { Planner } from "../domain/planner";
import { checkFarmerBooking } from "../domain/farmer-booking";
import { buildOneFarmerField } from "../domain/views";
import { explainField } from "../domain/why";
import type { FieldRecord, VaariStore, VillageRecord } from "../store/types";

export const DRAFT_MINUTES = 15;

export type FarmerToolDeps = { config: Config; store: VaariStore; planner: Planner; engine: EngineClient };

export type ToolCall = { tool: string; input: Record<string, unknown>; output: Record<string, unknown> };

/** What the worker does after the turn (never the model): ask for the Confirm tap, send the page link. */
export type PendingAction =
  | { kind: "confirm"; draftId: string; newLastDay: string }
  | { kind: "confirmBooking"; draftId: string; booking: BookingDetails }
  | { kind: "page" };

/** What a drafted booking shows the farmer before they tap Confirm. */
export type BookingDetails = { village: string; centre: string; acres: number; readyDate: string; lastDay: string };

export type FarmerTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  run(input: unknown): Promise<Record<string, unknown>>;
};

export type FieldEntry = { ref: number; key: string; field: FieldRecord };

const fieldRefSchema = z.number().int().min(1).max(50).describe("The field's number in the farmer's own list (1 is the newest booking), from list_my_fields.");

const calendarDaySchema = z.object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12) });

/** Village names compared without case, spaces or punctuation (Gurmukhi and Devanagari letters kept). */
const normaliseName = (name: string) => name.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{M}]/gu, "");

/** Edit distance, for a farmer's spelling of a village ("Balyan" for Balian). Names are short. */
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length]!;
}

/** A short fingerprint of a field for our button ids, so a reply to an old list cannot hit a different field. */
const fingerprint = (field: FieldRecord) => createHash("sha256").update(`${field.chcId}/${field.id}`).digest("base64url").slice(0, 6);

export class ToolInputError extends Error {}

/** One conversation turn of one farmer (one phone). */
export class FarmerSession {
  readonly calls: ToolCall[] = [];
  readonly pending: PendingAction[] = [];
  private entries: FieldEntry[] | null = null;

  constructor(
    private readonly deps: FarmerToolDeps,
    readonly principal: FarmerPhonePrincipal,
    readonly locale: Locale,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** This phone's fields that Cedar lets it see, newest booking first, numbered 1, 2, ... */
  async fields(): Promise<FieldEntry[]> {
    if (!this.entries) {
      const fields = (await this.deps.store.listFieldsByPhone(this.principal.phone))
        .filter((field) => authorize(this.principal, "ViewField", fieldResource(field)).allowed)
        .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
      this.entries = fields.map((field, index) => ({ ref: index + 1, key: `${index + 1}.${fingerprint(field)}`, field }));
    }
    return this.entries;
  }

  /** A position in this farmer's list -> their field, checked by Cedar for `action`. */
  async resolve(fieldRef: number, action: Action): Promise<FieldRecord> {
    const entry = (await this.fields()).find((item) => item.ref === fieldRef);
    if (!entry) throw new ToolInputError(`there is no field ${fieldRef} in this farmer's list`);
    if (!authorize(this.principal, action, fieldResource(entry.field)).allowed) throw new ToolInputError("not allowed");
    return entry.field;
  }

  /** Our button ids carry "ref.fingerprint": resolved only if it still names the same field. */
  async resolveKey(key: string): Promise<FieldEntry | null> {
    return (await this.fields()).find((item) => item.key === key) ?? null;
  }

  /** A day and month the farmer named -> that date in this season (October -> the season's year, January -> the next); null if no such day. */
  private seasonDate(day: number, month: number): string | null {
    const seasonStart = this.deps.config.SEASON_START_DATE;
    const startYear = Number(seasonStart.slice(0, 4));
    for (const year of [startYear, startYear + 1]) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCMonth() !== month - 1) return null; // 31 November and the like
      const iso = date.toISOString().slice(0, 10);
      if (iso >= seasonStart) return iso;
    }
    return null;
  }

  private villageName(village: VillageRecord): string {
    return this.locale === "pa" && village.namePa ? village.namePa : village.name;
  }

  /**
   * The village a farmer named, among those a machine centre serves: exact, else the one close
   * spelling. Several villages share a name (data/villages.json has two Balians): the farmer's own
   * village wins, then the one centre; otherwise the farmer is asked, by "village (centre)".
   */
  private async findVillage(named: string | undefined): Promise<{ village: VillageRecord } | { error: string; suggestions: string[] }> {
    const centreOf = new Map<string, string>();
    for (const chc of await this.deps.store.listChcs()) for (const villageId of chc.villageIds) if (!centreOf.has(villageId)) centreOf.set(villageId, chc.name);
    const villages = this.deps.planner.villages().filter((village) => centreOf.has(village.id));
    const own = new Set((await this.fields()).map((entry) => entry.field.villageId));
    const label = (village: VillageRecord) => `${this.villageName(village)} (${centreOf.get(village.id)})`;
    if (!named) {
      // "this village": the farmer's own village, when all their fields are in one.
      const mine = villages.filter((village) => own.has(village.id));
      if (mine.length === 1) return { village: mine[0]! };
      return { error: "which village? ask the farmer", suggestions: mine.map(label) };
    }
    const wanted = normaliseName(named);
    const names = (village: VillageRecord) => [village.name, village.namePa ?? "", `${village.name} ${centreOf.get(village.id)}`].filter(Boolean).map(normaliseName);
    const exact = villages.filter((village) => names(village).includes(wanted));
    const candidates = exact.length > 0 ? exact : villages.filter((village) => names(village).some((name) => editDistance(name, wanted) <= 2 || (wanted.length >= 4 && name.startsWith(wanted))));
    if (candidates.length === 1) return { village: candidates[0]! };
    const mine = candidates.filter((village) => own.has(village.id));
    if (mine.length === 1) return { village: mine[0]! };
    if (candidates.length === 0) return { error: "no machine centre serves a village with that name; ask the farmer which village", suggestions: [] };
    // The same name twice at one centre: one operator either way (rare; the first is taken).
    if (exact.length > 1 && new Set(exact.map((village) => centreOf.get(village.id))).size === 1) return { village: exact[0]! };
    return { error: exact.length > 1 ? "several villages have that name; ask the farmer which machine centre" : "which of these villages? ask the farmer", suggestions: candidates.slice(0, 5).map(label) };
  }

  private record(tool: string, input: Record<string, unknown>, output: Record<string, unknown>) {
    this.calls.push({ tool, input, output });
    return output;
  }

  private async view(field: FieldRecord) {
    return buildOneFarmerField(this.deps.planner, this.deps.store, field, this.locale);
  }

  tools(): FarmerTool[] {
    const define = <Schema extends z.ZodObject>(name: string, description: string, inputSchema: Schema, body: (input: z.output<Schema>) => Promise<Record<string, unknown>>): FarmerTool => ({
      name,
      description,
      inputSchema,
      run: async (raw) => {
        const parsed = inputSchema.safeParse(raw ?? {});
        if (!parsed.success) return this.record(name, (raw ?? {}) as Record<string, unknown>, { error: "invalid input" });
        try {
          return this.record(name, parsed.data as Record<string, unknown>, await body(parsed.data));
        } catch (error) {
          if (error instanceof ToolInputError) return this.record(name, parsed.data as Record<string, unknown>, { error: error.message });
          throw error;
        }
      },
    });

    return [
      define("list_my_fields", "List this farmer's own fields with their machine dates. Call this first when you do not know which field the farmer means.", z.object({}), async () => {
        const fields = [];
        for (const entry of await this.fields()) {
          const view = await this.view(entry.field);
          fields.push({
            fieldRef: entry.ref,
            token: view.token,
            village: view.villageName,
            acres: view.acres,
            status: view.status,
            promise: view.promise,
            lastDayYouCanWait: view.burnDeadlineDate,
          });
        }
        return { fields };
      }),

      define("get_slot", "Where one of this farmer's fields stands: its promised date or window, place in the queue, and one plain sentence.", z.object({ fieldRef: fieldRefSchema }), async ({ fieldRef }) => {
        const view = await this.view(await this.resolve(fieldRef, "ViewField"));
        return {
          fieldRef,
          token: view.token,
          village: view.villageName,
          acres: view.acres,
          status: view.status,
          promise: view.promise,
          queuePosition: view.queuePosition,
          fieldsAhead: view.fieldsAhead,
          machine: view.visit?.machineName ?? null,
          stop: view.visit?.stop ?? null,
          stopsThatDay: view.visit?.stops ?? null,
          lastDayYouCanWait: view.burnDeadlineDate,
          sentence: view.reason.text,
        };
      }),

      define("why_this_day", "Why one of this farmer's fields has its date: the planner's own reasons, as plain sentences.", z.object({ fieldRef: fieldRefSchema }), async ({ fieldRef }) => {
        const field = await this.resolve(fieldRef, "AskWhy");
        const why = await explainField(this.deps, field, this.locale);
        return { fieldRef, earlierPossible: why.earlierPossible, reasons: why.reasons.map((reason) => reason.text) };
      }),

      define(
        "cannot_wait_longer",
        "The farmer cannot wait as long as they said: they can now wait only `days` days after harvest. This only prepares the change; the farmer must tap Confirm before anything changes. Never say it is done.",
        z.object({ fieldRef: fieldRefSchema, days: z.number().int().min(1).max(15).describe("Days after harvest the farmer can still wait (fewer than now).") }),
        async ({ fieldRef, days }) => {
          const field = await this.resolve(fieldRef, "RequestSooner");
          const view = await this.view(field);
          if (field.state === "done") return { fieldRef, error: "this field has already been sown" };
          if (days >= field.waitingLimitDays) return { fieldRef, error: "the new wait must be shorter than now", currentWaitingDays: field.waitingLimitDays };
          const now = this.now();
          const draftId = randomBytes(12).toString("base64url");
          const newLastDay = this.deps.planner.dayToIso(field.readyDay + days);
          await this.deps.store.putWhatsAppDraft({
            draftId,
            phone: this.principal.phone,
            chcId: field.chcId,
            fieldId: field.id,
            waitingLimitDays: days,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + DRAFT_MINUTES * 60_000).toISOString(),
            usedAt: null,
          });
          this.pending.push({ kind: "confirm", draftId, newLastDay });
          return { fieldRef, needsConfirmation: true, currentLastDay: view.burnDeadlineDate, newLastDay, waitingDays: days };
        },
      ),

      define(
        "book_field",
        "Book a new field for this farmer, from their own words. Pass only what the farmer said: the village name, the acres, and either the last day they can wait (day and month) or how many more days they can wait; the harvest day only if they named one (left out means ready now). This only prepares the booking; the farmer must check the details and tap Confirm. Never say it is booked.",
        z.object({
          village: z.string().trim().min(1).max(60).optional().describe("The village name as the farmer wrote it, in any script. Leave out if they did not name one."),
          acres: z.number().positive().max(50).describe("Acres of this field, as the farmer said."),
          lastDayYouCanWait: calendarDaySchema.optional().describe("The last calendar day the farmer can wait for the machine, if they named a date: day of month and month (1-12)."),
          moreDaysYouCanWait: z.number().int().min(1).max(15).optional().describe("How many more days the farmer can wait, if they said it as a number of days and not as a date."),
          harvestReady: calendarDaySchema.optional().describe("The day the paddy harvest is ready, if the farmer named one: day of month and month (1-12)."),
        }),
        async ({ village: named, acres, lastDayYouCanWait, moreDaysYouCanWait, harvestReady }) => {
          const planner = this.deps.planner;
          // A problem goes back with what was understood, so the model's question about the one
          // missing or wrong detail can repeat the rest ("your 4 acres: which village?") and still
          // pass the number check.
          const askAgain = (problem: { error: string; suggestions?: string[] }) => ({ ...problem, understood: { village: named ?? null, acres } });
          const found = await this.findVillage(named);
          if ("error" in found) return askAgain(found);
          const today = planner.today();
          const readyIso = harvestReady ? this.seasonDate(harvestReady.day, harvestReady.month) : planner.dayToIso(today);
          if (!readyIso) return askAgain({ error: "that harvest day does not exist; ask the farmer again" });
          const readyDay = planner.isoToDay(readyIso);
          // A named date wins over a count of days; a count runs from the harvest, or from today once harvested.
          let lastDay: number;
          if (lastDayYouCanWait) {
            const lastIso = this.seasonDate(lastDayYouCanWait.day, lastDayYouCanWait.month);
            if (!lastIso) return askAgain({ error: "that last day does not exist; ask the farmer again" });
            lastDay = planner.isoToDay(lastIso);
          } else if (moreDaysYouCanWait) {
            lastDay = Math.max(readyDay, today) + moreDaysYouCanWait;
          } else {
            return askAgain({ error: "ask the farmer the last day they can wait for the machine" });
          }
          const waitingLimitDays = lastDay - readyDay;
          if (lastDay <= today || waitingLimitDays < 1) return askAgain({ error: "the last day they can wait must be after today and after the harvest; ask the farmer again" });
          if (waitingLimitDays > 15) return askAgain({ error: "Vaari plans waits of at most 15 days after the harvest; ask the farmer again" });
          const input = { villageId: found.village.id, acres, readyDate: readyIso, waitingLimitDays };
          const checked = await checkFarmerBooking(this.deps, this.principal, input, this.locale);
          if (!checked.ok) {
            const problems: Record<typeof checked.error, string> = {
              NOT_REGISTERED: "this number is not registered",
              NO_CENTRE: "no machine centre serves this village",
              FORBIDDEN: "not allowed",
              TOO_MANY_FIELDS: "this farmer already has the most open fields Vaari allows",
              READY_DATE_OUT_OF_RANGE: "the harvest day must be within a week back and a month ahead",
            };
            return askAgain({ error: problems[checked.error] });
          }
          const now = this.now();
          const draftId = randomBytes(12).toString("base64url");
          await this.deps.store.putWhatsAppDraft({
            draftId,
            phone: this.principal.phone,
            chcId: checked.chc.id,
            fieldId: "",
            waitingLimitDays,
            booking: input,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + DRAFT_MINUTES * 60_000).toISOString(),
            usedAt: null,
          });
          const booking: BookingDetails = { village: this.villageName(found.village), centre: checked.chc.name, acres, readyDate: readyIso, lastDay: planner.dayToIso(lastDay) };
          this.pending.push({ kind: "confirmBooking", draftId, booking });
          return { needsConfirmation: true, ...booking, waitingDays: waitingLimitDays };
        },
      ),

      define("send_my_fields_page", "Send the farmer a one-time link to a web page with all their fields. Vaari sends the link itself.", z.object({}), async () => {
        const visible = await this.fields();
        if (visible.length === 0) throw new ToolInputError("no fields");
        this.pending.push({ kind: "page" });
        return { willSend: true, linkValidMinutes: 15 };
      }),
    ];
  }

  tool(name: string): FarmerTool {
    const found = this.tools().find((item) => item.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  }
}
