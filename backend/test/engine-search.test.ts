/**
 * The API on the fast planner (ENGINE_METHOD=search), against the real Python engine: the same
 * promise rules hold as with CP-SAT (a breakdown re-plan keeps every promise or reports it broken),
 * and the engine's answer, including the new objective breakdown, passes the shared Zod contract.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operatorBoardSchema, operatorPlanSchema, solveResponseSchema } from "../src/shared";
import { createApp } from "../src/app";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { buildRuntime } from "../src/server";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
let operatorToken = "";
const previousMethod = process.env.ENGINE_METHOD;

beforeAll(async () => {
  process.env.ENGINE_METHOD = "search";
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  operatorToken = (await request(app).post("/auth/demo").send({ role: "operator" }).expect(200)).body.accessToken;
});

afterAll(() => {
  if (previousMethod === undefined) delete process.env.ENGINE_METHOD;
  else process.env.ENGINE_METHOD = previousMethod;
});

describe("API with the search planner", () => {
  it("publishes the demo season with the search and reports its objective", async () => {
    const published = await runtime.dependencies.planner.publishedPlan(DEMO_CHC_ID);
    const parsed = solveResponseSchema.parse(published!.solve);
    expect(parsed.solver.method).toBe("search");
    expect(parsed.solver.travelSource).toBe("straight-line");
    expect(parsed.objective?.brokenPromises).toBe(0);
    expect(parsed.objective?.unservedFields).toBe(parsed.unservedFieldIds.length);
  });

  it("a breakdown draft keeps every promise or names each one it breaks; approval publishes it once", async () => {
    const auth = { authorization: `Bearer ${operatorToken}` };
    const before = operatorBoardSchema.parse((await request(app).get("/operator/board").set(auth).expect(200)).body);
    const draft = operatorPlanSchema.parse((await request(app).post("/operator/machines/m2/down").set(auth).send({ days: 1 }).expect(200)).body);
    expect(draft.lanes.find((lane) => lane.machine.id === "m2")?.stops).toHaveLength(0);
    const broken = draft.changes!.broken.length;
    // If anything would break, the engine was asked exactly how few must break.
    if (broken > 0) expect(draft.solver?.breaksProvenMinimal).not.toBeNull();

    await request(app).post("/operator/plan/approve").set(auth).send({ version: draft.plan!.version }).expect(200);
    await request(app).post("/operator/plan/approve").set(auth).send({ version: draft.plan!.version }).expect(409);
    const after = operatorBoardSchema.parse((await request(app).get("/operator/board").set(auth).expect(200)).body);
    expect(after.counts.promisesOnTrack).toBe(after.counts.promisesOpen);
    expect(after.counts.brokenThisSeason).toBe(before.counts.brokenThisSeason + broken);
  });
});
