/**
 * Every webhook call and every refused or failed request leaves one log line that says why, so a
 * webhook that "never arrived" can be told apart from one that arrived and was refused. The lines
 * never carry the message text, a full phone number, a token or the verify token.
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { devLines, logger } from "../src/logger";
import { whatsappSetupProblems } from "../src/whatsapp";
import { signatureFor } from "../src/whatsapp/signature";
import { APP_SECRET, VERIFY_TOKEN, messageBody, statusBody, whatsappRuntime } from "./whatsapp-helpers";

type Runtime = Awaited<ReturnType<typeof whatsappRuntime>>;
let runtime: Runtime;
let printed: string[] = [];
const previousLevel = logger.level;

beforeAll(async () => {
  runtime = await whatsappRuntime();
  logger.level = "debug";
});
afterAll(() => {
  logger.level = previousLevel;
});

/** Captures the dev log lines written while `action` runs (the logger is silent in tests otherwise). */
async function linesDuring(action: () => Promise<unknown>): Promise<string> {
  printed = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    printed.push(String(chunk));
    return true;
  });
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return printed.join("");
}

const postWebhook = (body: string, signature?: string, app = runtime.app) => {
  const call = request(app).post("/whatsapp/webhook").set("content-type", "application/json");
  return (signature === undefined ? call : call.set("x-hub-signature-256", signature)).send(body);
};

describe("webhook log lines", () => {
  it("a signed webhook logs that it was queued, with counts and the sender's last 4 digits only", async () => {
    const body = messageBody({ from: "447700900017", text: "when is my machine coming?" });
    const lines = await linesDuring(async () => {
      await postWebhook(body, signatureFor(body, APP_SECRET)).expect(200);
      await runtime.queue.drain();
    });
    expect(lines).toMatch(/INFO {2}whatsapp webhook queued POST \/whatsapp\/webhook -> 200 \(\d+ ms\)/);
    expect(lines).toContain('"messages":1');
    expect(lines).toContain('"from":["***0017"]');
    // The worker's outcome follows.
    expect(lines).toContain("whatsapp message handled");
    expect(lines).not.toContain("when is my machine coming");
    expect(lines).not.toContain("447700900017");
  });

  it("a bad, missing or unsigned webhook logs the reason it was refused", async () => {
    const body = messageBody({ text: "hello" });
    const wrongSecret = await linesDuring(() => postWebhook(body, signatureFor(body, "another-secret")).expect(401));
    expect(wrongSecret).toMatch(/WARN {2}whatsapp webhook refused POST \/whatsapp\/webhook -> 401/);
    expect(wrongSecret).toContain("signature does not match");
    const missing = await linesDuring(() => postWebhook(body).expect(401));
    expect(missing).toContain("no X-Hub-Signature-256 header");
    expect(missing + wrongSecret).not.toContain(APP_SECRET);
  });

  it("names a missing app secret and a switched-off webhook", async () => {
    const noSecret = createAppWith({ WHATSAPP_APP_SECRET: "" });
    const body = messageBody({ text: "hello" });
    expect(await linesDuring(() => postWebhook(body, signatureFor(body, APP_SECRET), noSecret).expect(401))).toContain("WHATSAPP_APP_SECRET is not set");
    const off = createAppWith({ WHATSAPP_ENABLED: false });
    expect(await linesDuring(() => postWebhook(body, signatureFor(body, APP_SECRET), off).expect(404))).toContain("WHATSAPP_ENABLED is not true");
  });

  it("Meta's verification logs success, or why it was refused, never the token sent", async () => {
    const ok = await linesDuring(() => request(runtime.app).get("/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "42" }).expect(200));
    expect(ok).toMatch(/INFO {2}whatsapp webhook verified by Meta GET \/whatsapp\/webhook/);
    const wrong = await linesDuring(() => request(runtime.app).get("/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "guess-123", "hub.challenge": "42" }).expect(403));
    expect(wrong).toContain("hub.verify_token does not match WHATSAPP_VERIFY_TOKEN");
    // The URL (with its query) is on the line; neither the right token nor a guess is.
    expect(ok).toContain("hub.verify_token=[redacted]");
    expect(ok + wrong).not.toContain(VERIFY_TOKEN);
    expect(wrong).not.toContain("guess-123");
  });

  it("delivery statuses and duplicate deliveries are logged", async () => {
    const statusLines = await linesDuring(() => runtime.deliver(statusBody("wamid.out-1", "delivered", 1_760_000_000)));
    expect(statusLines).toContain("whatsapp delivery status");
    expect(statusLines).toContain('"status":"delivered"');
    const body = messageBody({ id: "wamid.log-dup", from: "447700900017", text: "hi" });
    await linesDuring(() => runtime.deliver(body));
    const again = await linesDuring(() => runtime.deliver(body));
    expect(again).toContain("skipped: already handled");
  });
});

describe("request log lines", () => {
  it("refused requests are warn with the reason; health checks are not logged", async () => {
    const lines = await linesDuring(async () => {
      await request(runtime.app).get("/healthz").expect(200);
      await request(runtime.app).get("/operator/board").expect(401);
    });
    expect(lines).not.toContain("/healthz");
    expect(lines).toMatch(/WARN {2}request refused GET \/operator\/board -> 401/);
    expect(lines).toContain("unauthenticated: missing bearer token");
  });

  it("malformed JSON is a 400 (not a 500) and its body is not logged", async () => {
    const lines = await linesDuring(() => request(runtime.app).post("/operator/plan/approve").set("content-type", "application/json").send('{"secret-ish": tru').expect(400));
    expect(lines).toContain("unreadable body: entity.parse.failed");
    expect(lines).not.toContain("secret-ish");
  });
});

describe("start-up warnings", () => {
  it("names the settings that make WhatsApp silently refuse everything", () => {
    const config = { ...loadConfig({ NODE_ENV: "test" }), WHATSAPP_ENABLED: true };
    const problems = whatsappSetupProblems(config).join("\n");
    expect(problems).toContain("WHATSAPP_APP_SECRET is not set");
    expect(problems).toContain("WHATSAPP_VERIFY_TOKEN is not set");
    expect(whatsappSetupProblems({ ...config, WHATSAPP_ENABLED: false })).toEqual([]);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ NODE_ENV: "test", LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});

describe("the development log line", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts an error's class, message, code and status on the line, then the stack", async () => {
    const lines = await linesDuring(async () => {
      devLines.write(JSON.stringify({ level: 50, time: Date.now(), msg: "sqs receive failed", err: { type: "AccessDeniedException", message: "not authorized to perform sqs:ReceiveMessage", $metadata: { httpStatusCode: 403 }, stack: "AccessDeniedException: ...\n    at x" } }));
    });
    expect(lines).toContain("ERROR sqs receive failed | AccessDeniedException: not authorized to perform sqs:ReceiveMessage [status 403]");
    expect(lines).toContain("    at x");
  });
});

function createAppWith(overrides: Partial<ReturnType<typeof loadConfig>>) {
  return createApp({ ...runtime.runtime.dependencies, config: { ...runtime.runtime.dependencies.config, ...overrides } });
}
