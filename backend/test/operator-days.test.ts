/**
 * The operator's calendar: the board and the plan carry every plan day's load (fields, acres, each
 * machine's minutes used of the minutes it can work), the lanes can be asked for any plan day
 * (?date=), and a date outside the plan falls back to the plan's first day, never an error.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import { operatorBoardSchema, operatorPlanSchema } from "../src/shared";

let app: ReturnType<typeof createApp>;
let operator = "";
const bearer = () => ({ authorization: `Bearer ${operator}` });

beforeAll(async () => {
  const runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  operator = (await request(app).post("/auth/demo").send({ role: "operator" }).expect(200)).body.accessToken;
  const draft = await request(app).post("/operator/plan/generate").set(bearer()).send({}).expect(200);
  await request(app).post("/operator/plan/approve").set(bearer()).send({ version: draft.body.plan.version }).expect(200);
});

describe("plan days", () => {
  it("summarise each day from the plan's own routes", async () => {
    const board = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer()).expect(200)).body);
    expect(board.days).toHaveLength(10);
    expect(board.selectedDate).toBe(board.planDate);
    const first = board.days[0]!;
    expect(first.date).toBe(board.planDate);
    // The first day's fields are the fields on tomorrow's lanes (stretch stops left out).
    const laneFields = new Set(board.lanes.flatMap((lane) => lane.stops.filter((stop) => !stop.stretch).map((stop) => stop.fieldId)));
    expect(first.fields).toBe(laneFields.size);
    for (const machine of first.machines) {
      expect(machine.busyMinutes).toBeLessThanOrEqual(machine.capacityMinutes);
      expect(machine.capacityMinutes).toBeGreaterThan(0);
    }
    // Every open field is counted once by risk.
    const { safe, tight, at_risk, unplanned } = board.riskCounts;
    expect(safe + tight + at_risk + unplanned).toBe(board.counts.promisesOpen + board.counts.requested);
  });

  it("shows the lanes of any plan day, and the first day for a date outside the plan", async () => {
    const board = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer()).expect(200)).body);
    const third = board.days[2]!;
    const onThird = operatorBoardSchema.parse((await request(app).get(`/operator/board?date=${third.date}`).set(bearer()).expect(200)).body);
    expect(onThird.selectedDate).toBe(third.date);
    expect(new Set(onThird.lanes.flatMap((lane) => lane.stops.filter((stop) => !stop.stretch).map((stop) => stop.fieldId))).size).toBe(third.fields);
    // Counts stay about tomorrow whichever day is shown.
    expect(onThird.counts).toEqual(board.counts);
    const outside = operatorBoardSchema.parse((await request(app).get("/operator/board?date=2020-01-01").set(bearer()).expect(200)).body);
    expect(outside.selectedDate).toBe(board.planDate);
    const plan = operatorPlanSchema.parse((await request(app).get(`/operator/plan?date=${third.date}`).set(bearer()).expect(200)).body);
    expect(plan.selectedDate).toBe(third.date);
    expect(plan.days.map((day) => day.date)).toEqual(board.days.map((day) => day.date));
  });
});
