/**
 * The core loop end to end, against the real engine (LocalEngineClient spawning Python):
 * seed -> operator board -> farmer request gets a promise -> "why this date?" ->
 * breakdown re-plan keeps or explicitly breaks promises -> approval firms windows.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { farmerFieldSchema, farmerHomeSchema, operatorBoardSchema, whySchema } from "../src/shared";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function login(role: string) {
  const response = await request(app).post("/auth/demo").send({ role }).expect(200);
  tokens[role] = response.body.accessToken;
}

beforeAll(async () => {
  const { dependencies } = await buildRuntime({ freshDemo: true });
  app = createApp(dependencies);
  await Promise.all(["farmer", "operator", "officer"].map(login));
});

describe("core loop", () => {
  it("rejects requests without a token", async () => {
    await request(app).get("/operator/board").expect(401);
  });

  it("Cedar keeps farmers and officers out of the operator board", async () => {
    await request(app).get("/operator/board").set("authorization", `Bearer ${tokens.farmer}`).expect(403);
    await request(app).get("/operator/board").set("authorization", `Bearer ${tokens.officer}`).expect(403);
  });

  it("operator sees tomorrow's lanes and promise counts", async () => {
    const response = await request(app).get("/operator/board").set("authorization", `Bearer ${tokens.operator}`).expect(200);
    const board = operatorBoardSchema.parse(response.body);
    expect(board.lanes).toHaveLength(4);
    expect(board.counts.promisesOpen).toBeGreaterThan(0);
    expect(board.counts.promisesOnTrack).toBe(board.counts.promisesOpen);
    expect(board.plan.status).toBe("proposed");
  });

  it("farmer requests a date and gets a promise", async () => {
    const villages = await request(app).get("/villages").set("authorization", `Bearer ${tokens.farmer}`).expect(200);
    const created = await request(app)
      .post("/farmer/requests")
      .set("authorization", `Bearer ${tokens.farmer}`)
      .send({ villageId: villages.body[0].id, acres: 2.5, readyDate: "2026-11-02", waitingLimitDays: 7 })
      .expect(201);
    const field = farmerFieldSchema.parse(created.body);
    expect(field.promise).not.toBeNull();
    const home = farmerHomeSchema.parse(
      (await request(app).get("/farmer/home").set("authorization", `Bearer ${tokens.farmer}`).expect(200)).body,
    );
    expect(home.fields.map((item) => item.id)).toContain(field.id);
  });

  it("explains a date from the solver's reasons", async () => {
    const response = await request(app).get("/fields/f-jaswinder/why?lang=en").set("authorization", `Bearer ${tokens.farmer}`).expect(200);
    const why = whySchema.parse(response.body);
    expect(why.reasons.length).toBeGreaterThan(0);
    expect(why.source).toBe("template");
    // Another farmer's field is off limits.
    await request(app).get("/fields/f-sim-00/why").set("authorization", `Bearer ${tokens.farmer}`).expect(403);
  });

  it("breakdown re-plan never silently breaks a promise", async () => {
    const before = operatorBoardSchema.parse(
      (await request(app).get("/operator/board").set("authorization", `Bearer ${tokens.operator}`).expect(200)).body,
    );
    const response = await request(app)
      .post("/operator/machines/m2/down")
      .set("authorization", `Bearer ${tokens.operator}`)
      .send({ days: 1 })
      .expect(200);
    const after = operatorBoardSchema.parse(response.body);
    expect(after.lanes.find((lane) => lane.machine.id === "m2")?.down).toBe(true);
    expect(after.lanes.find((lane) => lane.machine.id === "m2")?.stops).toHaveLength(0);
    expect(after.lastReplan?.cause).toBe("breakdown");
    // Every promise is either still on track, or reported as broken with a new date.
    const broken = after.lastReplan?.broken.length ?? 0;
    expect(after.counts.promisesOnTrack).toBe(after.counts.promisesOpen);
    expect(after.counts.brokenThisSeason).toBe(before.counts.brokenThisSeason + broken);
    expect(after.plan.version).toBeGreaterThan(before.plan.version);
  });

  it("approval needs the current version and then firms windows", async () => {
    const board = operatorBoardSchema.parse(
      (await request(app).get("/operator/board").set("authorization", `Bearer ${tokens.operator}`).expect(200)).body,
    );
    await request(app)
      .post("/operator/plan/approve")
      .set("authorization", `Bearer ${tokens.operator}`)
      .send({ version: board.plan.version - 1 })
      .expect(409);
    const approved = await request(app)
      .post("/operator/plan/approve")
      .set("authorization", `Bearer ${tokens.operator}`)
      .send({ version: board.plan.version })
      .expect(200);
    expect(approved.body.status).toBe("approved");
    // The conditional write on status and version lets an approval happen exactly once.
    const again = await request(app)
      .post("/operator/plan/approve")
      .set("authorization", `Bearer ${tokens.operator}`)
      .send({ version: board.plan.version })
      .expect(409);
    expect(again.body.error).toBe("CONFLICT");
  });
});
