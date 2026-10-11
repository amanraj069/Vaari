/**
 * Booking a field on WhatsApp. The model passes only the farmer's own words; code finds the village
 * and centre, the year and the waiting days; nothing is booked until the farmer taps Confirm; the
 * operator's board then counts a new request; and the notice after the operator approves carries the
 * field's slot link. The model is a scripted stand-in (no Bedrock call).
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createFarmerAccount } from "../src/auth/farmer-otp";
import { verifySlotToken } from "../src/auth/slot-token";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { formatDate } from "../src/explain/templates";
import { operatorPlanSchema } from "../src/shared";
import type { AgentRunner } from "../src/whatsapp/agent";
import { words } from "../src/whatsapp/messages";
import type { SentMessage } from "../src/whatsapp/sender";
import { FarmerSession, MAX_WAIT_DAYS } from "../src/whatsapp/tools";
import { ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const GURPREET = "+447700900996"; // registered on the web, no field yet
const en = words("en");
const TEMPLATES = { WHATSAPP_TEMPLATE_NEW_DATE: "vaari_new_date", WHATSAPP_TEMPLATE_FIRM_DATE: "vaari_firm_date", WHATSAPP_TEMPLATE_DATE_CHANGED: "vaari_date_changed" };

class SwitchableRunner implements AgentRunner {
  current: AgentRunner = new ScriptedRunner(async () => "");
  run(input: Parameters<AgentRunner["run"]>[0]) {
    return this.current.run(input);
  }
}

let runtime: Awaited<ReturnType<typeof whatsappRuntime>>;
const runner = new SwitchableRunner();
const sentTo = (phone: string, since = 0): SentMessage[] => runtime.sender.sent.slice(since).filter((message) => message.to === phone);
const from = (phone: string) => phone.slice(1);
const operatorHeaders = async () => ({ authorization: `Bearer ${(await request(runtime.app).post("/auth/demo").send({ role: "operator" }).expect(200)).body.accessToken as string}` });

beforeAll(async () => {
  runtime = await whatsappRuntime({ config: { AGENT_ENABLED: true, ...TEMPLATES }, runner });
  // As /farmer/signin registers a farmer: the account and the farmer record (whose language notices use).
  await createFarmerAccount(runtime.runtime.dependencies.store, GURPREET, "Gurpreet Singh", "en");
});

describe("'I have 4 acres in Balian and can wait till 3 November' on WhatsApp", () => {
  let confirmId = "";
  let fieldId = "";

  it("drafts the booking and shows every detail with Confirm and Cancel; nothing is booked yet", async () => {
    const { store, planner } = runtime.runtime.dependencies;
    runner.current = new ScriptedRunner(async (tool) => {
      await tool("book_field").run({ village: "Balian", acres: 4, lastDayYouCanWait: { day: 3, month: 11 } });
      return "Booked! Your machine comes on 3 November.";
    });
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: from(GURPREET), text: "I have 4 acres of land in Balian, I can wait 4 more days, till 3rd of November" }));
    const sent = sentTo(GURPREET, before);
    // Only our own Confirm message: the model's "Booked!" is never sent.
    expect(sent.map((message) => message.type)).toEqual(["buttons"]);
    const today = planner.dayToIso(planner.today());
    expect(sent[0]).toMatchObject({
      body: en.bookConfirmBody({ village: "Balian", centre: "Balian Cooperative Society", acres: 4, readyDate: formatDate(today, "en"), lastDay: formatDate("2026-11-03", "en") }),
    });
    const buttons = sent[0]?.type === "buttons" ? sent[0].buttons : [];
    expect(buttons.map((button) => button.title)).toEqual([en.confirm, en.cancel]);
    confirmId = buttons[0]!.id;
    expect(await store.listFieldsByPhone(GURPREET)).toEqual([]);
  });

  it("Confirm books it, tells the farmer the operator has been told, and the operator's board counts a new request", async () => {
    const { store, planner } = runtime.runtime.dependencies;
    const operator = await operatorHeaders();
    const requestsBefore = (await request(runtime.app).get("/operator/board").set(operator).expect(200)).body.newRequests as number;

    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: from(GURPREET), button: confirmId }));
    const [field] = await store.listFieldsByPhone(GURPREET);
    expect(field).toMatchObject({ chcId: DEMO_CHC_ID, acres: 4, readyDay: planner.today(), farmerName: "Gurpreet Singh", farmerPhone: GURPREET, consentBy: "farmer", bookedBy: null, state: "waiting" });
    expect(planner.dayToIso(field!.readyDay + field!.waitingLimitDays)).toBe("2026-11-03");
    fieldId = field!.id;
    expect(sentTo(GURPREET, before)).toEqual([
      expect.objectContaining({
        type: "text",
        body: en.booked({
          village: "Balian",
          centre: "Balian Cooperative Society",
          acres: 4,
          readyDate: formatDate(planner.dayToIso(planner.today()), "en"),
          lastDay: formatDate("2026-11-03", "en"),
          token: `#${String(field!.token).padStart(3, "0")}`,
        }),
      }),
    ]);
    expect((await request(runtime.app).get("/operator/board").set(operator).expect(200)).body.newRequests).toBe(requestsBefore + 1);

    // The same Confirm twice books nothing more.
    await runtime.deliver(messageBody({ from: from(GURPREET), button: confirmId }));
    expect(sentTo(GURPREET).at(-1)).toMatchObject({ type: "text", body: en.expired });
    expect(await store.listFieldsByPhone(GURPREET)).toHaveLength(1);
  });

  it("when the operator approves the plan, the farmer gets the date with a button that opens their slot", async () => {
    const operator = await operatorHeaders();
    const draft = operatorPlanSchema.parse((await request(runtime.app).post("/operator/plan/generate").set(operator).send({}).expect(200)).body);
    expect(draft.changes?.promised.map((item) => item.fieldId)).toContain(fieldId);
    const before = runtime.sender.sent.length;
    await request(runtime.app).post("/operator/plan/approve").set(operator).send({ version: draft.plan!.version }).expect(200);
    await runtime.runtime.dependencies.whatsapp.notifier.idle();
    const [notice] = sentTo(GURPREET, before);
    expect(notice).toMatchObject({ type: "template", name: "vaari_new_date", language: "en" });
    const token = notice?.type === "template" ? notice.urlButtonSuffix : null;
    expect(await verifySlotToken(runtime.runtime.dependencies.config, token!)).toMatchObject({ chcId: DEMO_CHC_ID, fieldId });
    await request(runtime.app).get(`/slot/${token}`).expect(200);
  });

  it("'Book a field' from the menu asks for the details when the model is on", async () => {
    await runtime.deliver(messageBody({ from: from(GURPREET), listRow: "menu:book" }));
    expect(sentTo(GURPREET).at(-1)).toMatchObject({ type: "text", body: en.bookAsk });
  });

  it("Cancel books nothing, and another phone cannot use the draft", async () => {
    runner.current = new ScriptedRunner(async (tool) => {
      await tool("book_field").run({ village: "Balian", acres: 2, moreDaysYouCanWait: 3 });
      return "";
    });
    await runtime.deliver(messageBody({ from: from(GURPREET), text: "2 more acres in Balian, 3 days" }));
    const confirm = sentTo(GURPREET).at(-1);
    const [confirmButton, cancelButton] = confirm?.type === "buttons" ? confirm.buttons : [];
    await runtime.deliver(messageBody({ from: from(DEMO_FARMER_PHONE), button: confirmButton!.id }));
    expect(sentTo(DEMO_FARMER_PHONE).at(-1)).toMatchObject({ type: "text", body: words("pa").expired });
    await runtime.deliver(messageBody({ from: from(GURPREET), button: cancelButton!.id }));
    expect(sentTo(GURPREET).at(-1)).toMatchObject({ type: "text", body: en.cancelled });
    await runtime.deliver(messageBody({ from: from(GURPREET), button: confirmButton!.id }));
    expect(sentTo(GURPREET).at(-1)).toMatchObject({ type: "text", body: en.expired });
    expect(await runtime.runtime.dependencies.store.listFieldsByPhone(GURPREET)).toHaveLength(1);
  });
});

describe("book_field: code decides the village, the year and the days", () => {
  const session = (phone: string) => new FarmerSession(runtime.runtime.dependencies, { kind: "farmerPhone", phone }, "en");
  const book = async (phone: string, input: Record<string, unknown>) => {
    const farmer = session(phone);
    const output = await farmer.tool("book_field").run(input);
    return { output, pending: farmer.pending };
  };

  it("with no village named, uses the farmer's own village; 'N more days' counts from today once harvested", async () => {
    const { planner } = runtime.runtime.dependencies;
    const { output, pending } = await book(DEMO_FARMER_PHONE, { acres: 3, moreDaysYouCanWait: 4 });
    expect(output).toMatchObject({ needsConfirmation: true, village: "Balian", acres: 3, readyDate: planner.dayToIso(planner.today()), lastDay: planner.dayToIso(planner.today() + 4), waitingDays: 4 });
    expect(pending).toEqual([expect.objectContaining({ kind: "confirmBooking" })]);
  });

  it("a close spelling finds the village; an unknown one is an error and drafts nothing", async () => {
    expect((await book(DEMO_FARMER_PHONE, { village: "balyan", acres: 2, moreDaysYouCanWait: 3 })).output).toMatchObject({ village: "Balian" });
    const unknown = await book(DEMO_FARMER_PHONE, { village: "Atlantis", acres: 2, moreDaysYouCanWait: 3 });
    expect(unknown.output).toMatchObject({ error: expect.stringMatching(/no machine centre serves/) });
    expect(unknown.pending).toEqual([]);
  });

  it("a harvest day in the future: the wait counts from the harvest, in the season's year", async () => {
    const { output } = await book(DEMO_FARMER_PHONE, { village: "Balian", acres: 2, harvestReady: { day: 2, month: 11 }, moreDaysYouCanWait: 3 });
    expect(output).toMatchObject({ readyDate: "2026-11-02", lastDay: "2026-11-05", waitingDays: 3 });
  });

  it("refuses impossible or out-of-range days, and a missing last day, without drafting", async () => {
    const cases = [
      { lastDayYouCanWait: { day: 31, month: 11 } }, // no such day
      { lastDayYouCanWait: { day: 30, month: 10 } }, // already past
      { harvestReady: { day: 1, month: 11 }, lastDayYouCanWait: { day: 30, month: 11 } }, // 29 days
      {}, // how long can they wait?
    ];
    for (const extra of cases) {
      const { output, pending } = await book(DEMO_FARMER_PHONE, { village: "Balian", acres: 2, ...extra });
      expect(typeof output.error, JSON.stringify(extra)).toBe("string");
      expect(pending).toEqual([]);
    }
  });

  it("a phone with no account and no booking cannot book", async () => {
    const { output, pending } = await book("+447700900995", { village: "Balian", acres: 2, moreDaysYouCanWait: 3 });
    expect(output).toEqual({ problem: "notAllowed", error: "this number is not registered", understood: { village: "Balian", acres: 2 } });
    expect(pending).toEqual([]);
  });

  it("an empty village or zero acres from the model means 'not said', not a failed booking", async () => {
    expect((await book(DEMO_FARMER_PHONE, { village: "", acres: 0 })).output).toMatchObject({ problem: "missingDetails", missing: ["village", "acres", "lastDay"] });
    expect((await book(DEMO_FARMER_PHONE, { village: "", acres: 3 })).output).toMatchObject({ problem: "missingDetails", missing: ["lastDay"] });
  });

  it.each([
    ["बालियां", "Balian"],
    ["ਬਾਲੀਆਂ", "Balian"],
    ["ढंडीवाल", "Dhandiwal"],
    ["भैणी महाराज", "Bhaini Mahraj"],
    ["कट्टू", "Kattu"],
  ])("finds a village said or written in Hindi or Punjabi: %s -> %s", async (named, village) => {
    expect((await book(DEMO_FARMER_PHONE, { village: named, acres: 2, moreDaysYouCanWait: 3 })).output).toMatchObject({ needsConfirmation: true, village });
  });
});

describe("a booking a piece at a time: code asks for exactly what is still missing", () => {
  const KULDEEP = "+447700900993"; // registered on the web in English, no field yet
  const hi = words("hi");

  beforeAll(async () => {
    await createFarmerAccount(runtime.runtime.dependencies.store, KULDEEP, "Kuldeep Singh", "en");
  });

  /** One message from Kuldeep, with the model doing `script`; returns what Vaari sent back. */
  const say = async (text: string, script: ConstructorParameters<typeof ScriptedRunner>[0]) => {
    runner.current = new ScriptedRunner(script);
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: from(KULDEEP), text }));
    return sentTo(KULDEEP, before);
  };

  it("'मुझे खेत बुक करना है', no details yet: the booking prompt from code, in Hindi, not the model's question", async () => {
    // The model's own question carries example numbers, which the number check would refuse.
    const sent = await say("मुझे खेत बुक करना है", async (tool) => (await tool("book_field").run({}), "जैसे: 4 एकड़, 3 नवंबर तक। अपना गाँव बताइए।"));
    expect(sent).toEqual([expect.objectContaining({ type: "text", body: hi.bookAsk })]);
  });

  it("then 'बालियां में 4 एकड़': the village (in Devanagari) and the acres are kept; only the last day is asked for", async () => {
    const sent = await say("बालियां में 4 एकड़", async (tool) => (await tool("book_field").run({ village: "बालियां", acres: 4 }), ""));
    expect(sent).toEqual([expect.objectContaining({ type: "text", body: hi.bookNeeds(hi.bookDetail.lastDay) })]);
  });

  it("then '3 नवंबर तक': everything is there, so Confirm shows all of it; nothing is booked yet", async () => {
    const { store, planner } = runtime.runtime.dependencies;
    const sent = await say("3 नवंबर तक", async (tool) => (await tool("book_field").run({ lastDayYouCanWait: { day: 3, month: 11 } }), ""));
    expect(sent.map((message) => message.type)).toEqual(["buttons"]);
    const today = planner.dayToIso(planner.today());
    expect(sent[0]).toMatchObject({
      body: hi.bookConfirmBody({ village: "Balian", centre: "Balian Cooperative Society", acres: 4, readyDate: formatDate(today, "hi"), lastDay: formatDate("2026-11-03", "hi") }),
    });
    expect(await store.listFieldsByPhone(KULDEEP)).toEqual([]);
  });

  it("after a draft the next booking starts from nothing", async () => {
    const sent = await say("2 एकड़ और", async (tool) => (await tool("book_field").run({ acres: 2 }), ""));
    expect(sent).toEqual([expect.objectContaining({ body: hi.bookNeeds(`${hi.bookDetail.village}, ${hi.bookDetail.lastDay}`) })]);
  });

  it("a village no centre serves is named in the reply and forgotten; the acres are kept", async () => {
    expect(await say("Atlantis", async (tool) => (await tool("book_field").run({ village: "Atlantis" }), ""))).toEqual([
      expect.objectContaining({ body: hi.bookUnknownVillage("Atlantis") }),
    ]);
    expect(await say("3 नवंबर तक", async (tool) => (await tool("book_field").run({ lastDayYouCanWait: { day: 3, month: 11 } }), ""))).toEqual([
      expect.objectContaining({ body: hi.bookNeeds(hi.bookDetail.village) }),
    ]);
  });

  it("a last day that does not work: the rule, and only the day is asked for again", async () => {
    expect(await say("Balian, 30 नवंबर तक", async (tool) => (await tool("book_field").run({ village: "Balian", lastDayYouCanWait: { day: 30, month: 11 } }), ""))).toEqual([
      expect.objectContaining({ body: hi.bookBadDay(MAX_WAIT_DAYS) }),
    ]);
    expect(await say("2 एकड़", async (tool) => (await tool("book_field").run({ acres: 2 }), ""))).toEqual([
      expect.objectContaining({ body: hi.bookNeeds(hi.bookDetail.lastDay) }),
    ]);
  });

  it("tapping 'Book a field' starts again from nothing", async () => {
    runner.current = new ScriptedRunner(async () => "");
    await runtime.deliver(messageBody({ from: from(KULDEEP), listRow: "menu:book", title: hi.menuBook }));
    expect(sentTo(KULDEEP).at(-1)).toMatchObject({ type: "text", body: hi.bookAsk });
    expect(await say("3 नवंबर तक", async (tool) => (await tool("book_field").run({ lastDayYouCanWait: { day: 3, month: 11 } }), ""))).toEqual([
      expect.objectContaining({ body: hi.bookNeeds(`${hi.bookDetail.village}, ${hi.bookDetail.acres}`) }),
    ]);
  });

  it("what was said is forgotten after 15 quiet minutes", async () => {
    runtime.clock.now = new Date(runtime.clock.now.getTime() + 16 * 60_000);
    expect(await say("Balian", async (tool) => (await tool("book_field").run({ village: "Balian" }), ""))).toEqual([
      expect.objectContaining({ body: hi.bookNeeds(`${hi.bookDetail.acres}, ${hi.bookDetail.lastDay}`) }),
    ]);
  });
});
