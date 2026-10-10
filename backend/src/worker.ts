/**
 * `npm run worker`: the WhatsApp worker as its own process (a Compose service next to the API).
 * Reads webhook bodies from SQS (WHATSAPP_QUEUE=sqs) and handles them; the API only enqueues. With
 * the in-memory queue the API process handles messages itself and this process is not needed.
 */
import { loadConfig } from "./config";
import { createEngineClient } from "./engine/client";
import { Planner } from "./domain/planner";
import { logProcessFailures, logger } from "./logger";
import { createStore } from "./store";
import { buildWhatsApp, whatsappSetupProblems } from "./whatsapp";
import { SqsQueue } from "./whatsapp/queue";

logProcessFailures("worker");
const config = loadConfig();
if (config.WHATSAPP_QUEUE !== "sqs") {
  logger.error("npm run worker needs WHATSAPP_QUEUE=sqs (with the in-memory queue the API handles WhatsApp itself)");
  process.exit(1);
}
const store = createStore(config);
const engine = createEngineClient(config);
const whatsapp = buildWhatsApp({ config, store, planner: new Planner(store, engine, config), engine });
const queue = whatsapp.queue as SqsQueue;
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop.abort());
logger.info({ agent: config.AGENT_ENABLED, model: config.AGENT_ENABLED ? config.BEDROCK_MODEL_ID : undefined, voice: config.VOICE_ENABLED, logLevel: logger.level }, "whatsapp worker listening");
for (const problem of whatsappSetupProblems(config)) logger.warn(problem);
await queue.consume(whatsapp.worker.handle, stop.signal);
