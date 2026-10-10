/**
 * The WhatsApp webhook. GET answers Meta's verification. POST checks X-Hub-Signature-256 against the
 * RAW body with WHATSAPP_APP_SECRET (401 otherwise), puts the body on the queue and answers 200 at
 * once: no other work happens in the request. Mounted before express.json() so the bytes are intact.
 * Every call leaves one log line ("whatsapp webhook ...") saying what came in or why it was refused;
 * the body, the tokens and full phone numbers are never logged.
 */
import { timingSafeEqual } from "node:crypto";
import express, { Router, type Response } from "express";
import type { Config } from "../config";
import { noteForLog } from "../logger";
import { parseWebhook } from "./payload";
import { fromWhatsAppNumber, maskPhone } from "./phone";
import type { WebhookQueue } from "./queue";
import { validSignature } from "./signature";

const sameText = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Why a POST failed the signature check, in words that point at the fix. */
function signatureProblem(config: Config, header: string | undefined, bytes: number): string {
  if (!config.WHATSAPP_APP_SECRET) return "WHATSAPP_APP_SECRET is not set: no signature can be valid";
  if (!header) return "no X-Hub-Signature-256 header (not sent by Meta?)";
  if (!header.startsWith("sha256=")) return "X-Hub-Signature-256 is not sha256=<hex>";
  if (bytes === 0) return "empty body (missing Content-Type, or a proxy dropped the body)";
  return "signature does not match: WHATSAPP_APP_SECRET is not this Meta app's secret, or the body changed on the way";
}

/** What a webhook carried, for the log: counts, message kinds, senders' last 4 digits. Never the text. */
function summarise(body: string): Record<string, unknown> {
  try {
    const parsed = parseWebhook(body);
    return {
      messages: parsed.messages.length,
      statuses: parsed.statuses.map((status) => status.status),
      kinds: parsed.messages.map((message) => message.kind),
      from: [...new Set(parsed.messages.map((message) => maskPhone(fromWhatsAppNumber(message.sender))))],
    };
  } catch {
    return { payload: "not a WhatsApp messages payload (the worker drops it)" };
  }
}

const refuse = (response: Response, status: number, body: object, reason: string) => {
  noteForLog(response, { reason }, "whatsapp webhook refused");
  response.status(status).json(body);
};

export function whatsappRouter(config: Config, queue: WebhookQueue): Router {
  const router = Router();

  router.get("/whatsapp/webhook", (request, response) => {
    if (!config.WHATSAPP_ENABLED) return refuse(response, 404, { error: "NOT_FOUND" }, "WHATSAPP_ENABLED is not true");
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];
    if (mode === "subscribe" && typeof token === "string" && config.WHATSAPP_VERIFY_TOKEN && sameText(token, config.WHATSAPP_VERIFY_TOKEN) && typeof challenge === "string") {
      noteForLog(response, {}, "whatsapp webhook verified by Meta");
      return void response.status(200).type("text/plain").send(challenge);
    }
    const reason =
      mode !== "subscribe"
        ? "hub.mode is not subscribe"
        : !config.WHATSAPP_VERIFY_TOKEN
          ? "WHATSAPP_VERIFY_TOKEN is not set"
          : typeof challenge !== "string"
            ? "no hub.challenge"
            : "hub.verify_token does not match WHATSAPP_VERIFY_TOKEN";
    refuse(response, 403, { error: "FORBIDDEN" }, `verification refused: ${reason}`);
  });

  router.post("/whatsapp/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (request, response) => {
    if (!config.WHATSAPP_ENABLED) return refuse(response, 404, { error: "NOT_FOUND" }, "WHATSAPP_ENABLED is not true");
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const header = request.get("x-hub-signature-256");
    if (!validSignature(raw, header, config.WHATSAPP_APP_SECRET)) {
      return refuse(response, 401, { error: "UNAUTHENTICATED" }, signatureProblem(config, header, raw.length));
    }
    const body = raw.toString("utf8");
    noteForLog(response, { queue: config.WHATSAPP_QUEUE, bytes: raw.length, ...summarise(body) });
    try {
      await queue.send(body);
    } catch (error) {
      // Not accepted: Meta retries a non-200 webhook. pino-http logs this error with the request.
      response.err = error instanceof Error ? error : new Error(String(error));
      noteForLog(response, {}, "whatsapp webhook could not be queued");
      return void response.status(500).json({ error: "QUEUE_UNAVAILABLE" });
    }
    noteForLog(response, {}, "whatsapp webhook queued");
    response.status(200).json({ status: "queued" });
  });

  return router;
}
