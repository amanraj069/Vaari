/**
 * A conversation on WhatsApp, not one message at a time: the model's question back reaches the
 * farmer (only when it holds no number or date); the reply language follows the script the farmer
 * writes or taps in, and is remembered; the model sees the last few exchanges with this phone, never
 * a one-time link, never another phone's, and none after a quiet spell. The model is a stand-in
 * (no Bedrock call).
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createFarmerAccount } from "../src/auth/farmer-otp";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import type { AgentInput, AgentRunner } from "../src/whatsapp/agent";
import { words } from "../src/whatsapp/messages";
import { checkReply } from "../src/whatsapp/output-check";
import { parseWebhook } from "../src/whatsapp/payload";
import type { SentMessage } from "../src/whatsapp/sender";
import { FarmerSession, type FarmerTool } from "../src/whatsapp/tools";
import { RecentExchanges } from "../src/whatsapp/worker";
import { ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const JASWINDER = "447700900017"; // DEMO_FARMER_PHONE as Meta sends it; has fields
const HARPREET = "+447700900981"; // registered on the web in English, no field yet
const MANJIT = "+447700900982"; // registered on the web in English, no field yet
const en = words("en");
const hi = words("hi");

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
  await createFarmerAccount(runtime.runtime.dependencies.store, MANJIT, "Manjit Kaur", "en");
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

describe("a turn always says something useful", () => {
  it("a question back that says 'thanks' (शुक्रिया, which holds the short word for Friday) is still sent", async () => {
    const question = "शुक्रिया! आपका खेत किस गाँव में है?";
    runner.script = async () => question;
    await runtime.deliver(messageBody({ from: JASWINDER, text: "मेरा खेत बुक करो" }));
    expect(lastTo(DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: question });
  });

  it("a farmer with no field who asks for their date is told so, never left with no reply", async () => {
    runner.script = async (tool) => (await tool("list_my_fields").run({}), "");
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: from(HARPREET), text: "मेरी मशीन कब आएगी?" }));
    expect(runtime.sender.sent.slice(before).filter((message) => message.to === HARPREET)).toEqual([expect.objectContaining({ type: "text", body: hi.noFields })]);
  });

  it("a field that is not in the farmer's list gets 'could not find that field', not a sentence about changes", async () => {
    runner.script = async (tool) => (await tool("get_slot").run({ fieldRef: 9 }), "");
    await runtime.deliver(messageBody({ from: JASWINDER, text: "मेरे नौवें खेत की तारीख़?" }));
    expect(lastTo(DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: hi.fieldNotFound });
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

  it("the fields page link is short, and opens the site in the chat's language", async () => {
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:page", title: hi.menuPage }));
    const body = JSON.stringify(lastTo(DEMO_FARMER_PHONE));
    const token = /\/farmer\/login\/([A-Za-z0-9_-]+)/.exec(body)?.[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect((await request(runtime.app).post("/farmer/login").send({ token }).expect(200)).body.locale).toBe("hi");
  });
});

describe("the model sees the last few exchanges with this phone", () => {
  it("'Book a field', then the details: the model knows what the farmer is answering", async () => {
    await runtime.deliver(messageBody({ from: from(MANJIT), listRow: "menu:book", title: en.menuBook }));
    runner.script = async () => "";
    await runtime.deliver(messageBody({ from: from(MANJIT), text: "Balian, 4 acres, till 3 November" }));
    const input = runner.inputs.at(-1)!;
    expect(input.text).toBe("Balian, 4 acres, till 3 November");
    expect(input.history).toEqual([{ farmer: en.menuBook, vaari: en.bookAsk }]);
  });

  it("a one-time login link never reaches the model, and another phone's exchanges never do", async () => {
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:page", title: "x" }));
    expect(JSON.stringify(lastTo(DEMO_FARMER_PHONE))).toContain("/farmer/login/");
    runner.script = async () => "";
    await runtime.deliver(messageBody({ from: JASWINDER, text: "thanks" }));
    const history = JSON.stringify(runner.inputs.at(-1)!.history);
    expect(history).toContain("[link]");
    expect(history).not.toMatch(/https?:|\/farmer\/login/);
    expect(history).not.toContain("Manjit");
    expect(history).not.toContain("Balian, 4 acres");
  });

  it("after a quiet spell of 15 minutes the model starts afresh", async () => {
    runtime.clock.now = new Date(runtime.clock.now.getTime() + 16 * 60_000);
    runner.script = async () => "";
    await runtime.deliver(messageBody({ from: from(MANJIT), text: "hello" }));
    expect(runner.inputs.at(-1)!.history).toEqual([]);
  });
});

describe("RecentExchanges", () => {
  const exchange = (index: number) => ({ farmer: `farmer ${index}`, vaari: `vaari ${index}` });

  it("keeps the last few exchanges per phone, oldest first", () => {
    const recent = new RecentExchanges(3, 15);
    for (let index = 1; index <= 5; index += 1) recent.add("+1", exchange(index), index * 1_000);
    recent.add("+2", exchange(9), 6_000);
    expect(recent.recent("+1", 6_000)).toEqual([exchange(3), exchange(4), exchange(5)]);
    expect(recent.recent("+2", 6_000)).toEqual([exchange(9)]);
  });

  it("forgets a conversation 15 minutes after its last message, not its first", () => {
    const recent = new RecentExchanges(3, 15);
    recent.add("+1", exchange(1), 0);
    recent.add("+1", exchange(2), 10 * 60_000);
    expect(recent.recent("+1", 24 * 60_000)).toEqual([exchange(1), exchange(2)]);
    expect(recent.recent("+1", 25 * 60_000)).toEqual([]);
    // A quiet conversation is dropped when anyone else writes, and does not come back.
    recent.add("+2", exchange(3), 26 * 60_000);
    recent.add("+1", exchange(4), 26 * 60_000);
    expect(recent.recent("+1", 26 * 60_000)).toEqual([exchange(4)]);
  });
});

describe("the parts that make this work", () => {
  it("a tapped button or row carries its title as the message text", () => {
    const [message] = parseWebhook(messageBody({ from: JASWINDER, listRow: "menu:book", title: hi.menuBook })).messages;
    expect(message).toMatchObject({ kind: "reply", replyId: "menu:book", text: hi.menuBook });
  });

  it("a booking problem comes back with what was understood, so a question that repeats it passes the check", async () => {
    const session = new FarmerSession(runtime.runtime.dependencies, { kind: "farmerPhone", phone: MANJIT }, "en");
    const output = await session.tool("book_field").run({ village: "Atlantis", acres: 4, moreDaysYouCanWait: 3 });
    expect(output).toMatchObject({ error: expect.stringMatching(/no machine centre serves/), understood: { village: "Atlantis", acres: 4 } });
    expect(checkReply("Which village is your 4 acre field in?", session.calls).ok).toBe(true);
    // Still nothing the tools did not say.
    expect(checkReply("Which village is your 5 acre field in?", session.calls).ok).toBe(false);
  });
});
