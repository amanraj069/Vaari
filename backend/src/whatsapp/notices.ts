/**
 * Outbound WhatsApp notices. After the operator approves a plan, each farmer whose promise changed
 * hears about it: a first date (new_date), a window that became a firm date (firm_date), a promise
 * that had to move or break, or a sooner date after "I cannot wait longer" (date_changed). Each is a
 * utility template (names from env) with two parameters: the date in words and the slot page's own
 * sentence (explain/slot-reasons.ts), in the farmer's language.
 *
 * Sent only to a field with a phone AND consent; in DEMO_MODE only to WHATSAPP_ALLOWED_TEST_NUMBERS;
 * nothing at all unless WHATSAPP_ENABLED. Each send is recorded with its delivery status (updated by
 * status webhooks); only the phone's last 4 digits are kept.
 */
import { randomUUID } from "node:crypto";
import { allowedTestNumbers } from "../config";
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

  async function notify(chcId: string, fieldId: string, kind: NoticeKind) {
    const field = await store.getField(chcId, fieldId);
    if (!field?.farmerPhone || !field.consentAt) return; // no phone or no consent: never contacted
    const phone = fromWhatsAppNumber(field.farmerPhone);
    if (!phone) return;
    if (config.DEMO_MODE && !allowedTestNumbers(config, fromWhatsAppNumber).has(phone)) return;
    const template = templates[kind];
    if (!template) {
      logger.warn({ kind }, "whatsapp notice skipped: no template name configured");
      return;
    }
    const language = (await store.getFarmer(field.farmerId))?.language ?? "pa";
    const view = await buildOneFarmerField(planner, store, field, language);
    const sentAt = new Date().toISOString();
    const base = { phoneLast4: phone.slice(-4), kind, chcId, fieldId, sentAt, statusAt: sentAt };
    try {
      const messageId = await sender.template(phone, template, language, [promiseWords(view.promise, language), view.reason.text]);
      await store.putOutboundNotice({ ...base, messageId, status: "accepted", error: null });
    } catch (error) {
      logger.warn({ phone: maskPhone(phone), kind }, "whatsapp notice failed");
      await store.putOutboundNotice({ ...base, messageId: `local-${randomUUID()}`, status: "failed", error: error instanceof Error ? error.message : "send failed" });
    }
  }

  async function run(chcId: string, changes: PlanChanges) {
    const work: [string, NoticeKind][] = [
      ...changes.promised.map((item): [string, NoticeKind] => [item.fieldId, "new_date"]),
      ...changes.firmed.map((item): [string, NoticeKind] => [item.fieldId, "firm_date"]),
      ...changes.broken.map((item): [string, NoticeKind] => [item.fieldId, "date_changed"]),
      ...changes.rePromised.map((item): [string, NoticeKind] => [item.fieldId, "date_changed"]),
    ];
    for (const [fieldId, kind] of work) await notify(chcId, fieldId, kind);
  }

  return {
    /** After an approval. Runs in the background (approval never waits on WhatsApp); idle() waits for it. */
    planPublished(chcId: string, changes: PlanChanges) {
      if (!config.WHATSAPP_ENABLED) return;
      const work = run(chcId, changes)
        .catch((error: unknown) => logger.error({ err: error instanceof Error ? error.message : "unknown" }, "whatsapp notices failed"))
        .finally(() => running.delete(work));
      running.add(work);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
