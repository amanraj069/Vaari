/**
 * Helpers for the WhatsApp tests: webhook bodies shaped like Meta's, signed posts, a runtime with a
 * recording sender and an adjustable clock, and a scripted stand-in for the model (no Bedrock call).
 * Test numbers are from Ofcom's range reserved for fiction (+44 7700 900xxx).
 */
import request from "supertest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import type { Config } from "../src/config";
import type { AgentRunner } from "../src/whatsapp/agent";
import { MemoryQueue } from "../src/whatsapp/queue";
import { RecordingSender } from "../src/whatsapp/sender";
import { signatureFor } from "../src/whatsapp/signature";
import type { FarmerTool } from "../src/whatsapp/tools";

export const APP_SECRET = "test-app-secret";
export const VERIFY_TOKEN = "test-verify-token";

let messageCount = 0;
export const nextMessageId = () => `wamid.in-${Date.now()}-${++messageCount}`;

type Inbound = { id?: string; from?: string | null; text?: string; button?: string; listRow?: string; audio?: boolean };

/** One inbound message in Meta's webhook shape (`from` without "+", as Meta sends it). */
export function messageBody(message: Inbound): string {
  const id = message.id ?? nextMessageId();
  const from = message.from === undefined ? "447700900017" : message.from;
  const content = message.button
    ? { type: "interactive", interactive: { type: "button_reply", button_reply: { id: message.button, title: "x" } } }
    : message.listRow
      ? { type: "interactive", interactive: { type: "list_reply", list_reply: { id: message.listRow, title: "x" } } }
      : message.audio
        ? { type: "audio", audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true } }
        : { type: "text", text: { body: message.text ?? "hello" } };
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "PHONE-NUMBER-ID" },
              contacts: from ? [{ profile: { name: "Farmer" }, wa_id: from }] : [],
              messages: [{ ...(from ? { from } : {}), id, timestamp: String(Math.floor(Date.now() / 1000)), ...content }],
            },
          },
        ],
      },
    ],
  });
}

export function statusBody(messageId: string, status: "sent" | "delivered" | "read" | "failed", seconds: number): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA-ID", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [{ id: messageId, status, timestamp: String(seconds), recipient_id: "447700900017" }] } }] }],
  });
}

/** A scripted model: runs the given steps against the tools, then returns its reply text. */
export class ScriptedRunner implements AgentRunner {
  calls = 0;
  constructor(private readonly script: (tools: (name: string) => FarmerTool) => Promise<string>) {}
  async run({ tools }: { tools: FarmerTool[] }) {
    this.calls += 1;
    return this.script((name) => tools.find((item) => item.name === name)!);
  }
}

export async function whatsappRuntime(options: { config?: Partial<Config>; runner?: AgentRunner | null } = {}) {
  const sender = new RecordingSender();
  const queue = new MemoryQueue();
  const clock = { now: new Date() };
  const runtime = await buildRuntime({
    freshDemo: true,
    config: { WHATSAPP_ENABLED: true, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN, ...options.config },
    whatsapp: { sender, queue, runner: options.runner ?? null, now: () => clock.now },
  });
  const app = createApp(runtime.dependencies);
  /** Posts a body to the webhook, signed like Meta, and waits for the worker to finish. */
  const deliver = async (body: string) => {
    await request(app).post("/whatsapp/webhook").set("content-type", "application/json").set("x-hub-signature-256", signatureFor(body, APP_SECRET)).send(body).expect(200);
    await queue.drain();
  };
  return { runtime, app, sender, queue, clock, deliver };
}
