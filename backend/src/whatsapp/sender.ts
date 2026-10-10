/**
 * Messages to farmers through the WhatsApp Cloud API (Graph API). Free text and interactive messages
 * are allowed inside the 24-hour window that a farmer's own message opens; outside it, only approved
 * templates (our notices). Lengths are clipped to Meta's limits: body 1024, button title 20, list
 * button 20, row title 24, row description 72, 3 buttons, 10 rows.
 * Media (voice notes): a farmer's note is looked up by its media id and downloaded with the same
 * token (its URL lives 5 minutes); a spoken reply is uploaded first, then sent by its new media id.
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
  /** A voice note: media uploaded with uploadMedia, OGG with the Opus codec, mono (Meta's rule for voice). */
  voice(to: string, mediaId: string): Promise<string>;
  /** Uploads a file to WhatsApp and returns its media id. */
  uploadMedia(bytes: Uint8Array, mimeType: string): Promise<string>;
  /** A farmer's media (their voice note); refused, without downloading, above `maxBytes`. */
  downloadMedia(mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }>;
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

type GraphError = { code?: number; message?: string; error_data?: { details?: string }; fbtrace_id?: string };

/**
 * Meta's code, message and details say what to fix (131030: recipient not in the test number's
 * allowed list; 190: token expired; 131047: outside the 24-hour window). They never contain the
 * token or the recipient.
 */
const graphProblem = (error: GraphError | undefined, status: number) =>
  `${[error?.code ?? status, error?.message, error?.error_data?.details].filter(Boolean).join(" ")}${error?.fbtrace_id ? ` (fbtrace_id ${error.fbtrace_id})` : ""}`;

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
    const body = (await response.json().catch(() => null)) as { messages?: { id: string }[]; error?: GraphError } | null;
    if (!response.ok || !body?.messages?.[0]?.id) throw new WhatsAppSendError(`WhatsApp send failed: ${graphProblem(body?.error, response.status)}`, response.status);
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

  voice(to: string, mediaId: string) {
    return this.post(to, { type: "audio", audio: { id: mediaId, voice: true } });
  }

  async uploadMedia(bytes: Uint8Array, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    // A copy on a plain ArrayBuffer: Blob does not take a view that might sit on shared memory.
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), "reply.ogg");
    const response = await fetch(`https://graph.facebook.com/${this.config.WHATSAPP_GRAPH_VERSION}/${this.config.WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.WHATSAPP_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; error?: GraphError } | null;
    if (!response.ok || !body?.id) throw new WhatsAppSendError(`WhatsApp media upload failed: ${graphProblem(body?.error, response.status)}`, response.status);
    return body.id;
  }

  async downloadMedia(mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const authorization = { authorization: `Bearer ${this.config.WHATSAPP_TOKEN}` };
    const lookup = await fetch(`https://graph.facebook.com/${this.config.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, { headers: authorization, signal: AbortSignal.timeout(15_000) });
    const media = (await lookup.json().catch(() => null)) as { url?: string; mime_type?: string; file_size?: number; error?: GraphError } | null;
    if (!lookup.ok || !media?.url) throw new WhatsAppSendError(`WhatsApp media lookup failed: ${graphProblem(media?.error, lookup.status)}`, lookup.status);
    if ((media.file_size ?? 0) > maxBytes) throw new MediaTooLargeError(media.file_size ?? 0, maxBytes);
    // The token goes only to an HTTPS address Meta just gave us.
    if (new URL(media.url).protocol !== "https:") throw new WhatsAppSendError("WhatsApp media URL is not HTTPS", 502);
    const file = await fetch(media.url, { headers: authorization, signal: AbortSignal.timeout(15_000) });
    if (!file.ok) throw new WhatsAppSendError(`WhatsApp media download failed: ${file.status}`, file.status);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new MediaTooLargeError(bytes.byteLength, maxBytes);
    return { bytes, mimeType: media.mime_type ?? "audio/ogg" };
  }
}

export class MediaTooLargeError extends Error {
  constructor(size: number, limit: number) {
    super(`media is ${size} bytes, over the ${limit}-byte limit`);
    this.name = "MediaTooLargeError";
  }
}

/** Records instead of sending: tests, and dev with WHATSAPP_ENABLED=false. */
export type SentMessage =
  | { type: "text"; to: string; body: string; previewUrl: boolean; id: string }
  | { type: "buttons"; to: string; body: string; buttons: Button[]; id: string }
  | { type: "list"; to: string; body: string; buttonLabel: string; rows: ListRow[]; id: string }
  | { type: "template"; to: string; name: string; language: string; parameters: string[]; urlButtonSuffix: string | null; id: string }
  | { type: "authCode"; to: string; name: string; language: string; code: string; id: string }
  | { type: "voice"; to: string; mediaId: string; id: string };

type WithoutId<Message> = Message extends unknown ? Omit<Message, "id"> : never;

export class RecordingSender implements WhatsAppSender {
  readonly sent: SentMessage[] = [];
  private count = 0;
  /** Set to make every send fail (tests of failure handling). */
  failing = false;
  /** A farmer's media by id, for downloadMedia (tests put voice notes here). */
  readonly media = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  /** What uploadMedia received, by the media id it returned. */
  readonly uploaded = new Map<string, { bytes: Uint8Array; mimeType: string }>();

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
  async voice(to: string, mediaId: string) {
    return this.record({ type: "voice", to, mediaId });
  }
  async uploadMedia(bytes: Uint8Array, mimeType: string) {
    if (this.failing) throw new WhatsAppSendError("WhatsApp media upload failed: test", 500);
    const mediaId = `media.test-${this.uploaded.size + 1}`;
    this.uploaded.set(mediaId, { bytes, mimeType });
    return mediaId;
  }
  async downloadMedia(mediaId: string, maxBytes: number) {
    const media = this.media.get(mediaId);
    if (!media) throw new WhatsAppSendError("WhatsApp media lookup failed: test, no such media", 404);
    if (media.bytes.byteLength > maxBytes) throw new MediaTooLargeError(media.bytes.byteLength, maxBytes);
    return media;
  }
}
