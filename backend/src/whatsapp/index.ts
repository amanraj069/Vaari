/**
 * Wires the WhatsApp pieces for one process. WHATSAPP_QUEUE=memory: the API process runs the worker
 * itself (dev, tests). WHATSAPP_QUEUE=sqs: the API only enqueues; `npm run worker` consumes.
 * WHATSAPP_ENABLED=false (the default): a recording sender, so nothing ever leaves the process.
 */
import type { Config } from "../config";
import type { EngineClient } from "../engine/client";
import type { Planner } from "../domain/planner";
import type { VaariStore } from "../store/types";
import { StrandsRunner, type AgentRunner } from "./agent";
import { createNotifier, type Notifier } from "./notices";
import { MemoryQueue, SqsQueue, type WebhookQueue } from "./queue";
import { GraphSender, RecordingSender, type WhatsAppSender } from "./sender";
import { createWorker, type WhatsAppWorker } from "./worker";

export type WhatsAppRuntime = { queue: WebhookQueue; sender: WhatsAppSender; runner: AgentRunner | null; worker: WhatsAppWorker; notifier: Notifier };

/**
 * Settings that make WhatsApp quietly do nothing, named at start-up (the API and the worker log
 * each as a warning) so a webhook that "never arrives" is explained before the first one does.
 */
export function whatsappSetupProblems(config: Config): string[] {
  if (!config.WHATSAPP_ENABLED) return [];
  const problems: string[] = [];
  if (!config.WHATSAPP_APP_SECRET) problems.push("WHATSAPP_APP_SECRET is not set: every webhook POST will be refused with 401");
  if (!config.WHATSAPP_VERIFY_TOKEN) problems.push("WHATSAPP_VERIFY_TOKEN is not set: Meta's webhook verification (GET) will be refused with 403");
  if (!config.WHATSAPP_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) problems.push("WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set: replies cannot be sent");
  if (config.WHATSAPP_QUEUE === "sqs" && !config.WHATSAPP_SQS_QUEUE_URL) problems.push("WHATSAPP_QUEUE=sqs but WHATSAPP_SQS_QUEUE_URL is not set: webhooks cannot be queued (500)");
  return problems;
}

export function buildWhatsApp(
  deps: { config: Config; store: VaariStore; planner: Planner; engine: EngineClient },
  overrides: { sender?: WhatsAppSender; runner?: AgentRunner | null; queue?: WebhookQueue; now?: () => Date } = {},
): WhatsAppRuntime {
  const { config } = deps;
  const sender = overrides.sender ?? (config.WHATSAPP_ENABLED ? new GraphSender(config) : new RecordingSender());
  const runner = overrides.runner !== undefined ? overrides.runner : config.AGENT_ENABLED ? new StrandsRunner(config) : null;
  const worker = createWorker({ ...deps, sender, runner, now: overrides.now });
  const queue = overrides.queue ?? (config.WHATSAPP_QUEUE === "sqs" ? new SqsQueue(config.WHATSAPP_SQS_QUEUE_URL, config.AWS_REGION ?? "ap-south-1") : new MemoryQueue());
  if (queue instanceof MemoryQueue) queue.setConsumer(worker.handle);
  return { queue, sender, runner, worker, notifier: createNotifier({ ...deps, sender }) };
}
