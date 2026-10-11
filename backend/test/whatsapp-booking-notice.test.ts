/**
 * The notice after a booking: the farmer hears on WhatsApp at once that the request is in, with the
 * field's slot link (the new_date template with "no date yet" and the slot page's own sentence).
 * DEMO_FARMER_PHONES=* (every phone a demo account) still lets WHATSAPP_ALLOWED_TEST_NUMBERS through.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { verifySlotToken } from "../src/auth/slot-token";
import { bookingSchema } from "../src/shared";
import { promiseWords } from "../src/whatsapp/messages";
import { createNotifier } from "../src/whatsapp/notices";
import { RecordingSender } from "../src/whatsapp/sender";
import { bookingInput } from "./helpers";
import { whatsappRuntime } from "./whatsapp-helpers";

const TEMPLATES = { WHATSAPP_TEMPLATE_NEW_DATE: "vaari_new_date", WHATSAPP_TEMPLATE_FIRM_DATE: "vaari_firm_date", WHATSAPP_TEMPLATE_DATE_CHANGED: "vaari_date_changed" };
const TEAM_PHONE = "+447700900111"; // on the test-recipient list
const OTHER_PHONE = "+447700900112";

let runtime: Awaited<ReturnType<typeof whatsappRuntime>>;
const fieldIds: Record<string, string> = {};

beforeAll(async () => {
  runtime = await whatsappRuntime({ config: { ...TEMPLATES } });
  const { app } = runtime;
  const facilitator = { authorization: `Bearer ${(await request(app).post("/auth/demo").send({ role: "facilitator" }).expect(200)).body.accessToken as string}` };
  const villageId = (await request(app).get("/villages").set(facilitator).expect(200)).body[0].id;
  for (const phone of [TEAM_PHONE, OTHER_PHONE]) {
    const booking = bookingSchema.parse((await request(app).post("/fields").set(facilitator).send(bookingInput(villageId, { farmerPhone: phone, acres: 1, readyDate: "2026-11-01" })).expect(201)).body);
    fieldIds[phone] = booking.field.id;
  }
  await runtime.runtime.dependencies.whatsapp.notifier.idle();
});

const templatesTo = (phone: string) => runtime.sender.sent.filter((message) => message.type === "template" && message.to === phone);

describe("the notice after a helper's booking", () => {
  it("tells the farmer at once that the request is in: no date yet, the slot page's sentence, and the slot link", async () => {
    expect(templatesTo(TEAM_PHONE)).toHaveLength(1);
    const [notice] = templatesTo(TEAM_PHONE);
    expect(notice).toMatchObject({ type: "template", name: "vaari_new_date", language: "pa" });
    const parameters = notice?.type === "template" ? notice.parameters : [];
    expect(parameters[0]).toBe(promiseWords(null, "pa"));
    expect(parameters[1]?.length).toBeGreaterThan(0);
    const suffix = notice?.type === "template" ? notice.urlButtonSuffix : null;
    const claims = await verifySlotToken(runtime.runtime.dependencies.config, suffix!);
    expect(claims).toMatchObject({ chcId: DEMO_CHC_ID, fieldId: fieldIds[TEAM_PHONE] });
    await request(runtime.app).get(`/slot/${suffix}`).expect(200);
    const record = await runtime.runtime.dependencies.store.getOutboundNotice(notice!.id);
    expect(record).toMatchObject({ kind: "booked", phoneLast4: "0111", status: "accepted" });
  });

  it("with DEMO_FARMER_PHONES=* goes only to WHATSAPP_ALLOWED_TEST_NUMBERS (the team's own phones)", async () => {
    const { dependencies } = runtime.runtime;
    const sender = new RecordingSender();
    // Written the way Meta's test-recipient list shows it (no "+"): still the same phone.
    const config = { ...dependencies.config, DEMO_FARMER_PHONES: "*", WHATSAPP_ALLOWED_TEST_NUMBERS: "447700900111" };
    const notifier = createNotifier({ ...dependencies, config, sender });
    notifier.fieldBooked((await dependencies.store.getField(DEMO_CHC_ID, fieldIds[TEAM_PHONE]!))!);
    notifier.fieldBooked((await dependencies.store.getField(DEMO_CHC_ID, fieldIds[OTHER_PHONE]!))!);
    await notifier.idle();
    expect(sender.sent.map((message) => message.to)).toEqual([TEAM_PHONE]);
  });

  it("with DEMO_FARMER_PHONES=* and no test numbers, nobody is messaged", async () => {
    const { dependencies } = runtime.runtime;
    const sender = new RecordingSender();
    const notifier = createNotifier({ ...dependencies, config: { ...dependencies.config, DEMO_FARMER_PHONES: "*" }, sender });
    notifier.fieldBooked((await dependencies.store.getField(DEMO_CHC_ID, fieldIds[TEAM_PHONE]!))!);
    await notifier.idle();
    expect(sender.sent).toHaveLength(0);
  });
});
