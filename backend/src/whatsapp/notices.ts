/**
 * Outbound WhatsApp notices. When a helper books a field, its farmer hears that the request is in,
 * with the field's slot link (booked: the new_date template with "no date yet" and the slot page's
 * own "your request is with ..." sentence). After the operator approves a plan, each farmer whose
 * promise changed hears about it: a first date (new_date), a window that became a firm date (firm_date), a promise
 * that had to move or break, or a sooner date after "I cannot wait longer" (date_changed). Each is a
 * utility template (names from env) with two parameters: the date in words and the slot page's own
 * sentence (explain/slot-reasons.ts), in the farmer's language; and, with
 * WHATSAPP_TEMPLATE_SLOT_BUTTON, a "My slot" button that opens the field's signed slot link.
 *
 * Sent only to a field with a phone AND consent, never to a demo farmer's phone (demo/phones.ts)
 * unless that phone is in WHATSAPP_ALLOWED_TEST_NUMBERS; nothing at all unless WHATSAPP_ENABLED. Each send is recorded with its delivery status (updated by
 * status webhooks); only the phone's last 4 digits are kept.
 */
import { randomUUID } from "node:crypto";
import { mintSlotToken } from "../auth/slot-token";
import { isDemoFarmerPhone } from "../demo/phones";
import { buildOneFarmerField } from "../domain/views";
import { logger } from "../logger";
import type { FieldRecord, NoticeKind, PlanChanges } from "../store/types";
import { promiseWords } from "./messages";
import { fromWhatsAppNumber, maskPhone } from "./phone";
import type { WhatsAppSender } from "./sender";
import type { FarmerToolDeps } from "./tools";

export type NotifierDeps = FarmerToolDeps & { sender: WhatsAppSender };

export function createNotifier(deps: NotifierDeps) {
  const { config, store, planner, sender } = deps;
  const templates: Record<NoticeKind, string> = {
    booked: config.WHATSAPP_TEMPLATE_NEW_DATE,
    new_date: config.WHATSAPP_TEMPLATE_NEW_DATE,
    firm_date: config.WHATSAPP_TEMPLATE_FIRM_DATE,
    date_changed: config.WHATSAPP_TEMPLATE_DATE_CHANGED,
  };
  const testNumbers = new Set(
    config.WHATSAPP_ALLOWED_TEST_NUMBERS.split(",")
      .map((item) => fromWhatsAppNumber(item.trim()))
      .filter((item): item is string => item !== null),
  );
  const running = new Set<Promise<void>>();

  /** Work that never holds up the request that started it; idle() waits for all of it (tests). */
  function inBackground(chcId: string, work: Promise<unknown>) {
    const tracked: Promise<void> = work
      .then(() => undefined)
      .catch((error: unknown) => logger.error({ chcId, err: error }, "whatsapp notices failed"))
      .finally(() => running.delete(tracked));
    running.add(tracked);
  }

  /** Sends one notice; returns what happened, counted in the "whatsapp notices" summary line. */
  async function notify(chcId: string, fieldId: string, kind: NoticeKind, known?: FieldRecord): Promise<"sent" | "failed" | "no phone or consent" | "demo account" | "no template"> {
    // A just-booked field is passed in: DynamoDB reads are eventually consistent, so reading it back
    // straight after the write could miss it and skip the notice.
    const field = known ?? (await store.getField(chcId, fieldId));
    if (!field?.farmerPhone || !field.consentAt) return "no phone or consent"; // never contacted
    const phone = fromWhatsAppNumber(field.farmerPhone);
    if (!phone) return "no phone or consent";
    // A demo farmer's phone is a demo account anyone may use: never messaged, unless it is one of
    // the team's own test numbers.
    if (isDemoFarmerPhone(config, phone) && !testNumbers.has(phone)) return "demo account";
    const template = templates[kind];
    if (!template) {
      logger.warn({ kind }, "whatsapp notice skipped: no template name configured");
      return "no template";
    }
    const language = (await store.getFarmer(field.farmerId))?.language ?? "pa";
    const view = await buildOneFarmerField(planner, store, field, language);
    const sentAt = new Date().toISOString();
    const base = { phoneLast4: phone.slice(-4), kind, chcId, fieldId, sentAt, statusAt: sentAt };
    try {
      // The button opens this field's own slot page (the signed link, current version), so the
      // farmer who booked on WhatsApp gets their slot link with the date.
      const slotToken = config.WHATSAPP_TEMPLATE_SLOT_BUTTON ? await mintSlotToken(config, field) : undefined;
      const messageId = await sender.template(phone, template, language, [promiseWords(view.promise, language), view.reason.text], slotToken);
      await store.putOutboundNotice({ ...base, messageId, status: "accepted", error: null });
      return "sent";
    } catch (error) {
      const reason = error instanceof Error ? error.message : "send failed";
      logger.warn({ phone: maskPhone(phone), kind, template, err: reason }, "whatsapp notice failed");
      await store.putOutboundNotice({ ...base, messageId: `local-${randomUUID()}`, status: "failed", error: reason });
      return "failed";
    }
  }

  async function run(chcId: string, changes: PlanChanges) {
    const work: [string, NoticeKind][] = [
      ...changes.promised.map((item): [string, NoticeKind] => [item.fieldId, "new_date"]),
      ...changes.firmed.map((item): [string, NoticeKind] => [item.fieldId, "firm_date"]),
      ...changes.broken.map((item): [string, NoticeKind] => [item.fieldId, "date_changed"]),
      ...changes.rePromised.map((item): [string, NoticeKind] => [item.fieldId, "date_changed"]),
    ];
    const outcomes: Record<string, number> = {};
    for (const [fieldId, kind] of work) {
      const outcome = await notify(chcId, fieldId, kind);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    if (work.length > 0) logger.info({ chcId, notices: work.length, ...outcomes }, "whatsapp notices after plan approval");
  }

  return {
    /** After a helper's booking: "your request is in", with the slot link. In the background. */
    fieldBooked(field: FieldRecord) {
      if (!config.WHATSAPP_ENABLED) return;
      inBackground(
        field.chcId,
        notify(field.chcId, field.id, "booked", field).then((outcome) => logger.info({ chcId: field.chcId, outcome }, "whatsapp notice after booking")),
      );
    },
    /** After an approval. Runs in the background (approval never waits on WhatsApp); idle() waits for it. */
    planPublished(chcId: string, changes: PlanChanges) {
      if (!config.WHATSAPP_ENABLED) return;
      inBackground(chcId, run(chcId, changes));
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
