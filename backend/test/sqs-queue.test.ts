/**
 * The worker's SQS loop reports that it is alive only when SQS answered or a message was handled,
 * never after a failed receive: the worker's health check (docker-compose.yml) is built on that, so
 * a worker that cannot reach SQS fails the deploy instead of looking fine. SQS is a stand-in here.
 */
import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { expect, it } from "vitest";
import { SqsQueue } from "../src/whatsapp/queue";

it("alive after an answered poll and a handled message, not after a failed receive", async () => {
  const queue = new SqsQueue("https://sqs.ap-south-1.amazonaws.com/123456789012/vaari", "ap-south-1");
  const stop = new AbortController();
  const events: string[] = [];
  const receives = [
    async () => ({ Messages: [{ MessageId: "m1", Body: "body-1", ReceiptHandle: "r1" }] }),
    async () => ({ Messages: [] }),
    async () => {
      stop.abort();
      throw Object.assign(new Error("not authorized to perform: sqs:receivemessage"), { name: "AccessDenied" });
    },
  ];
  // The queue's own client, swapped for a stand-in that answers each command in turn.
  Object.defineProperty(queue, "client", {
    value: {
      send: async (command: unknown) => {
        if (command instanceof ReceiveMessageCommand) {
          events.push("receive");
          return receives.shift()!();
        }
        if (command instanceof DeleteMessageCommand) return events.push(`delete ${command.input.ReceiptHandle}`);
        throw new Error("unexpected command");
      },
    },
  });

  await queue.consume(async (body) => void events.push(`handle ${body}`), stop.signal, () => events.push("alive"));

  expect(events).toEqual(["receive", "alive", "handle body-1", "alive", "delete r1", "receive", "alive", "receive"]);
});
