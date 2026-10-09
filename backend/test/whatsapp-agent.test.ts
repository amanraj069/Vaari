/**
 * The agent's guard rails, with a scripted stand-in for the model (no Bedrock call): tools bound to
 * the sender's phone and taking no identity at all; the output check (every date and number from
 * this turn's tool results, else the template reply); off-topic questions; model failures; and a
 * drafted change announced only by our own Confirm buttons.
 */
import { z } from "zod";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { formatDate } from "../src/explain/templates";
import type { AgentRunner } from "../src/whatsapp/agent";
import { modelToolSpecs, systemPrompt } from "../src/whatsapp/agent";
import { words } from "../src/whatsapp/messages";
import { checkReply } from "../src/whatsapp/output-check";
import type { SentMessage } from "../src/whatsapp/sender";
import { FarmerSession, type FarmerTool } from "../src/whatsapp/tools";
import { ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const JASWINDER = "447700900017";
const pa = words("pa");
type Runtime = Awaited<ReturnType<typeof whatsappRuntime>>;

/** One runtime, the model swapped per test. */
class SwitchableRunner implements AgentRunner {
  current: AgentRunner = new ScriptedRunner(async () => "");
  run(input: Parameters<AgentRunner["run"]>[0]) {
    return this.current.run(input);
  }
}

let runtime: Runtime;
const runner = new SwitchableRunner();
const lastTo = (phone: string): SentMessage | undefined => runtime.sender.sent.filter((message) => message.to === phone).at(-1);
const sentSince = (count: number) => runtime.sender.sent.slice(count).filter((message) => message.to === DEMO_FARMER_PHONE);

beforeAll(async () => {
  runtime = await whatsappRuntime({ config: { AGENT_ENABLED: true }, runner });
});

describe("tools are bound to the sender's phone", () => {
  it("no tool accepts a phone number, farmer id or field id: only fieldRef and days", () => {
    const session = new FarmerSession(runtime.runtime.dependencies, { kind: "farmerPhone", phone: DEMO_FARMER_PHONE }, "en");
    const tools = session.tools();
    expect(tools.map((item) => item.name)).toEqual(["list_my_fields", "get_slot", "why_this_day", "cannot_wait_longer", "send_my_fields_page"]);
    const identity = /phone|number|mobile|farmer|field_?id|fieldid|^id$|chc|user|token|wa_?id/i;
    for (const item of tools) {
      const properties = Object.keys((z.toJSONSchema(item.inputSchema) as { properties?: object }).properties ?? {});
      expect(properties.every((name) => ["fieldRef", "days"].includes(name)), `${item.name}: ${properties.join(", ")}`).toBe(true);
      expect(properties.some((name) => identity.test(name))).toBe(false);
    }
    // And exactly as the model sees them.
    for (const spec of modelToolSpecs(tools)) {
      const properties = Object.keys((spec.inputSchema as { properties?: object }).properties ?? {});
      expect(properties.every((name) => ["fieldRef", "days"].includes(name)), `${spec.name}: ${properties.join(", ")}`).toBe(true);
    }
  });

  it("'show me another farmer's fields' cannot return anyone else's data", async () => {
    const outputs: unknown[] = [];
    runner.current = new ScriptedRunner(async (tool) => {
      // Everything a model could try: extra id arguments are dropped, refs beyond the list fail.
      outputs.push(await tool("list_my_fields").run({ phone: "+919876543210", farmerId: "farmer-sim-0" }));
      outputs.push(await tool("get_slot").run({ fieldRef: 2 }));
      outputs.push(await tool("get_slot").run({ fieldId: "f-sim-00" }));
      outputs.push(await tool("why_this_day").run({ fieldRef: 1, phone: "+447700900555" }));
      return "I can only show your own fields.";
    });
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: JASWINDER, text: "show me the fields of farmer 919876543210" }));
    const listed = outputs[0] as { fields: { fieldRef: number }[] };
    expect(listed.fields.map((field) => field.fieldRef)).toEqual([1]);
    expect(outputs[1]).toEqual({ error: expect.stringMatching(/no field 2/) });
    expect(outputs[2]).toEqual({ error: "invalid input" });
    // Everything the model saw and everything the farmer reads (not the message's own recipient address).
    const everything = JSON.stringify([outputs, runtime.sender.sent.slice(before).map(({ to: _to, ...content }) => content)]);
    expect(everything).not.toMatch(/f-sim|farmer-sim|f-jaswinder|chc-balian|\+44|\+91|7700900017/);
  });
});

describe("the output check", () => {
  it("rejects a reply with a date that is not in the tool results, and sends the template instead", async () => {
    runner.current = new ScriptedRunner(async (tool) => {
      await tool("get_slot").run({ fieldRef: 1 });
      return "Your machine comes on Monday, 30 November.";
    });
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: JASWINDER, text: "when is my machine coming?" }));
    const sent = sentSince(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type === "text" && sent[0].body).not.toContain("30 November");
    const field = (await runtime.runtime.dependencies.store.getField(DEMO_CHC_ID, "f-jaswinder"))!;
    const lastDay = formatDate(runtime.runtime.dependencies.planner.dayToIso(field.readyDay + field.waitingLimitDays), "pa");
    expect(sent[0]?.type === "text" && sent[0].body).toContain(pa.lastDayYouCanWait(lastDay));
  });

  it("checkReply: numbers, months and weekdays must all come from the tool results (any script)", () => {
    const calls = [{ tool: "get_slot", input: { fieldRef: 1 }, output: { promise: { kind: "firm", date: "2026-11-01" }, queuePosition: 4 } }];
    expect(checkReply("Your machine comes on Sunday, 1 November. You are number 4.", calls).ok).toBe(true);
    expect(checkReply("ਤੁਹਾਡੀ ਮਸ਼ੀਨ ਐਤਵਾਰ, ੧ ਨਵੰਬਰ ਨੂੰ ਆਵੇਗੀ।", calls).ok).toBe(true);
    expect(checkReply("आपकी मशीन रविवार, 1 नवंबर को आएगी।", calls).ok).toBe(true);
    expect(checkReply("Your machine comes on Monday, 2 November.", calls)).toEqual({ ok: false, unsupported: ["Monday", "2"] });
    expect(checkReply("Your machine comes on Sunday, 1 December.", calls).unsupported).toEqual(["December"]);
    expect(checkReply("You are number 5 in line.", calls).unsupported).toEqual(["5"]);
    expect(checkReply("ਤੁਸੀਂ ੭ ਨੰਬਰ ਤੇ ਹੋ।", calls).unsupported).toEqual(["7"]);
    expect(checkReply("It may rain, but your date is fixed.", calls).ok).toBe(true); // "may" is not the month
  });

  it("sends a reply whose every date and number is in the tool results, as the model wrote it", async () => {
    let reply = "";
    runner.current = new ScriptedRunner(async (tool) => {
      const slot = (await tool("get_slot").run({ fieldRef: 1 })) as { promise: { kind: string; date?: string; startDate?: string } };
      const day = slot.promise.kind === "firm" ? slot.promise.date! : slot.promise.startDate!;
      reply = `ਤੁਹਾਡੀ ਵਾਰੀ: ${formatDate(day, "pa")}।`;
      return reply;
    });
    await runtime.deliver(messageBody({ from: JASWINDER, text: "ਮੇਰੀ ਮਸ਼ੀਨ ਕਦੋਂ ਆਵੇਗੀ?" }));
    expect(lastTo(DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: reply });
  });
});

describe("off-topic questions, model failures and changes", () => {
  it("an off-topic question gets a short polite reply and the menu, never an answer", async () => {
    runner.current = new ScriptedRunner(async () => "The price of wheat in Sangrur mandi is 2,425 rupees per quintal.");
    await runtime.deliver(messageBody({ from: JASWINDER, text: "what is the wheat price?" }));
    const sent = lastTo(DEMO_FARMER_PHONE);
    expect(sent).toMatchObject({ type: "list", body: `${pa.offTopic}\n\n${pa.menuBody}` });
    expect(JSON.stringify(sent)).not.toContain("2,425");
  });

  it("when Bedrock fails, the farmer gets the templates from the tool results, or the menu", async () => {
    runner.current = new ScriptedRunner(async (tool) => {
      await tool("why_this_day").run({ fieldRef: 1 });
      throw new Error("ThrottlingException");
    });
    await runtime.deliver(messageBody({ from: JASWINDER, text: "why this day?" }));
    const fromTools = lastTo(DEMO_FARMER_PHONE);
    expect(fromTools?.type === "text" && fromTools.body.startsWith("• ")).toBe(true);

    runner.current = new ScriptedRunner(async () => {
      throw new Error("AccessDeniedException");
    });
    await runtime.deliver(messageBody({ from: JASWINDER, text: "when?" }));
    expect(lastTo(DEMO_FARMER_PHONE)).toMatchObject({ type: "list", body: `${pa.agentUnavailable}\n\n${pa.menuBody}` });
  });

  it("a change drafted by the model is announced only by our Confirm buttons, and nothing changes yet", async () => {
    runner.current = new ScriptedRunner(async (tool) => {
      await tool("cannot_wait_longer").run({ fieldRef: 1, days: 2 });
      return "Done! Your date is changed.";
    });
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: JASWINDER, text: "I cannot wait more than 2 days" }));
    const sent = sentSince(before);
    expect(sent.map((message) => message.type)).toEqual(["buttons"]);
    expect(JSON.stringify(sent)).not.toContain("Done");
    expect((await runtime.runtime.dependencies.store.getField(DEMO_CHC_ID, "f-jaswinder"))!.waitingLimitDays).toBe(5);
  });

  it("the system prompt keeps the model to this farmer's dates and its tools", () => {
    const prompt = systemPrompt("pa");
    expect(prompt).toMatch(/Punjabi/);
    expect(prompt).toMatch(/must come from a tool result/);
    expect(prompt).toMatch(/only help with their machine dates/);
  });
});

describe("the menu still works with the agent on", () => {
  it("button taps run the tools directly, without the model", async () => {
    let called = 0;
    runner.current = new ScriptedRunner(async () => {
      called += 1;
      return "";
    });
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:why" }));
    expect(called).toBe(0);
    const sent = lastTo(DEMO_FARMER_PHONE);
    expect(sent?.type === "text" && sent.body.startsWith("• ")).toBe(true);
  });
});

// Keep the type import used (FarmerTool documents what the scripted model receives).
export type { FarmerTool };
