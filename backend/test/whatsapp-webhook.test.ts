/**
 * The webhook: Meta's verification handshake, and X-Hub-Signature-256 checked against the RAW body.
 * A valid POST is queued and answered 200 with no other work in the request; anything else is 401.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import type { WebhookQueue } from "../src/whatsapp/queue";
import { RecordingSender } from "../src/whatsapp/sender";
import { signatureFor, validSignature } from "../src/whatsapp/signature";
import { APP_SECRET, VERIFY_TOKEN, messageBody } from "./whatsapp-helpers";

/** A queue that only remembers: proves the request itself does nothing but enqueue. */
class HoldingQueue implements WebhookQueue {
  readonly bodies: string[] = [];
  async send(body: string) {
    this.bodies.push(body);
  }
}

let app: ReturnType<typeof createApp>;
let disabled: ReturnType<typeof createApp>;
const queue = new HoldingQueue();
const sender = new RecordingSender();

beforeAll(async () => {
  const runtime = await buildRuntime({
    freshDemo: true,
    config: { WHATSAPP_ENABLED: true, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN },
    whatsapp: { queue, sender, runner: null },
  });
  app = createApp(runtime.dependencies);
  disabled = createApp({ ...runtime.dependencies, config: { ...runtime.dependencies.config, WHATSAPP_ENABLED: false } });
});

const post = (body: string, signature?: string) => {
  const call = request(app).post("/whatsapp/webhook").set("content-type", "application/json");
  return (signature === undefined ? call : call.set("x-hub-signature-256", signature)).send(body);
};

describe("GET /whatsapp/webhook (Meta's verification)", () => {
  it("echoes the challenge for the right verify token, and refuses anything else", async () => {
    const ok = await request(app).get("/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" }).expect(200);
    expect(ok.text).toBe("1158201444");
    await request(app).get("/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" }).expect(403);
    await request(app).get("/whatsapp/webhook").query({ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" }).expect(403);
    await request(app).get("/whatsapp/webhook").expect(403);
  });
});

describe("POST /whatsapp/webhook (signed by Meta)", () => {
  it("accepts a valid signature: queues the raw body and answers 200, doing nothing else", async () => {
    const body = messageBody({ text: "when is my machine coming?" });
    await post(body, signatureFor(body, APP_SECRET)).expect(200);
    expect(queue.bodies.at(-1)).toBe(body);
    // No reply was sent during the request: the worker does that, from the queue.
    expect(sender.sent).toHaveLength(0);
  });

  it("rejects a wrong, missing or malformed signature, and a body changed after signing, with 401", async () => {
    const body = messageBody({ text: "hello" });
    const before = queue.bodies.length;
    await post(body, signatureFor(body, "another-secret")).expect(401);
    await post(body).expect(401);
    await post(body, "sha256=not-hex").expect(401);
    await post(body, signatureFor(body, APP_SECRET).replace("sha256=", "sha1=")).expect(401);
    await post(body.replace("hello", "hellO"), signatureFor(body, APP_SECRET)).expect(401);
    expect(queue.bodies.length).toBe(before);
  });

  it("checks the bytes as received: re-serialised JSON does not pass", async () => {
    const body = messageBody({ text: "hello" });
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    await post(reformatted, signatureFor(body, APP_SECRET)).expect(401);
    expect(validSignature(Buffer.from(body), signatureFor(body, APP_SECRET), "")).toBe(false); // no secret: nothing is valid
  });

  it("is off (404) unless WHATSAPP_ENABLED", async () => {
    const body = messageBody({ text: "hello" });
    await request(disabled).post("/whatsapp/webhook").set("x-hub-signature-256", signatureFor(body, APP_SECRET)).send(body).expect(404);
    await request(disabled).get("/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" }).expect(404);
  });
});
