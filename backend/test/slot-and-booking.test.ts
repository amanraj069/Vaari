/**
 * The routes behind /book and /slot/[token]. POST /fields: a facilitator books for a farmer with
 * the farmer's phone (stored as E.164) and consent, and gets a slot link. The slot opens without
 * sign-in and says where the turn stands in one sentence. A link names one field and its link
 * version: a tampered, expired or reissued-over link is 401. "I cannot wait longer" only shortens
 * the wait, keeps the operator's manual moves, marks the field for the operator, and the published
 * result is never later.
 */
import request from "supertest";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { mintSlotToken } from "../src/auth/slot-token";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { bookingSchema, farmerFieldSchema, operatorBoardSchema, operatorPlanSchema, slotLinkSchema, whySchema, type FarmerField } from "../src/shared";
import { bookingInput, testPhone } from "./helpers";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const tokens: Record<string, string> = {};
const bearer = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });
let villageId = "";

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator", "officer"]) {
    tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
  }
  villageId = (await request(app).get("/villages").set(bearer("facilitator")).expect(200)).body[0].id;
});

async function book(waitingLimitDays = 8, acres = 3, readyDate = "2026-11-02", phone = testPhone(301)) {
  const response = await request(app)
    .post("/fields")
    .set(bearer("facilitator"))
    .send(bookingInput(villageId, { waitingLimitDays, acres, readyDate, farmerPhone: phone }))
    .expect(201);
  return bookingSchema.parse(response.body);
}

/** The operator generates tomorrow's plan and publishes it. */
async function generateAndApprove() {
  const draft = operatorPlanSchema.parse((await request(app).post("/operator/plan/generate").set(bearer("operator")).send({}).expect(200)).body);
  await request(app).post("/operator/plan/approve").set(bearer("operator")).send({ version: draft.plan!.version }).expect(200);
  return draft;
}

const slot = async (token: string, lang = "en"): Promise<FarmerField> =>
  farmerFieldSchema.parse((await request(app).get(`/slot/${token}?lang=${lang}`).expect(200)).body);

describe("booking (POST /fields)", () => {
  it("a facilitator books with the farmer's phone and consent, gets the slot link, and sees it in their list", async () => {
    const booking = await book(8, 3, "2026-11-02", "098765 43210");
    expect(booking.slot.path).toBe(`/slot/${booking.slot.token}`);
    expect(booking.field.farmerName).toBe("Paramjit Kaur");
    expect(booking.field.status).toBe("requested");
    // Stored as E.164 with the consent the facilitator recorded, and never sent back.
    const stored = await runtime.dependencies.store.getField(DEMO_CHC_ID, booking.field.id);
    expect(stored).toMatchObject({ farmerPhone: "+919876543210", consentBy: "demo-facilitator-gurpreet", linkVersion: 1 });
    expect(stored?.consentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(booking)).not.toContain("9876543210");
    const list = await request(app).get("/facilitator/fields").set(bearer("facilitator")).expect(200);
    expect(list.body.items.map((item: { fieldId: string }) => item.fieldId)).toContain(booking.field.id);
    expect(JSON.stringify(list.body)).not.toContain("9876543210");
  });

  it("needs the farmer's name, a real phone number and their consent; operators and officers cannot book", async () => {
    const input = bookingInput(villageId, { farmerPhone: testPhone(302) });
    const post = (body: unknown) => request(app).post("/fields").set(bearer("facilitator")).send(body as object);
    expect((await post({ ...input, consent: false }).expect(400)).body.error).toBe("CONSENT_REQUIRED");
    expect((await post({ ...input, consent: undefined }).expect(400)).body.error).toBe("INVALID_REQUEST");
    for (const farmerPhone of ["12345", "+91 12345 67890", "phone", "", undefined]) {
      expect((await post({ ...input, farmerPhone }).expect(400)).body.error).toBe("INVALID_REQUEST");
    }
    expect((await post({ ...input, farmerName: undefined }).expect(400)).body.error).toBe("INVALID_REQUEST");
    await post({ ...input, waitingLimitDays: 40 }).expect(400);
    await request(app).post("/fields").set(bearer("operator")).send(input).expect(403);
    await request(app).post("/fields").set(bearer("officer")).send(input).expect(403);
  });
});

describe("slot link", () => {
  it("shows a request until a plan is published, then the date, place in the queue and a plain reason", async () => {
    const booking = await book(8, 1, "2026-10-31");
    const before = await slot(booking.slot.token, "pa");
    expect(before.status).toBe("requested");
    expect(before.promise).toBeNull();
    expect(before.queuePosition).toBeNull();
    expect(before.reason.code).toBe("requested");
    expect(before.reason.text).toContain("ਬੇਨਤੀ"); // Punjabi ("request")

    await generateAndApprove();
    const after = await slot(booking.slot.token);
    expect(["firm", "window"]).toContain(after.status);
    expect(after.queuePosition).toBe(after.fieldsAhead! + 1);
    if (after.status === "firm") {
      // A firm date names the machine and the stop.
      expect(after.reason.code).toBe("firm_route");
      expect(after.visit?.stop).toBeGreaterThan(0);
      expect(after.reason.text).toContain(after.visit!.machineName);
    } else {
      expect(after.reason.code).toBe("window");
    }
    const why = whySchema.parse((await request(app).get(`/slot/${booking.slot.token}/why?lang=pa`).expect(200)).body);
    expect(why.reasons.length).toBeGreaterThan(0);
  });

  it("answers 401 for a tampered link on every slot route", async () => {
    const booking = await book();
    const tampered = `${booking.slot.token.slice(0, -4)}AAAA`;
    await request(app).get(`/slot/${tampered}`).expect(401);
    await request(app).get(`/slot/${tampered}/why`).expect(401);
    await request(app).post(`/slot/${tampered}/waiting-limit`).send({ waitingLimitDays: 3 }).expect(401);
  });

  it("answers 401 for an expired link (7 days after the season ends)", async () => {
    const booking = await book();
    const field = (await runtime.dependencies.store.getField(DEMO_CHC_ID, booking.field.id))!;
    const expired = await mintSlotToken({ ...runtime.dependencies.config, SEASON_END_DATE: "2025-12-31" }, field);
    await request(app).get(`/slot/${expired}`).expect(401);
    await request(app).get(`/slot/${expired}/why`).expect(401);
    await request(app).post(`/slot/${expired}/waiting-limit`).send({ waitingLimitDays: 3 }).expect(401);
    // The same field with a current link opens.
    await request(app).get(`/slot/${await mintSlotToken(runtime.dependencies.config, field)}`).expect(200);
  });

  it("a link without a version, or signed with another secret, is refused", async () => {
    const booking = await book();
    const sign = (secret: string, claims: Record<string, unknown>) =>
      new SignJWT({ typ: "slot", chc: DEMO_CHC_ID, fld: booking.field.id, ...claims })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("vaari")
        .setAudience("vaari-slot")
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret));
    await request(app).get(`/slot/${await sign(runtime.dependencies.config.SLOT_TOKEN_SECRET, {})}`).expect(401);
    await request(app).get(`/slot/${await sign("another-secret-of-at-least-32-characters!", { ver: 1 })}`).expect(401);
    await request(app).get(`/slot/${await sign(runtime.dependencies.config.SLOT_TOKEN_SECRET, { ver: 1 })}`).expect(200);
  });

  it("a reissued link replaces the old one, which then answers 401 everywhere", async () => {
    const booking = await book();
    const reissued = slotLinkSchema.parse(
      (await request(app).post(`/fields/${booking.field.id}/slot-link/reissue`).set(bearer("facilitator")).expect(200)).body,
    );
    expect(reissued.token).not.toBe(booking.slot.token);
    await request(app).get(`/slot/${booking.slot.token}`).expect(401);
    await request(app).get(`/slot/${booking.slot.token}/why`).expect(401);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 3 }).expect(401);
    expect((await slot(reissued.token)).id).toBe(booking.field.id);
    // Copying the link again gives the current version, not the old one.
    const copied = slotLinkSchema.parse((await request(app).get(`/fields/${booking.field.id}/slot-link`).set(bearer("facilitator")).expect(200)).body);
    await request(app).get(`/slot/${copied.token}`).expect(200);
    // Officers may not reissue.
    await request(app).post(`/fields/${booking.field.id}/slot-link/reissue`).set(bearer("officer")).expect(403);
  });

  it("'I cannot wait longer' keeps the promise, makes a draft, and the published date is never later", async () => {
    const lastDay = (field: FarmerField) => (field.promise ? (field.promise.kind === "firm" ? field.promise.date : field.promise.endDate) : null);
    // A big field ready on 1 November in a full season: the earlier date is hard to find.
    const booking = await book(9, 10, "2026-11-01");
    await generateAndApprove();
    const before = await slot(booking.slot.token);
    expect(lastDay(before)).not.toBeNull();

    const updated = farmerFieldSchema.parse((await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 1 }).expect(200)).body);
    expect(updated.burnDeadlineDate).toBe("2026-11-02");
    expect(updated.soonerRequested).toBe(true);
    expect(updated.promise).toEqual(before.promise); // nothing changes for the farmer until the operator publishes
    const draft = operatorPlanSchema.parse((await request(app).get("/operator/plan").set(bearer("operator")).expect(200)).body);
    expect(draft.plan?.status).toBe("draft");
    expect(draft.plan?.cause).toBe("farmer_update");
    expect(draft.attention.map((item) => item.fieldId)).toContain(booking.field.id);

    await request(app).post("/operator/plan/approve").set(bearer("operator")).send({ version: draft.plan!.version }).expect(200);
    const after = await slot(booking.slot.token);
    expect(after.soonerRequested).toBe(false);
    expect(lastDay(after)! <= lastDay(before)!).toBe(true);
    // Published: the field no longer needs the operator's attention.
    const board = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer("operator")).expect(200)).body);
    expect(board.attention.map((item) => item.fieldId)).not.toContain(booking.field.id);
    // The demo season is full before 8 November, so the new last day cannot be met: the operator's
    // queue must show this field at burn risk rather than on track.
    if (lastDay(after)! > after.burnDeadlineDate) {
      const queue = await request(app).get("/operator/queue").set(bearer("operator")).expect(200);
      expect(queue.body.items.find((entry: { fieldId: string }) => entry.fieldId === after.id).risk).toBe("at_risk");
    }
  });

  it("'I cannot wait longer' keeps the operator's unpublished moves and flags the field on the board", async () => {
    const booking = await book(8, 2, "2026-11-01");
    const draft = operatorPlanSchema.parse((await request(app).post("/operator/plan/generate").set(bearer("operator")).send({}).expect(200)).body);
    // The operator moves another field by hand (a pin) and has not approved yet.
    const lane = draft.lanes.find((item) => !item.down && item.stops.some((stop) => !stop.stretch && stop.parts === 1 && stop.fieldId !== booking.field.id))!;
    const stop = lane.stops.find((item) => !item.stretch && item.parts === 1 && item.fieldId !== booking.field.id)!;
    const target = draft.lanes.find((item) => !item.down && item.machine.id !== lane.machine.id)!;
    const moved = operatorPlanSchema.parse(
      (await request(app).post("/operator/plan/move").set(bearer("operator")).send({ fieldId: stop.fieldId, machineId: target.machine.id, date: draft.plan!.planDate }).expect(200)).body,
    );
    expect(moved.pins.map((pin) => pin.fieldId)).toEqual([stop.fieldId]);

    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 5 }).expect(200);
    const after = operatorPlanSchema.parse((await request(app).get("/operator/plan").set(bearer("operator")).expect(200)).body);
    expect(after.plan?.version).toBe(moved.plan!.version + 1);
    expect(after.plan?.cause).toBe("farmer_update");
    // The operator's move is still there, on the same machine and day.
    expect(after.pins).toEqual(moved.pins);
    expect(after.lanes.find((item) => item.machine.id === target.machine.id)?.stops.map((item) => item.fieldId)).toContain(stop.fieldId);
    // And the farmer's field is listed for the operator's attention, with its new last day.
    const flagged = after.attention.find((item) => item.fieldId === booking.field.id);
    expect(flagged).toMatchObject({ token: booking.field.token, burnDeadlineDate: "2026-11-06" });
    const board = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer("operator")).expect(200)).body);
    expect(board.attention.map((item) => item.fieldId)).toContain(booking.field.id);
  });

  it("refuses to lengthen the waiting limit", async () => {
    const booking = await book(5);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 7 }).expect(409);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 5 }).expect(409);
  });
});
