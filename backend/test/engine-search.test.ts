/**
 * The API on the fast planner (ENGINE_METHOD=search), against the real Python engine: the same
 * promise rules hold as with CP-SAT (a breakdown re-plan keeps every promise or reports it broken),
 * and the engine's answer, including the new objective breakdown, passes the shared Zod contract.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operatorBoardSchema, solveResponseSchema } from "../src/shared";
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
  it("plans the demo season with the search and reports its objective", async () => {
    const { solve } = await runtime.dependencies.planner.latestSolve(DEMO_CHC_ID);
    const parsed = solveResponseSchema.parse(solve);
    expect(parsed.solver.method).toBe("search");
    expect(parsed.solver.travelSource).toBe("straight-line");
    expect(parsed.objective?.brokenPromises).toBe(0);
    expect(parsed.objective?.unservedFields).toBe(parsed.unservedFieldIds.length);
  });

  it("a breakdown re-plan keeps every promise or reports it broken", async () => {
    const before = operatorBoardSchema.parse(
      (await request(app).get("/operator/board").set("authorization", `Bearer ${operatorToken}`).expect(200)).body,
    );
    const after = operatorBoardSchema.parse(
      (
        await request(app)
          .post("/operator/machines/m2/down")
          .set("authorization", `Bearer ${operatorToken}`)
          .send({ days: 1 })
          .expect(200)
      ).body,
    );
    expect(after.lanes.find((lane) => lane.machine.id === "m2")?.stops).toHaveLength(0);
    const broken = after.lastReplan?.broken.length ?? 0;
    expect(after.counts.promisesOnTrack).toBe(after.counts.promisesOpen);
    expect(after.counts.brokenThisSeason).toBe(before.counts.brokenThisSeason + broken);
    const { solve } = await runtime.dependencies.planner.latestSolve(DEMO_CHC_ID);
    // If anything broke, CP-SAT was asked how few must break.
    if (broken > 0) expect(solve.solver.breaksProvenMinimal).not.toBeUndefined();
  });

  it("approval still firms the plan exactly once", async () => {
    const board = operatorBoardSchema.parse(
      (await request(app).get("/operator/board").set("authorization", `Bearer ${operatorToken}`).expect(200)).body,
    );
    await request(app)
      .post("/operator/plan/approve")
      .set("authorization", `Bearer ${operatorToken}`)
      .send({ version: board.plan.version })
      .expect(200);
    await request(app)
      .post("/operator/plan/approve")
      .set("authorization", `Bearer ${operatorToken}`)
      .send({ version: board.plan.version })
      .expect(409);
  });
});
