/**
 * The core loop end to end, against the real engine (LocalEngineClient spawning Python):
 * a booking is a request -> the operator generates a DRAFT (farmers see nothing yet) -> approval
 * publishes it and creates promises -> a breakdown makes a new draft that keeps or explicitly breaks
 * promises -> a manual move re-plans around a pin -> sowing keeps a promise. Cedar refuses the
 * calls a role may not make.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { bookingSchema, farmerFieldSchema, farmerHomeSchema, operatorBoardSchema, operatorPlanSchema, whySchema } from "../src/shared";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });

async function login(role: string) {
  const response = await request(app).post("/auth/demo").send({ role }).expect(200);
  tokens[role] = response.body.accessToken;
}

const board = async () => operatorBoardSchema.parse((await request(app).get("/operator/board").set(as("operator")).expect(200)).body);
const planView = async () => operatorPlanSchema.parse((await request(app).get("/operator/plan").set(as("operator")).expect(200)).body);
const generate = async () => operatorPlanSchema.parse((await request(app).post("/operator/plan/generate").set(as("operator")).send({}).expect(200)).body);
const approve = async (version: number) =>
  operatorPlanSchema.parse((await request(app).post("/operator/plan/approve").set(as("operator")).send({ version }).expect(200)).body);

beforeAll(async () => {
  const { dependencies } = await buildRuntime({ freshDemo: true });
  app = createApp(dependencies);
  await Promise.all(["farmer", "facilitator", "operator", "officer"].map(login));
});

describe("core loop", () => {
  let requestedFieldId = "";

  it("rejects requests without a token", async () => {
    await request(app).get("/operator/board").expect(401);
  });

  it("Cedar keeps every other role away from the operator's plan (denied calls)", async () => {
    await request(app).get("/operator/board").set(as("farmer")).expect(403);
    await request(app).get("/operator/board").set(as("officer")).expect(403);
    await request(app).post("/operator/plan/generate").set(as("facilitator")).send({}).expect(403);
    await request(app).post("/operator/plan/approve").set(as("farmer")).send({ version: 1 }).expect(403);
  });

  it("the season starts from a published plan with every promise on track", async () => {
    const current = await board();
    expect(current.published?.status).toBe("approved");
    expect(current.draft).toBeNull();
    expect(current.lanes).toHaveLength(4);
    expect(current.counts.promisesOpen).toBeGreaterThan(0);
    expect(current.counts.promisesOnTrack).toBe(current.counts.promisesOpen);
    expect(current.newRequests).toBe(0);
  });

  it("a booking is stored as a request at once, with no date until a plan is published", async () => {
    const villages = await request(app).get("/villages").set(as("farmer")).expect(200);
    const created = await request(app)
      .post("/fields")
      .set(as("farmer"))
      .send({ villageId: villages.body[0].id, acres: 2.5, readyDate: "2026-11-02", waitingLimitDays: 7 })
      .expect(201);
    const { field, slot } = bookingSchema.parse(created.body);
    requestedFieldId = field.id;
    expect(field.status).toBe("requested");
    expect(field.promise).toBeNull();
    expect(field.reason.code).toBe("requested");
    expect(slot.path).toBe(`/slot/${slot.token}`);
    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(as("farmer")).expect(200)).body);
    expect(home.fields.map((item) => item.id)).toContain(field.id);
    expect((await board()).newRequests).toBe(1);
  });

  it("generate makes a draft; farmers see nothing until it is approved", async () => {
    const draft = await generate();
    expect(draft.plan?.status).toBe("draft");
    expect(draft.plan?.cause).toBe("generate");
    expect(draft.changes?.promised.map((item) => item.fieldId)).toContain(requestedFieldId);
    expect(draft.newRequests).toBe(0);
    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(as("farmer")).expect(200)).body);
    expect(home.fields.find((item) => item.id === requestedFieldId)?.status).toBe("requested");
    // The board still shows the published plan, with the draft waiting.
    const current = await board();
    expect(current.published?.version).toBeLessThan(draft.plan!.version);
    expect(current.draft?.version).toBe(draft.plan!.version);
  });

  it("approval publishes the draft exactly once and creates the promise", async () => {
    const draft = await planView();
    await request(app).post("/operator/plan/approve").set(as("operator")).send({ version: draft.plan!.version - 1 }).expect(409);
    const published = await approve(draft.plan!.version);
    expect(published.plan?.status).toBe("approved");
    // The conditional write on status and version lets an approval happen exactly once.
    const again = await request(app).post("/operator/plan/approve").set(as("operator")).send({ version: draft.plan!.version }).expect(409);
    expect(again.body.error).toBe("CONFLICT");

    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(as("farmer")).expect(200)).body);
    const field = home.fields.find((item) => item.id === requestedFieldId)!;
    expect(["window", "firm"]).toContain(field.status);
    expect(field.promise).not.toBeNull();
    expect(field.queuePosition).toBeGreaterThan(0);
    expect(field.history.at(-1)?.reason).toBe("first_promise");
    const current = await board();
    expect(current.draft).toBeNull();
    expect(current.counts.promisesOnTrack).toBe(current.counts.promisesOpen);
  });

  it("explains a date from the solver's reasons", async () => {
    const response = await request(app).get("/fields/f-jaswinder/why?lang=en").set(as("farmer")).expect(200);
    const why = whySchema.parse(response.body);
    expect(why.reasons.length).toBeGreaterThan(0);
    expect(why.source).toBe("template");
    // Another farmer's field is off limits.
    await request(app).get("/fields/f-sim-00/why").set(as("farmer")).expect(403);
  });

  it("a breakdown makes a draft that keeps every promise or names each one it breaks", async () => {
    const before = await board();
    const draft = operatorPlanSchema.parse((await request(app).post("/operator/machines/m2/down").set(as("operator")).send({ days: 1 }).expect(200)).body);
    expect(draft.plan?.status).toBe("draft");
    expect(draft.plan?.cause).toBe("breakdown");
    expect(draft.plan?.causeMachineName).toBe("Super Seeder 2");
    expect(draft.lanes.find((lane) => lane.machine.id === "m2")?.down).toBe(true);
    expect(draft.lanes.find((lane) => lane.machine.id === "m2")?.stops).toHaveLength(0);
    // Nothing breaks before approval, but the board no longer calls the workshop machine's
    // promises "on track" while the re-plan waits.
    const waiting = await board();
    expect(waiting.counts.brokenThisSeason).toBe(before.counts.brokenThisSeason);
    const stuck = before.lanes.find((lane) => lane.machine.id === "m2")!.stops.filter((stop) => !stop.stretch && stop.part === stop.parts).length;
    expect(waiting.counts.promisesOnTrack).toBeLessThanOrEqual(waiting.counts.promisesOpen - stuck);

    await approve(draft.plan!.version);
    const after = await board();
    expect(after.counts.brokenThisSeason).toBe(before.counts.brokenThisSeason + draft.changes!.broken.length);
    expect(after.counts.promisesOnTrack).toBe(after.counts.promisesOpen);
    expect(after.lanes.find((lane) => lane.machine.id === "m2")?.down).toBe(true);
  });

  it("moving a field pins it there and re-plans everyone else; an impossible move is refused", async () => {
    const draft = await generate();
    const lane = draft.lanes.find((item) => !item.down && item.stops.some((stop) => !stop.stretch && stop.parts === 1))!;
    const stop = lane.stops.find((item) => !item.stretch && item.parts === 1)!;
    const target = draft.lanes.find((item) => !item.down && item.machine.id !== lane.machine.id)!;
    const moved = operatorPlanSchema.parse(
      (
        await request(app)
          .post("/operator/plan/move")
          .set(as("operator"))
          .send({ fieldId: stop.fieldId, machineId: target.machine.id, date: draft.plan!.planDate })
          .expect(200)
      ).body,
    );
    expect(moved.plan?.cause).toBe("manual_move");
    expect(moved.pins).toEqual([expect.objectContaining({ fieldId: stop.fieldId, machineName: target.machine.name, date: draft.plan!.planDate })]);
    expect(moved.lanes.find((item) => item.machine.id === target.machine.id)?.stops.map((item) => item.fieldId)).toContain(stop.fieldId);

    // Super Seeder 2 is in the workshop tomorrow: a move onto it is refused with the reason.
    const refused = await request(app)
      .post("/operator/plan/move")
      .set(as("operator"))
      .send({ fieldId: stop.fieldId, machineId: "m2", date: draft.plan!.planDate })
      .expect(422);
    expect(refused.body.error).toBe("IMPOSSIBLE_MOVE");
  });

  it("sowing a field keeps its promise, and a kept promise cannot be sown again", async () => {
    const draft = await planView();
    await approve(draft.plan!.version);
    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(as("farmer")).expect(200)).body);
    const promised = home.fields.find((item) => item.status === "firm" || item.status === "window")!;
    const sown = farmerFieldSchema.parse((await request(app).post(`/operator/fields/${promised.id}/sown`).set(as("operator")).send({}).expect(200)).body);
    expect(sown.status).toBe("kept");
    expect(sown.reason.code).toBe("kept");
    const again = await request(app).post(`/operator/fields/${promised.id}/sown`).set(as("operator")).send({}).expect(409);
    expect(again.body.error).toBe("PROMISE_RULE");
    await request(app).post(`/operator/fields/${promised.id}/sown`).set(as("farmer")).send({}).expect(403);
  });
});
