/**
 * Outbound notices after an approval: a utility template to every field with a phone AND consent,
 * never to a demo farmer's phone (a demo account), nothing with WhatsApp off. Each send is
 * recorded (last 4 digits only) and its delivery status follows the status webhooks.
 */
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { bookingSchema, operatorPlanSchema } from "../src/shared";
import { verifySlotToken } from "../src/auth/slot-token";
import { createNotifier } from "../src/whatsapp/notices";
import { RecordingSender } from "../src/whatsapp/sender";
import { bookingInput } from "./helpers";
import { statusBody, whatsappRuntime } from "./whatsapp-helpers";

const TEMPLATES = { WHATSAPP_TEMPLATE_NEW_DATE: "vaari_new_date", WHATSAPP_TEMPLATE_FIRM_DATE: "vaari_firm_date", WHATSAPP_TEMPLATE_DATE_CHANGED: "vaari_date_changed" };
const CONSENTED = "+447700900101"; // consented
const CONSENTED_TOO = "+447700900102"; // consented as well
const NO_CONSENT = "+447700900103"; // a phone without consent

let runtime: Awaited<ReturnType<typeof whatsappRuntime>>;
const fieldIds: Record<string, string> = {};

beforeAll(async () => {
  runtime = await whatsappRuntime({ config: { ...TEMPLATES } });
  const { app } = runtime;
  const token = async (role: string) => (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken as string;
  const facilitator = { authorization: `Bearer ${await token("facilitator")}` };
  const villageId = (await request(app).get("/villages").set(facilitator).expect(200)).body[0].id;
  for (const phone of [CONSENTED, CONSENTED_TOO]) {
    const booking = bookingSchema.parse((await request(app).post("/fields").set(facilitator).send(bookingInput(villageId, { farmerPhone: phone, acres: 1, readyDate: "2026-11-01" })).expect(201)).body);
    fieldIds[phone] = booking.field.id;
  }
  // A field that has a phone but no consent (written directly: the API refuses such a booking).
  const { store } = runtime.runtime.dependencies;
  const seeded = (await store.getField(DEMO_CHC_ID, "f-sim-02"))!;
  // Ready today, so the plan has room for it whatever the demo clock says.
  const today = runtime.runtime.dependencies.planner.today();
  await store.putField({ ...seeded, id: "f-no-consent", token: 900, readyDay: today, farmerPhone: NO_CONSENT, consentAt: null, consentBy: null, plannedDay: null, state: "waiting", createdAt: new Date().toISOString() });
  fieldIds[NO_CONSENT] = "f-no-consent";

  const operator = { authorization: `Bearer ${await token("operator")}` };
  const draft = operatorPlanSchema.parse((await request(app).post("/operator/plan/generate").set(operator).send({}).expect(200)).body);
  expect(draft.changes?.promised.map((item) => item.fieldId)).toEqual(expect.arrayContaining(Object.values(fieldIds)));
  await request(app).post("/operator/plan/approve").set(operator).send({ version: draft.plan!.version }).expect(200);
  await runtime.runtime.dependencies.whatsapp.notifier.idle();
});

const templatesTo = (phone: string) => runtime.sender.sent.filter((message) => message.type === "template" && message.to === phone);

describe("outbound notices", () => {
  it("go to every consented number, and never to one without consent", () => {
    expect(templatesTo(CONSENTED)).toHaveLength(1);
    expect(templatesTo(CONSENTED_TOO)).toHaveLength(1);
    expect(templatesTo(NO_CONSENT)).toHaveLength(0);
    const recipients = new Set(runtime.sender.sent.filter((message) => message.type === "template").map((message) => message.to));
    expect([...recipients].sort()).toEqual([CONSENTED, CONSENTED_TOO]);
  });

  it("never go to a demo farmer's phone, even with consent (a demo account anyone may use)", async () => {
    const deps = runtime.runtime.dependencies;
    const [demoField] = await deps.store.listFieldsByPhone(DEMO_FARMER_PHONE);
    expect(demoField?.consentAt).toBeTruthy();
    const sender = new RecordingSender();
    const notifier = createNotifier({ ...deps, sender });
    notifier.planPublished(DEMO_CHC_ID, { promised: [{ fieldId: demoField!.id, promise: { kind: "firm" as const, day: 31 } }], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] });
    await notifier.idle();
    expect(sender.sent).toHaveLength(0);
  });

  it("use the utility template for a first date, with the date and the slot page's own sentence in the farmer's language", () => {
    const [notice] = templatesTo(CONSENTED);
    expect(notice).toMatchObject({ type: "template", name: "vaari_new_date", language: "pa" });
    const parameters = notice?.type === "template" ? notice.parameters : [];
    expect(parameters).toHaveLength(2);
    expect(parameters.every((text) => text.length > 0)).toBe(true);
  });

  it("carry the field's own slot link in the template's URL button, and the link opens that field", async () => {
    const [notice] = templatesTo(CONSENTED);
    const suffix = notice?.type === "template" ? notice.urlButtonSuffix : null;
    expect(suffix).toBeTruthy();
    const claims = await verifySlotToken(runtime.runtime.dependencies.config, suffix!);
    expect(claims).toMatchObject({ chcId: DEMO_CHC_ID, fieldId: fieldIds[CONSENTED] });
    await request(runtime.app).get(`/slot/${suffix}`).expect(200);
  });

  it("with WHATSAPP_TEMPLATE_SLOT_BUTTON=false, templates go out without the button parameter", async () => {
    const { dependencies } = runtime.runtime;
    const sender = new RecordingSender();
    const notifier = createNotifier({ ...dependencies, config: { ...dependencies.config, WHATSAPP_TEMPLATE_SLOT_BUTTON: false }, sender });
    notifier.planPublished(DEMO_CHC_ID, {
      promised: [{ fieldId: fieldIds[CONSENTED]!, promise: { kind: "firm" as const, day: 31 } }],
      firmed: [],
      moved: [],
      broken: [],
      rePromised: [],
      unplaced: [],
    });
    await notifier.idle();
    expect(sender.sent).toEqual([expect.objectContaining({ type: "template", urlButtonSuffix: null })]);
  });

  it("record each send with the last 4 digits only, and follow delivery statuses forward in time", async () => {
    const [notice] = templatesTo(CONSENTED);
    const { store } = runtime.runtime.dependencies;
    const record = await store.getOutboundNotice(notice!.id);
    expect(record).toMatchObject({ messageId: notice!.id, phoneLast4: "0101", kind: "new_date", chcId: DEMO_CHC_ID, fieldId: fieldIds[CONSENTED], status: "accepted" });
    expect(JSON.stringify(record)).not.toContain("447700900101");
    const seconds = Math.floor(Date.now() / 1000) + 60;
    await runtime.deliver(statusBody(notice!.id, "delivered", seconds));
    expect((await store.getOutboundNotice(notice!.id))?.status).toBe("delivered");
    // A "sent" status that arrives late (older timestamp) does not go backwards.
    await runtime.deliver(statusBody(notice!.id, "sent", seconds - 30));
    expect((await store.getOutboundNotice(notice!.id))?.status).toBe("delivered");
    await runtime.deliver(statusBody(notice!.id, "read", seconds + 30));
    expect((await store.getOutboundNotice(notice!.id))?.status).toBe("read");
    // A status for a message we never sent changes nothing and breaks nothing.
    await runtime.deliver(statusBody("wamid.someone-else", "delivered", seconds));
  });

  it("send nothing when WhatsApp is off, and record a failed send", async () => {
    const deps = runtime.runtime.dependencies;
    const off = new RecordingSender();
    const silent = createNotifier({ ...deps, config: { ...deps.config, WHATSAPP_ENABLED: false }, sender: off });
    const changes = { promised: [{ fieldId: fieldIds[CONSENTED]!, promise: { kind: "firm" as const, day: 31 } }], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] };
    silent.planPublished(DEMO_CHC_ID, changes);
    await silent.idle();
    expect(off.sent).toHaveLength(0);

    const broken = new RecordingSender();
    broken.failing = true;
    const recorded = vi.spyOn(deps.store, "putOutboundNotice");
    const failing = createNotifier({ ...deps, sender: broken });
    failing.planPublished(DEMO_CHC_ID, changes);
    await failing.idle();
    // The failure is recorded (status failed, a local id); nothing throws into the approval.
    expect(recorded).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: expect.stringMatching(/^local-/), status: "failed", phoneLast4: "0101" }));
    recorded.mockRestore();
  });
});
