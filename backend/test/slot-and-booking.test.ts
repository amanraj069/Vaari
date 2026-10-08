/**
 * The routes behind /book and /slot/[token]: POST /fields books for a farmer (facilitator) or for
 * oneself (farmer) and returns a slot link; the slot opens without sign-in and says where the turn
 * stands in one sentence; "I cannot wait longer" only shortens the waiting limit, makes a draft,
 * and the published result is never later; a tampered link is 401.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import { bookingSchema, farmerFieldSchema, operatorPlanSchema, whySchema, type FarmerField } from "../src/shared";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const bearer = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });

beforeAll(async () => {
  const runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "farmer", "operator", "officer"]) {
    tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
  }
});

async function book(waitingLimitDays = 8, acres = 3, readyDate = "2026-11-02") {
  const villages = await request(app).get("/villages").set(bearer("facilitator")).expect(200);
  const response = await request(app)
    .post("/fields")
    .set(bearer("facilitator"))
    .send({ farmerName: "Paramjit Kaur", villageId: villages.body[0].id, acres, readyDate, waitingLimitDays })
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
  it("a facilitator books for a farmer, gets the slot link, and sees it in their list", async () => {
    const booking = await book();
    expect(booking.slot.path).toBe(`/slot/${booking.slot.token}`);
    expect(booking.field.farmerName).toBe("Paramjit Kaur");
    expect(booking.field.status).toBe("requested");
    const list = await request(app).get("/facilitator/fields").set(bearer("facilitator")).expect(200);
    expect(list.body.items.map((item: { fieldId: string }) => item.fieldId)).toContain(booking.field.id);
  });

  it("a facilitator must name the farmer; operators and officers cannot book", async () => {
    const villages = await request(app).get("/villages").set(bearer("facilitator")).expect(200);
    const input = { villageId: villages.body[0].id, acres: 2, readyDate: "2026-11-02", waitingLimitDays: 6 };
    expect((await request(app).post("/fields").set(bearer("facilitator")).send(input).expect(400)).body.error).toBe("FARMER_NAME_REQUIRED");
    await request(app).post("/fields").set(bearer("operator")).send(input).expect(403);
    await request(app).post("/fields").set(bearer("officer")).send(input).expect(403);
    await request(app).post("/fields").set(bearer("facilitator")).send({ ...input, farmerName: "X", waitingLimitDays: 40 }).expect(400);
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

    await request(app).post("/operator/plan/approve").set(bearer("operator")).send({ version: draft.plan!.version }).expect(200);
    const after = await slot(booking.slot.token);
    expect(after.soonerRequested).toBe(false);
    expect(lastDay(after)! <= lastDay(before)!).toBe(true);
    // The demo season is full before 8 November, so the new last day cannot be met: the operator's
    // queue must show this field at burn risk rather than on track.
    if (lastDay(after)! > after.burnDeadlineDate) {
      const queue = await request(app).get("/operator/queue").set(bearer("operator")).expect(200);
      expect(queue.body.items.find((entry: { fieldId: string }) => entry.fieldId === after.id).risk).toBe("at_risk");
    }
  });

  it("refuses to lengthen the waiting limit", async () => {
    const booking = await book(5);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 7 }).expect(409);
    await request(app).post(`/slot/${booking.slot.token}/waiting-limit`).send({ waitingLimitDays: 5 }).expect(409);
  });
});
