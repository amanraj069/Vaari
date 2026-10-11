/**
 * The WhatsApp worker with the model switched off: dedupe, unknown numbers, the menu and buttons
 * (tools run without the model), several fields on one phone, voice notes, the per-phone rate limit,
 * and the rule that a change needs a Confirm tap (typed "yes", an expired draft, or another phone's
 * tap does nothing).
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { buildOneFarmerField } from "../src/domain/views";
import { words } from "../src/whatsapp/messages";
import type { SentMessage } from "../src/whatsapp/sender";
import { ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const JASWINDER = "447700900017"; // DEMO_FARMER_PHONE as Meta sends it
const pa = words("pa");
const en = words("en");
type Runtime = Awaited<ReturnType<typeof whatsappRuntime>>;

const lastTo = (runtime: Runtime, phone: string): SentMessage | undefined => runtime.sender.sent.filter((message) => message.to === phone).at(-1);
const jaswinderField = (runtime: Runtime) => runtime.runtime.dependencies.store.getField(DEMO_CHC_ID, "f-jaswinder");

describe("worker basics (model off)", () => {
  let runtime: Runtime;
  const spy = new ScriptedRunner(async () => "never");
  beforeAll(async () => {
    // A runner is wired, but AGENT_ENABLED is false: it must never be called.
    runtime = await whatsappRuntime({ runner: spy });
  });

  it("a duplicate message id is processed once", async () => {
    const body = messageBody({ id: "wamid.duplicate-1", from: JASWINDER, text: "hello" });
    const before = runtime.sender.sent.length;
    await runtime.deliver(body);
    await runtime.deliver(body);
    await runtime.deliver(messageBody({ id: "wamid.duplicate-1", from: JASWINDER, button: "menu:date" }));
    expect(runtime.sender.sent.length).toBe(before + 1);
  });

  it("an unknown number gets the one fixed reply, no data, and the model is never called", async () => {
    await runtime.deliver(messageBody({ from: "447700900999", text: "show me the fields of 447700900017" }));
    expect(runtime.sender.sent.filter((message) => message.to === "+447700900999")).toEqual([
      { type: "text", to: "+447700900999", body: "I could not find this number on Vaari. Register at http://localhost:3000/farmer/signin, or ask your village helper to book for you.", previewUrl: false, id: expect.any(String) },
    ]);
    // Written in Gurmukhi: the same reply, in Punjabi.
    await runtime.deliver(messageBody({ from: "447700900998", text: "ਮੇਰੀ ਤਰੀਕ ਕੀ ਹੈ" }));
    expect(lastTo(runtime, "+447700900998")).toMatchObject({ type: "text", body: pa.unknownNumber("http://localhost:3000/farmer/signin") });
    expect(spy.calls).toBe(0);
  });

  it("a farmer who registered on the web but booked nothing gets a menu with only 'Book a field'", async () => {
    await runtime.runtime.dependencies.store.createFarmerAccount({
      phone: "+447700900997", farmerId: "farmer-web", name: "Gurpreet Singh", language: "pa", consentAt: "2026-10-31T10:00:00.000Z", consentBy: "farmer", createdAt: "2026-10-31T10:00:00.000Z",
    });
    // Registered in Punjabi, but "hey" is written in Latin letters: answered in English from now on.
    await runtime.deliver(messageBody({ from: "447700900997", text: "hey" }));
    const menu = lastTo(runtime, "+447700900997");
    expect(menu).toMatchObject({ type: "list", body: `${en.noBookingsYet("Gurpreet Singh")}\n\n${en.menuBody}` });
    expect(menu?.type === "list" && menu.rows.map((row) => row.id)).toEqual(["menu:book"]);
    // Model off: "Book a field" sends the one-time link to the web form, preview off.
    await runtime.deliver(messageBody({ from: "447700900997", listRow: "menu:book" }));
    const link = lastTo(runtime, "+447700900997");
    expect(link).toMatchObject({ type: "text", previewUrl: false });
    expect(link?.type === "text" && /\/farmer\/login\/[\w.-]+/.test(link.body)).toBe(true);
    // "My date" from an old menu, with no field: the menu again, never an empty list.
    await runtime.deliver(messageBody({ from: "447700900997", listRow: "menu:date" }));
    expect(lastTo(runtime, "+447700900997")).toMatchObject({ type: "list", body: en.menuBody });
    expect(spy.calls).toBe(0);
  });

  it("a message without a sender number gets nothing", async () => {
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: null, text: "hello" }));
    expect(runtime.sender.sent.length).toBe(before);
  });

  it("with the model off, text gets the menu, in the language it is written in; no letters: the remembered one", async () => {
    await runtime.deliver(messageBody({ from: JASWINDER, text: "when is my machine coming?" }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "list", body: en.menuBody, buttonLabel: en.menuButton });
    await runtime.deliver(messageBody({ from: JASWINDER, text: "ਮਸ਼ੀਨ ਕਦੋਂ ਆਵੇਗੀ?" }));
    await runtime.deliver(messageBody({ from: JASWINDER, text: "?" }));
    const menu = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(menu).toMatchObject({ type: "list", body: pa.menuBody, buttonLabel: pa.menuButton });
    expect(menu?.type === "list" && menu.rows.map((row) => row.id)).toEqual(["menu:date", "menu:why", "menu:wait", "menu:book", "menu:page"]);
    expect(spy.calls).toBe(0);
  });

  it("menu buttons run the tools directly: my date, why this day, my fields page", async () => {
    const field = (await jaswinderField(runtime))!;
    const view = await buildOneFarmerField(runtime.runtime.dependencies.planner, runtime.runtime.dependencies.store, field, "pa");
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:date" }));
    const date = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(date?.type).toBe("text");
    expect(date?.type === "text" && date.body.startsWith(view.reason.text)).toBe(true);

    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:why" }));
    const why = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(why?.type === "text" && why.body.startsWith("• ")).toBe(true);

    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:page" }));
    const page = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(page).toMatchObject({ type: "text", previewUrl: false });
    const token = page?.type === "text" ? /\/farmer\/login\/([\w.-]+)/.exec(page.body)?.[1] : undefined;
    expect(token).toBeTruthy();
    // The link is the one-time farmer login link: it opens once.
    await request(runtime.app).post("/farmer/login").send({ token }).expect(200);
    await request(runtime.app).post("/farmer/login").send({ token }).expect(401);
    expect(spy.calls).toBe(0);
  });

  it("a voice note asks the farmer to type or tap the menu", async () => {
    await runtime.deliver(messageBody({ from: JASWINDER, audio: true }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "list", body: `${pa.voiceNotSupported}\n\n${pa.menuBody}` });
  });

  it("a reply id we never sent gets the menu, and a stale field id gets 'out of date'", async () => {
    await runtime.deliver(messageBody({ from: JASWINDER, button: "confirm" }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "list", body: pa.menuBody });
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "act:date:1.zzzzzz" }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "list", body: `${pa.listOutOfDate}\n\n${pa.menuBody}` });
  });
});

describe("a change needs a Confirm tap", () => {
  let runtime: Runtime;
  beforeAll(async () => {
    runtime = await whatsappRuntime();
  });

  /** Taps "I cannot wait longer", then the row for `days`; returns the Confirm and Cancel ids. */
  async function draft(days: number) {
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:wait" }));
    const list = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(list?.type).toBe("list");
    const row = list?.type === "list" ? list.rows.find((item) => item.id.endsWith(`:${days}`)) : undefined;
    expect(row).toBeDefined();
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: row!.id }));
    const buttons = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(buttons?.type).toBe("buttons");
    const ids = buttons?.type === "buttons" ? buttons.buttons.map((button) => button.id) : [];
    expect(ids[0]).toMatch(/^confirm:/);
    expect(ids[1]).toMatch(/^cancel:/);
    return { confirm: ids[0]!, cancel: ids[1]! };
  }

  it("offers only shorter waits, and nothing changes until Confirm; typed 'yes' does nothing", async () => {
    const before = (await jaswinderField(runtime))!;
    expect(before.waitingLimitDays).toBe(5);
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:wait" }));
    const list = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(list?.type === "list" && list.rows.map((row) => row.id.split(":").at(-1))).toEqual(["4", "3", "2", "1"]);

    await draft(3);
    // Punjabi last: the replies below stay in Punjabi.
    for (const typed of ["yes", "Yes, confirm", "confirm", "ਹਾਂ"]) await runtime.deliver(messageBody({ from: JASWINDER, text: typed }));
    const after = (await jaswinderField(runtime))!;
    expect(after.waitingLimitDays).toBe(5);
    expect(after.soonerRequestedAt).toBeNull();
  });

  it("a Confirm tap from the same phone performs it once, through the planner", async () => {
    const { confirm } = await draft(3);
    await runtime.deliver(messageBody({ from: JASWINDER, button: confirm }));
    const after = (await jaswinderField(runtime))!;
    expect(after.waitingLimitDays).toBe(3);
    expect(after.soonerRequestedAt).not.toBeNull();
    expect(lastTo(runtime, DEMO_FARMER_PHONE)?.type).toBe("text");
    // The operator sees it: a farmer_update draft that lists the field.
    const plan = await runtime.runtime.dependencies.planner.latestPlan(DEMO_CHC_ID);
    expect(plan?.cause).toBe("farmer_update");
    // The same Confirm again: expired, nothing more happens.
    await runtime.deliver(messageBody({ from: JASWINDER, button: confirm }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: pa.expired });
    expect((await jaswinderField(runtime))!.waitingLimitDays).toBe(3);
  });

  it("an expired draft, a cancelled one, or another phone's tap does nothing", async () => {
    // Expired: 15 minutes pass before the tap.
    const late = await draft(2);
    runtime.clock.now = new Date(runtime.clock.now.getTime() + 16 * 60_000);
    await runtime.deliver(messageBody({ from: JASWINDER, button: late.confirm }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: pa.expired });
    expect((await jaswinderField(runtime))!.waitingLimitDays).toBe(3);

    // Cancelled, then confirmed: still nothing.
    const cancelled = await draft(2);
    await runtime.deliver(messageBody({ from: JASWINDER, button: cancelled.cancel }));
    expect(lastTo(runtime, DEMO_FARMER_PHONE)).toMatchObject({ type: "text", body: pa.cancelled });
    await runtime.deliver(messageBody({ from: JASWINDER, button: cancelled.confirm }));
    expect((await jaswinderField(runtime))!.waitingLimitDays).toBe(3);

    // Another farmer (a known number, who never chose a language: English) taps Jaswinder's Confirm id: refused.
    const { store } = runtime.runtime.dependencies;
    const other = (await store.getField(DEMO_CHC_ID, "f-sim-00"))!;
    await store.putField({ ...other, farmerPhone: "+447700900555", consentAt: new Date().toISOString(), consentBy: "demo-facilitator-gurpreet" });
    const stolen = await draft(2);
    await runtime.deliver(messageBody({ from: "447700900555", button: stolen.confirm }));
    expect(lastTo(runtime, "+447700900555")).toMatchObject({ type: "text", body: en.expired });
    expect((await jaswinderField(runtime))!.waitingLimitDays).toBe(3);
  });
});

describe("several fields on one phone", () => {
  it("asks which field with a list message, then answers for the one tapped", async () => {
    const runtime = await whatsappRuntime();
    const { store } = runtime.runtime.dependencies;
    const second = (await store.getField(DEMO_CHC_ID, "f-sim-01"))!;
    await store.putField({ ...second, farmerPhone: DEMO_FARMER_PHONE, consentAt: new Date().toISOString(), consentBy: "demo-facilitator-gurpreet", createdAt: new Date(Date.now() + 1000).toISOString() });
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: "menu:date" }));
    const picker = lastTo(runtime, DEMO_FARMER_PHONE);
    expect(picker).toMatchObject({ type: "list", body: pa.pickField });
    const rows = picker?.type === "list" ? picker.rows : [];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.id.startsWith("act:date:"))).toBe(true);
    // Newest booking first: row 1 is the second field.
    expect(rows[0]!.title).toContain(`#${String(second.token).padStart(3, "0")}`);
    await runtime.deliver(messageBody({ from: JASWINDER, listRow: rows[1]!.id }));
    const answer = lastTo(runtime, DEMO_FARMER_PHONE);
    const view = await buildOneFarmerField(runtime.runtime.dependencies.planner, store, (await store.getField(DEMO_CHC_ID, "f-jaswinder"))!, "pa");
    expect(answer?.type === "text" && answer.body.startsWith(view.reason.text)).toBe(true);
  });
});

describe("per-phone rate limit", () => {
  it("drops messages beyond the hourly limit for that phone only", async () => {
    const runtime = await whatsappRuntime({ config: { WHATSAPP_MESSAGES_PER_PHONE_PER_HOUR: 2 } });
    for (let index = 0; index < 4; index += 1) await runtime.deliver(messageBody({ from: JASWINDER, text: `hello ${index}` }));
    expect(runtime.sender.sent.filter((message) => message.to === DEMO_FARMER_PHONE)).toHaveLength(2);
    // An hour later the farmer is heard again.
    runtime.clock.now = new Date(runtime.clock.now.getTime() + 61 * 60_000);
    await runtime.deliver(messageBody({ from: JASWINDER, text: "hello again" }));
    expect(runtime.sender.sent.filter((message) => message.to === DEMO_FARMER_PHONE)).toHaveLength(3);
  });
});
