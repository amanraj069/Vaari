/**
 * The WhatsApp webhook. GET answers Meta's verification. POST checks X-Hub-Signature-256 against the
 * RAW body with WHATSAPP_APP_SECRET (401 otherwise), puts the body on the queue and answers 200 at
 * once: no other work happens in the request. Mounted before express.json() so the bytes are intact.
 * The body is never logged.
 */
import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import type { Config } from "../config";
import { logger } from "../logger";
import type { WebhookQueue } from "./queue";
import { validSignature } from "./signature";

const sameText = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function whatsappRouter(config: Config, queue: WebhookQueue): Router {
  const router = Router();

  router.get("/whatsapp/webhook", (request, response) => {
    if (!config.WHATSAPP_ENABLED) return void response.status(404).json({ error: "NOT_FOUND" });
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];
    if (mode === "subscribe" && typeof token === "string" && config.WHATSAPP_VERIFY_TOKEN && sameText(token, config.WHATSAPP_VERIFY_TOKEN) && typeof challenge === "string") {
      return void response.status(200).type("text/plain").send(challenge);
    }
    response.status(403).json({ error: "FORBIDDEN" });
  });

  router.post("/whatsapp/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (request, response) => {
    if (!config.WHATSAPP_ENABLED) return void response.status(404).json({ error: "NOT_FOUND" });
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!validSignature(raw, request.get("x-hub-signature-256"), config.WHATSAPP_APP_SECRET)) {
      return void response.status(401).json({ error: "UNAUTHENTICATED" });
    }
    try {
      await queue.send(raw.toString("utf8"));
    } catch (error) {
      // Not accepted: Meta retries a non-200 webhook.
      logger.error({ err: error instanceof Error ? error.message : "unknown" }, "whatsapp webhook could not be queued");
      return void response.status(500).json({ error: "QUEUE_UNAVAILABLE" });
    }
    response.status(200).json({ status: "queued" });
  });

  return router;
}
