/**
 * The plan covers ten days, and a fresh plan with nothing new keeps every promise. Shortening the
 * horizon to seven days (2026-10-11) left promises published for days 8-10 with no day the engine
 * could use, so "Make a fresh plan" broke three of them with no booking and no breakdown
 * (docs/FOUGHT_BACK.md). These checks keep the horizon at ten and the re-plan break-free.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { lastDay } from "../src/domain/promises";
import { buildRuntime } from "../src/server";

let runtime: Awaited<ReturnType<typeof buildRuntime>>;

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
}, 180_000);

describe("the plan's horizon", () => {
  it("plans tomorrow and the nine days after it", async () => {
    const { planner } = runtime.dependencies;
    const today = planner.today();
    expect(planner.planDays()).toEqual(Array.from({ length: 10 }, (_, offset) => today + 1 + offset));
    const { request } = await planner.buildSolveRequest(DEMO_CHC_ID);
    expect(request.horizonDays).toBe(10);
  });

  it("promises reach past the seventh day, and a fresh plan with nothing new breaks none of them", async () => {
    const { planner } = runtime.dependencies;
    const first = await planner.generatePlan(DEMO_CHC_ID);
    await planner.approvePlan(DEMO_CHC_ID, first.version, "test operator");
    const held = (await runtime.dependencies.store.listPromises(DEMO_CHC_ID)).filter((record) => record.state === "held" && record.promise);
    expect(Math.max(...held.map((record) => lastDay(record.promise!)))).toBeGreaterThan(planner.today() + 7);

    const fresh = await planner.generatePlan(DEMO_CHC_ID);
    expect(fresh.changes.broken).toEqual([]);
    expect(fresh.solve.solver.mode).toBe("normal");
  });
});
