/**
 * A conversation on WhatsApp, not one message at a time: the model's question back reaches the
 * farmer (only when it holds no number or date), and the reply language follows the script the
 * farmer writes or taps in, and is remembered. The model is a stand-in (no Bedrock call).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createFarmerAccount } from "../src/auth/farmer-otp";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import type { AgentRunner } from "../src/whatsapp/agent";
import { words } from "../src/whatsapp/messages";
import { parseWebhook } from "../src/whatsapp/payload";
import type { SentMessage } from "../src/whatsapp/sender";
import type { FarmerTool } from "../src/whatsapp/tools";
import { ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const JASWINDER = "447700900017"; // DEMO_FARMER_PHONE as Meta sends it; has fields
const HARPREET = "+447700900981"; // registered on the web in English, no field yet
const hi = words("hi");

type AgentInput = Parameters<AgentRunner["run"]>[0];

/** A stand-in model that records what it was given, then runs `script` against the tools. */
class RecordingRunner implements AgentRunner {
  readonly inputs: AgentInput[] = [];
  script: (tool: (name: string) => FarmerTool) => Promise<string> = async () => "";
  run(input: AgentInput) {
    this.inputs.push(input);
    return new ScriptedRunner(this.script).run(input);
  }
}

let runtime: Awaited<ReturnType<typeof whatsappRuntime>>;
const runner = new RecordingRunner();
const lastTo = (phone: string): SentMessage | undefined => runtime.sender.sent.filter((message) => message.to === phone).at(-1);
const from = (phone: string) => phone.replace(/^\+/, "");
const accountFarmer = async (phone: string) => {
  const { store } = runtime.runtime.dependencies;
  return store.getFarmer((await store.getFarmerAccount(phone))!.farmerId);
};

beforeAll(async () => {
  runtime = await whatsappRuntime({ config: { AGENT_ENABLED: true }, runner });
  await createFarmerAccount(runtime.runtime.dependencies.store, HARPREET, "Harpreet Singh", "en");
});

describe("a question back reaches the farmer", () => {
  it("'I want to book a machine' in Hindi: the model's question back is sent as it is, in Hindi", async () => {
    const question = "आपका खेत किस गाँव में है, कितने एकड़ का है, और आप मशीन का इंतज़ार कब तक कर सकते हैं?";
    runner.script = async () => question;
    await runtime.deliver(messageBody({ from: JASWINDER, text: "मुझे एक मशीन बुक करनी है" }));
    expect(runner.inputs.at(-1)?.locale).toBe("hi");
    expect(lastTo(DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: question });
  });

  it("a reply with no tool call that names a date or a number is never sent: the menu instead", async () => {
    runner.script = async () => "आपकी मशीन 3 नवंबर को आएगी।";
    await runtime.deliver(messageBody({ from: JASWINDER, text: "मेरी मशीन कब आएगी?" }));
    const sent = lastTo(DEMO_FARMER_PHONE);
    expect(sent).toMatchObject({ type: "list", body: `${hi.offTopic}\n\n${hi.menuBody}` });
    expect(JSON.stringify(sent)).not.toContain("नवंबर");
  });
});

describe("the reply language", () => {
  it("tapping the Hindi 'खेत बुक करें' row is answered in Hindi, though the farmer registered in English", async () => {
    await runtime.deliver(messageBody({ from: from(HARPREET), listRow: "menu:book", title: hi.menuBook }));
    expect(lastTo(HARPREET)).toMatchObject({ type: "text", body: hi.bookAsk });
  });

  it("is remembered: the farmer record (which notices use) now says Hindi, and Latin letters keep it", async () => {
    expect((await accountFarmer(HARPREET))?.language).toBe("hi");
    runner.script = async () => "";
    await runtime.deliver(messageBody({ from: from(HARPREET), text: "Balian 4 acre" }));
    expect(runner.inputs.at(-1)?.locale).toBe("hi");
    expect((await accountFarmer(HARPREET))?.language).toBe("hi");
  });

  it("writing in Gurmukhi switches every farmer record of the phone to Punjabi", async () => {
    const { store } = runtime.runtime.dependencies;
    const field = await store.getField(DEMO_CHC_ID, "f-jaswinder");
    expect((await store.getFarmer(field!.farmerId))?.language).toBe("hi"); // from the Hindi above
    runner.script = async () => "";
    await runtime.deliver(messageBody({ from: JASWINDER, text: "ਮੇਰੀ ਮਸ਼ੀਨ ਕਦੋਂ ਆਵੇਗੀ?" }));
    expect((await store.getFarmer(field!.farmerId))?.language).toBe("pa");
  });
});

describe("the parts that make this work", () => {
  it("a tapped button or row carries its title as the message text", () => {
    const [message] = parseWebhook(messageBody({ from: JASWINDER, listRow: "menu:book", title: hi.menuBook })).messages;
    expect(message).toMatchObject({ kind: "reply", replyId: "menu:book", text: hi.menuBook });
  });
});
