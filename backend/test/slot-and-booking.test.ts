/**
 * The routes behind /book and /slot/[token]: a facilitator books for a farmer and gets a slot link;
 * the slot shows the backend's promise and reasons without sign-in; "I cannot wait longer" only
 * shortens the waiting limit and re-plans with every promise still hard; a tampered link is 401.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import { facilitatorBookingSchema, farmerFieldSchema, operatorBoardSchema, whySchema } from "../src/shared";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const bearer = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });

beforeAll(async () => {
  const runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "farmer", "operator"]) {
    tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
  }
});

async function book(waitingLimitDays = 8, acres = 3, readyDate = "2026-11-02") {
  const villages = await request(app).get("/villages").set(bearer("facilitator")).expect(200);
  const response = await request(app)
    .post("/facilitator/fields")
    .set(bearer("facilitator"))
    .send({ farmerName: "Paramjit Kaur", villageId: villages.body[0].id, acres, readyDate, waitingLimitDays })
    .expect(201);
  return facilitatorBookingSchema.parse(response.body);
}

describe("facilitator booking", () => {
  it("books a field for a farmer, returns a slot link, and lists it as theirs", async () => {
    const booking = await book();
    expect(booking.slot.path).toBe(`/slot/${booking.slot.token}`);
    expect(booking.field.farmerName).toBe("Paramjit Kaur");
    const list = await request(app).get("/facilitator/fields").set(bearer("facilitator")).expect(200);
    expect(list.body.items.map((item: { fieldId: string }) => item.fieldId)).toContain(booking.field.id);
  });

  it("is only for facilitators and keeps the waiting limit to 3-10 days", async () => {
    await request(app).post("/facilitator/fields").set(bearer("farmer")).send({}).expect(403);
    const villages = await request(app).get("/villages").set(bearer("facilitator")).expect(200);
    await request(app)
      .post("/facilitator/fields")
      .set(bearer("facilitator"))
      .send({ farmerName: "X", villageId: villages.body[0].id, acres: 2, readyDate: "2026-11-02", waitingLimitDays: 12 })
      .expect(400);
  });
});

describe("slot link", () => {
  it("opens without sign-in and explains the date with the same reasons as the signed-in route", async () => {
    const booking = await book();
    const slot = farmerFieldSchema.parse((await request(app).get(`/slot/${booking.slot.token}`).expect(200)).body);
    expect(slot.id).toBe(booking.field.id);
    const why = whySchema.parse((await request(app).get(`/slot/${booking.slot.token}/why?lang=pa`).expect(200)).body);
    expect(why.reasons.length).toBeGreaterThan(0);
    expect(why.reasons.every((reason) => reason.text.length > 0)).toBe(true);
  });

  it("answers 401 for a tampered link on every slot route", async () => {
    const booking = await book();
    const tampered = `${booking.slot.token.slice(0, -4)}AAAA`;
    await request(app).get(`/slot/${tampered}`).expect(401);
    await request(app).get(`/slot/${tampered}/why`).expect(401);
    await request(app).post(`/slot/${tampered}/waiting-limit`).send({ waitingLimitDays: 3 }).expect(401);
  });

  it("'I cannot wait longer' shortens the limit, re-plans, and never breaks a held promise silently", async () => {
    const booking = await book(9);
    const before = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer("operator")).expect(200)).body);
    const updated = await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 4 }).expect(200);
    expect(farmerFieldSchema.parse(updated.body).waitingLimitDays).toBe(4);
    const after = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer("operator")).expect(200)).body);
    expect(after.plan.version).toBeGreaterThan(before.plan.version);
    expect(after.counts.promisesOnTrack).toBe(after.counts.promisesOpen);
    expect(after.counts.brokenThisSeason).toBe(before.counts.brokenThisSeason);
  });

  // Regression: the farmer's own window was kept as a hard constraint, so shortening the wait
  // re-planned nothing (a window of 5-6 Nov stayed after the farmer said "until 2 Nov").
  it("'I cannot wait longer' re-plans the farmer's own date (never later) and flags it if still too late", async () => {
    const lastDay = (promise: { kind: string; date?: string; endDate?: string } | null) => (promise ? (promise.kind === "firm" ? promise.date : promise.endDate) : null);
    const booking = await book(9, 10, "2026-11-01");
    const before = farmerFieldSchema.parse((await request(app).get(`/slot/${booking.slot.token}`).expect(200)).body);
    const beforeLast = lastDay(before.promise);
    expect(beforeLast).not.toBeNull();

    const updated = farmerFieldSchema.parse((await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 1 }).expect(200)).body);
    expect(updated.burnDeadlineDate).toBe("2026-11-02");
    const afterLast = lastDay(updated.promise);
    expect(afterLast).not.toBeNull();
    // Asking for sooner never makes the date later, and the field was really re-planned (its own
    // promise was released, not kept as a hard constraint).
    expect(afterLast! <= beforeLast!).toBe(true);
    expect(updated.history.some((item) => item.reason === "replan")).toBe(true);
    // The demo season is full before 8 November, so the new last day cannot be met: the operator's
    // queue must show this field at burn risk rather than on track.
    if (afterLast! > updated.burnDeadlineDate) {
      const queue = await request(app).get("/operator/queue").set(bearer("operator")).expect(200);
      const item = queue.body.items.find((entry: { fieldId: string }) => entry.fieldId === updated.id);
      expect(item.risk).toBe("at_risk");
    }
  });

  it("refuses to lengthen the waiting limit", async () => {
    const booking = await book(5);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 7 }).expect(409);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 5 }).expect(409);
  });
});
