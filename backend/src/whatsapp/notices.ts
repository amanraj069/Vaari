/**
 * Outbound WhatsApp notices. After the operator approves a plan, each farmer whose promise changed
 * hears about it: a first date (new_date), a window that became a firm date (firm_date), a promise
 * that had to move or break, or a sooner date after "I cannot wait longer" (date_changed). Each is a
 * utility template (names from env) with two parameters: the date in words and the slot page's own
 * sentence (explain/slot-reasons.ts), in the farmer's language; and, with
 * WHATSAPP_TEMPLATE_SLOT_BUTTON, a "My slot" button that opens the field's signed slot link.
 *
 * Sent only to a field with a phone AND consent, never to a demo farmer's phone (demo/phones.ts);
 * nothing at all unless WHATSAPP_ENABLED. Each send is recorded with its delivery status (updated by
 * status webhooks); only the phone's last 4 digits are kept.
 */
import { randomUUID } from "node:crypto";
import { mintSlotToken } from "../auth/slot-token";
import { isDemoFarmerPhone } from "../demo/phones";
import { buildOneFarmerField } from "../domain/views";
import { logger } from "../logger";
import type { NoticeKind, PlanChanges } from "../store/types";
import { promiseWords } from "./messages";
import { fromWhatsAppNumber, maskPhone } from "./phone";
import type { WhatsAppSender } from "./sender";
import type { FarmerToolDeps } from "./tools";

export type NotifierDeps = FarmerToolDeps & { sender: WhatsAppSender };

export function createNotifier(deps: NotifierDeps) {
  const { config, store, planner, sender } = deps;
  const templates: Record<NoticeKind, string> = {
    new_date: config.WHATSAPP_TEMPLATE_NEW_DATE,
    firm_date: config.WHATSAPP_TEMPLATE_FIRM_DATE,
    date_changed: config.WHATSAPP_TEMPLATE_DATE_CHANGED,
  };
  const running = new Set<Promise<void>>();

  /** Sends one notice; returns what happened, counted in the "whatsapp notices" summary line. */
  async function notify(chcId: string, fieldId: string, kind: NoticeKind): Promise<"sent" | "failed" | "no phone or consent" | "demo account" | "no template"> {
    const field = await store.getField(chcId, fieldId);
    if (!field?.farmerPhone || !field.consentAt) return "no phone or consent"; // never contacted
    const phone = fromWhatsAppNumber(field.farmerPhone);
    if (!phone) return "no phone or consent";
    // A demo farmer's phone is a demo account anyone may use: never messaged.
    if (isDemoFarmerPhone(config, phone)) return "demo account";
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
    /** After an approval. Runs in the background (approval never waits on WhatsApp); idle() waits for it. */
    planPublished(chcId: string, changes: PlanChanges) {
      if (!config.WHATSAPP_ENABLED) return;
      const work = run(chcId, changes)
        .catch((error: unknown) => logger.error({ chcId, err: error }, "whatsapp notices failed"))
        .finally(() => running.delete(work));
      running.add(work);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
