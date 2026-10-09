/**
 * The farmer's tools on WhatsApp, bound on the server to the sender's phone (a FarmerPhone
 * principal). No tool takes a phone number, farmer id or field id: a field is chosen by `fieldRef`,
 * its position (1, 2, ...) in THIS farmer's own list, resolved here. Every tool asks Cedar before it
 * reads or drafts anything. The model and the menu buttons call the same tools, so both say exactly
 * what the store and the engine say.
 *
 * cannot_wait_longer only drafts: the change happens when the farmer taps Confirm (worker.ts).
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
import { buildOneFarmerField } from "../domain/views";
import { explainField } from "../domain/why";
import type { FieldRecord, VaariStore } from "../store/types";

export const DRAFT_MINUTES = 15;

export type FarmerToolDeps = { config: Config; store: VaariStore; planner: Planner; engine: EngineClient };

export type ToolCall = { tool: string; input: Record<string, unknown>; output: Record<string, unknown> };

/** What the worker does after the turn (never the model): ask for the Confirm tap, send the page link. */
export type PendingAction = { kind: "confirm"; draftId: string; newLastDay: string } | { kind: "page" };

export type FarmerTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  run(input: unknown): Promise<Record<string, unknown>>;
};

export type FieldEntry = { ref: number; key: string; field: FieldRecord };

const fieldRefSchema = z.number().int().min(1).max(50).describe("The field's number in the farmer's own list (1 is the newest booking), from list_my_fields.");

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
