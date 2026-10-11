/**
 * The parts of Meta's WhatsApp webhook payload Vaari uses: inbound messages (text, button and list
 * replies, voice notes) and delivery statuses of our outbound notices. Everything else is ignored.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
import { z } from "zod";

const replySchema = z.object({ id: z.string(), title: z.string().optional() }).loose();

const messageSchema = z
  .object({
    id: z.string(),
    from: z.string().optional(),
    timestamp: z.string().optional(),
    type: z.string(),
    text: z.object({ body: z.string() }).loose().optional(),
    interactive: z.object({ type: z.string(), button_reply: replySchema.optional(), list_reply: replySchema.optional() }).loose().optional(),
    audio: z.object({ id: z.string() }).loose().optional(),
  })
  .loose();

const statusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string().optional(),
    errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() }).loose()).optional(),
  })
  .loose();

const payloadSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                field: z.string().optional(),
                value: z
                  .object({
                    contacts: z.array(z.object({ wa_id: z.string().optional() }).loose()).optional(),
                    messages: z.array(messageSchema).optional(),
                    statuses: z.array(statusSchema).optional(),
                  })
                  .loose(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
  })
  .loose();

export type InboundMessage = {
  id: string;
  /** Sender as Meta wrote it (`from`, else the contact's `wa_id`); null if absent. */
  sender: string | null;
  kind: "text" | "reply" | "audio" | "other";
  /** What the farmer typed, or the title of the button or list row they tapped (in the language we sent it in). */
  text: string | null;
  /** A button or list reply's id (our own ids, set when we sent the buttons). */
  replyId: string | null;
  mediaId: string | null;
};

export type DeliveryEvent = { messageId: string; status: "sent" | "delivered" | "read" | "failed"; at: string; error: string | null };

const DELIVERY = new Set(["sent", "delivered", "read", "failed"]);
const isoFromSeconds = (seconds: string | undefined) => new Date(seconds && /^\d+$/.test(seconds) ? Number(seconds) * 1000 : Date.now()).toISOString();

/** Throws on a body that is not a WhatsApp webhook payload. */
export function parseWebhook(body: string): { messages: InboundMessage[]; statuses: DeliveryEvent[] } {
  const payload = payloadSchema.parse(JSON.parse(body));
  const messages: InboundMessage[] = [];
  const statuses: DeliveryEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const contactWaId = change.value.contacts?.[0]?.wa_id ?? null;
      for (const message of change.value.messages ?? []) {
        const reply = message.interactive?.button_reply ?? message.interactive?.list_reply ?? null;
        messages.push({
          id: message.id,
          sender: message.from ?? contactWaId,
          kind: reply ? "reply" : message.type === "text" ? "text" : message.type === "audio" ? "audio" : "other",
          text: message.text?.body ?? reply?.title ?? null,
          replyId: reply?.id ?? null,
          mediaId: message.audio?.id ?? null,
        });
      }
      for (const status of change.value.statuses ?? []) {
        if (!DELIVERY.has(status.status)) continue;
        const error = status.errors?.[0];
        statuses.push({
          messageId: status.id,
          status: status.status as DeliveryEvent["status"],
          at: isoFromSeconds(status.timestamp),
          error: error ? `${error.code ?? ""} ${error.title ?? ""}`.trim() : null,
        });
      }
    }
  }
  return { messages, statuses };
}
