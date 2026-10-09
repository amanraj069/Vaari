/**
 * Between the webhook and the worker. The webhook only verifies the signature and enqueues the raw
 * body, then answers Meta at once; the worker does everything else. memory: in-process, for dev and
 * tests (drain() waits for the work). sqs: the API writes to SQS and `npm run worker` reads it
 * (long polling); a message is deleted only after it was handled, so a crash retries it (the worker
 * dedupes by WhatsApp message id).
 */
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "../logger";

export type QueueConsumer = (body: string) => Promise<void>;

export interface WebhookQueue {
  send(body: string): Promise<void>;
}

export class MemoryQueue implements WebhookQueue {
  private consumer: QueueConsumer | null = null;
  private readonly running = new Set<Promise<void>>();

  setConsumer(consumer: QueueConsumer) {
    this.consumer = consumer;
  }

  async send(body: string) {
    const work = Promise.resolve()
      .then(() => this.consumer?.(body))
      .catch((error: unknown) => logger.error({ err: error }, "whatsapp worker failed"))
      .finally(() => this.running.delete(work));
    this.running.add(work);
  }

  /** Waits until every message sent so far has been handled. */
  async drain() {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }
}

export class SqsQueue implements WebhookQueue {
  private readonly client: SQSClient;

  constructor(
    private readonly queueUrl: string,
    region: string,
  ) {
    this.client = new SQSClient({ region });
  }

  async send(body: string) {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: body }));
  }

  /** The worker loop: long-poll, handle, delete. Stops when `signal` aborts. */
  async consume(consumer: QueueConsumer, signal: AbortSignal) {
    while (!signal.aborted) {
      const received = await this.client
        .send(new ReceiveMessageCommand({ QueueUrl: this.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 120 }), { abortSignal: signal })
        .catch((error: unknown) => {
          if (!signal.aborted) logger.error({ err: error }, "sqs receive failed");
          return null;
        });
      for (const message of received?.Messages ?? []) {
        try {
          await consumer(message.Body ?? "");
          await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
        } catch (error) {
          // Left on the queue: retried after the visibility timeout (a DLQ catches poison messages).
          logger.error({ err: error }, "whatsapp worker failed; message left for retry");
        }
      }
      if (!received) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
