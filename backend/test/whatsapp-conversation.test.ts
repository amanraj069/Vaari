/**
 * A conversation on WhatsApp, not one message at a time: the reply language follows the script the
 * farmer writes or taps in. The model is a stand-in (no Bedrock call).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createFarmerAccount } from "../src/auth/farmer-otp";
import { words } from "../src/whatsapp/messages";
import { parseWebhook } from "../src/whatsapp/payload";
import type { SentMessage } from "../src/whatsapp/sender";
import { ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const JASWINDER = "447700900017"; // DEMO_FARMER_PHONE as Meta sends it; has fields
const HARPREET = "+447700900981"; // registered on the web in English, no field yet
const hi = words("hi");

let runtime: Awaited<ReturnType<typeof whatsappRuntime>>;
const lastTo = (phone: string): SentMessage | undefined => runtime.sender.sent.filter((message) => message.to === phone).at(-1);
const from = (phone: string) => phone.replace(/^\+/, "");

beforeAll(async () => {
  runtime = await whatsappRuntime({ config: { AGENT_ENABLED: true }, runner: new ScriptedRunner(async () => "") });
  await createFarmerAccount(runtime.runtime.dependencies.store, HARPREET, "Harpreet Singh", "en");
});

describe("the reply language", () => {
  it("tapping the Hindi 'खेत बुक करें' row is answered in Hindi, though the farmer registered in English", async () => {
    await runtime.deliver(messageBody({ from: from(HARPREET), listRow: "menu:book", title: hi.menuBook }));
    expect(lastTo(HARPREET)).toMatchObject({ type: "text", body: hi.bookAsk });
  });
});

describe("the parts that make this work", () => {
  it("a tapped button or row carries its title as the message text", () => {
    const [message] = parseWebhook(messageBody({ from: JASWINDER, listRow: "menu:book", title: hi.menuBook })).messages;
    expect(message).toMatchObject({ kind: "reply", replyId: "menu:book", text: hi.menuBook });
  });
});
