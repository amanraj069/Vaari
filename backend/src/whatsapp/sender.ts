/**
 * Messages to farmers through the WhatsApp Cloud API (Graph API). Free text and interactive messages
 * are allowed inside the 24-hour window that a farmer's own message opens; outside it, only approved
 * templates (our notices). Lengths are clipped to Meta's limits: body 1024, button title 20, list
 * button 20, row title 24, row description 72, 3 buttons, 10 rows.
 */
import type { Config } from "../config";
import { logger } from "../logger";
import { maskPhone, toWhatsAppNumber } from "./phone";

export type Button = { id: string; title: string };
export type ListRow = { id: string; title: string; description?: string };

export interface WhatsAppSender {
  /** Each returns WhatsApp's message id (wamid). */
  text(to: string, body: string, options?: { previewUrl?: boolean }): Promise<string>;
  buttons(to: string, body: string, buttons: Button[]): Promise<string>;
  list(to: string, body: string, buttonLabel: string, rows: ListRow[]): Promise<string>;
  /** `urlButtonSuffix` fills the {{1}} of the template's first button, a dynamic "Visit website" URL. */
  template(to: string, name: string, language: string, parameters: string[], urlButtonSuffix?: string): Promise<string>;
  /** An authentication template: the code in the body and in its copy-code button. */
  authCode(to: string, name: string, language: string, code: string): Promise<string>;
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

export class GraphSender implements WhatsAppSender {
  constructor(private readonly config: Config) {}

  private async post(to: string, message: Record<string, unknown>): Promise<string> {
    const started = Date.now();
    const response = await fetch(`https://graph.facebook.com/${this.config.WHATSAPP_GRAPH_VERSION}/${this.config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toWhatsAppNumber(to), ...message }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      messages?: { id: string }[];
      error?: { code?: number; message?: string; error_data?: { details?: string }; fbtrace_id?: string };
    } | null;
    if (!response.ok || !body?.messages?.[0]?.id) {
      // Meta's code, message and details say what to fix (131030: recipient not in the test
      // number's allowed list; 190: token expired; 131047: outside the 24-hour window). They never
      // contain the token or the recipient.
      const error = body?.error;
      const why = [error?.code ?? response.status, error?.message, error?.error_data?.details].filter(Boolean).join(" ");
      throw new WhatsAppSendError(`WhatsApp send failed: ${why}${error?.fbtrace_id ? ` (fbtrace_id ${error.fbtrace_id})` : ""}`, response.status);
    }
    logger.info({ to: maskPhone(to), type: message.type, messageId: body.messages[0].id, ms: Date.now() - started }, "whatsapp sent");
    return body.messages[0].id;
  }

  text(to: string, body: string, options: { previewUrl?: boolean } = {}) {
    return this.post(to, { type: "text", text: { body: clip(body, 4096), preview_url: options.previewUrl ?? false } });
  }

  buttons(to: string, body: string, buttons: Button[]) {
    return this.post(to, {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: clip(body, 1024) },
        action: { buttons: buttons.slice(0, 3).map((button) => ({ type: "reply", reply: { id: button.id, title: clip(button.title, 20) } })) },
      },
    });
  }

  list(to: string, body: string, buttonLabel: string, rows: ListRow[]) {
    return this.post(to, {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: clip(body, 1024) },
        action: {
          button: clip(buttonLabel, 20),
          sections: [{ rows: rows.slice(0, 10).map((row) => ({ id: row.id, title: clip(row.title, 24), ...(row.description ? { description: clip(row.description, 72) } : {}) })) }],
        },
      },
    });
  }

  template(to: string, name: string, language: string, parameters: string[], urlButtonSuffix?: string) {
    const components: Record<string, unknown>[] = [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text: clip(text, 1024) })) }];
    if (urlButtonSuffix) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlButtonSuffix }] });
    return this.post(to, { type: "template", template: { name, language: { code: language }, components } });
  }

  authCode(to: string, name: string, language: string, code: string) {
    return this.post(to, {
      type: "template",
      template: {
        name,
        language: { code: language },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    });
  }
}

/** Records instead of sending: tests, and dev with WHATSAPP_ENABLED=false. */
export type SentMessage =
  | { type: "text"; to: string; body: string; previewUrl: boolean; id: string }
  | { type: "buttons"; to: string; body: string; buttons: Button[]; id: string }
  | { type: "list"; to: string; body: string; buttonLabel: string; rows: ListRow[]; id: string }
  | { type: "template"; to: string; name: string; language: string; parameters: string[]; urlButtonSuffix: string | null; id: string }
  | { type: "authCode"; to: string; name: string; language: string; code: string; id: string };

type WithoutId<Message> = Message extends unknown ? Omit<Message, "id"> : never;

export class RecordingSender implements WhatsAppSender {
  readonly sent: SentMessage[] = [];
  private count = 0;
  /** Set to make every send fail (tests of failure handling). */
  failing = false;

  private record(message: WithoutId<SentMessage>): string {
    if (this.failing) throw new WhatsAppSendError("WhatsApp send failed: test", 500);
    const id = `wamid.test-${++this.count}`;
    this.sent.push({ ...message, id } as SentMessage);
    return id;
  }
  async text(to: string, body: string, options: { previewUrl?: boolean } = {}) {
    return this.record({ type: "text", to, body, previewUrl: options.previewUrl ?? false });
  }
  async buttons(to: string, body: string, buttons: Button[]) {
    return this.record({ type: "buttons", to, body, buttons });
  }
  async list(to: string, body: string, buttonLabel: string, rows: ListRow[]) {
    return this.record({ type: "list", to, body, buttonLabel, rows });
  }
  async template(to: string, name: string, language: string, parameters: string[], urlButtonSuffix?: string) {
    return this.record({ type: "template", to, name, language, parameters, urlButtonSuffix: urlButtonSuffix ?? null });
  }
  async authCode(to: string, name: string, language: string, code: string) {
    return this.record({ type: "authCode", to, name, language, code });
  }
}
