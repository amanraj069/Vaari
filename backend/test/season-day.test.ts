/**
 * The season moves a day at a time. The demo centre's operator records what each of today's
 * fields came to (sown fields keep or break their promise and log the machine's work; the rest go
 * to tomorrow's draft), approves tomorrow's plan, then starts tomorrow: the site's today moves for
 * everyone, the simulated centres close their day and plan on, and the simulator's farmers who
 * asked that day book. Tomorrow cannot start before today is recorded and the plan approved; only
 * the demo centre's operator moves the day; a demo reset rewinds to DATE_TODAY.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { districtChcId } from "../src/demo/district";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { operatorBoardSchema, publicSummarySchema } from "../src/shared";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });
const board = async () => operatorBoardSchema.parse((await request(app).get("/operator/board").set(as("operator")).expect(200)).body);
const approveDraft = async () => {
  const draft = (await runtime.dependencies.planner.latestPlan(DEMO_CHC_ID))!;
  if (draft.status === "draft") await request(app).post("/operator/plan/approve").set(as("operator")).send({ version: draft.version }).expect(200);
};

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true, district: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator", "officer"]) tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
}, 180_000);

describe("the season's day", () => {
  it("starts the first day: nothing to record on 31 October, then today is 1 November for everyone", async () => {
    await approveDraft();
    const before = await board();
    expect(before.day).toMatchObject({ date: "2026-10-31", nextDate: "2026-11-01", stops: [], blockedBy: null, canStart: true });
    for (const role of ["facilitator", "officer"]) expect((await request(app).post("/operator/day/next").set(as(role))).status).toBe(403);
    const fieldsBefore = (await runtime.dependencies.store.listFields(districtChcId(7))).length;
    const after = operatorBoardSchema.parse((await request(app).post("/operator/day/next").set(as("operator")).expect(200)).body);
    expect(after.day.date).toBe("2026-11-01");
    expect(publicSummarySchema.parse((await request(app).get("/public/summary").expect(200)).body).today).toBe("2026-11-01");
    // The approved plan put fields on 1 November: today's work to record.
    expect(after.day.stops.length).toBeGreaterThan(0);
    expect(after.day.blockedBy).toBe("record");
    // The district moved too: the simulator's farmers who asked on 1 November have booked.
    expect((await runtime.dependencies.store.listFields(districtChcId(7))).length).toBeGreaterThanOrEqual(fieldsBefore);
  }, 180_000);

  it("will not start tomorrow before today is recorded, then before tomorrow's plan is approved", async () => {
    expect((await request(app).post("/operator/day/next").set(as("operator"))).status).toBe(409);
    const today = await board();
    const [missed, ...sown] = today.day.stops;
    const recorded = operatorBoardSchema.parse(
      (
        await request(app)
          .post("/operator/day/record")
          .set(as("operator"))
          .send({ outcomes: [{ fieldId: missed!.fieldId, sown: false }, ...sown.map((stop) => ({ fieldId: stop.fieldId, sown: true }))] })
          .expect(200)
      ).body,
    );
    expect(recorded.day).toMatchObject({ closed: true, blockedBy: "approve" });
    const { store, planner } = runtime.dependencies;
    // Sown fields are done with their promises kept, and the machines' work is logged.
    for (const stop of sown) {
      const field = (await store.getField(DEMO_CHC_ID, stop.fieldId))!;
      expect(field.state).toBe("done");
      expect((await store.promiseHistory(DEMO_CHC_ID, stop.fieldId)).at(-1)?.state).toBe("kept");
    }
    expect((await store.listWorkLogs(DEMO_CHC_ID)).filter((log) => log.date === "2026-11-01").length).toBeGreaterThanOrEqual(sown.length);
    // The field not sown goes to tomorrow's draft, on a later day.
    const draft = (await planner.latestPlan(DEMO_CHC_ID))!;
    expect(draft).toMatchObject({ status: "draft", cause: "day_closed" });
    const moved = draft.solve.assignments.find((item) => item.fieldId === missed!.fieldId);
    if (moved) expect(moved.day).toBeGreaterThan(planner.today());
    expect((await request(app).post("/operator/day/next").set(as("operator"))).status).toBe(409);
    await approveDraft();
    expect((await board()).day.blockedBy).toBeNull();
    const next = operatorBoardSchema.parse((await request(app).post("/operator/day/next").set(as("operator")).expect(200)).body);
    expect(next.day.date).toBe("2026-11-02");
  }, 180_000);

  it("marks rain on a plan day: the draft sows nothing there, and clearing it re-plans", async () => {
    const { planner } = runtime.dependencies;
    const rainDate = planner.dayToIso(planner.today() + 2);
    expect((await request(app).post("/operator/rain").set(as("facilitator")).send({ date: rainDate, rain: true })).status).toBe(403);
    expect((await request(app).post("/operator/rain").set(as("operator")).send({ date: planner.dayToIso(planner.today()), rain: true })).status).toBe(409);
    const marked = operatorBoardSchema.parse((await request(app).post("/operator/rain").set(as("operator")).send({ date: rainDate, rain: true }).expect(200)).body);
    expect(marked.days.find((day) => day.date === rainDate)?.rain ?? true).toBe(true);
    const draft = (await planner.latestPlan(DEMO_CHC_ID))!;
    expect(draft).toMatchObject({ status: "draft", cause: "rain_day" });
    expect(draft.solve.routes.filter((route) => route.day === planner.today() + 2 && route.stops.length > 0)).toEqual([]);
    await request(app).post("/operator/rain").set(as("operator")).send({ date: rainDate, rain: false }).expect(200);
    expect((await runtime.dependencies.store.getChc(DEMO_CHC_ID))?.rainDays).not.toContain(planner.today() + 2);
    await approveDraft();
  }, 180_000);

  it("is rewound by a demo reset, the district with it", async () => {
    await request(app).post("/operator/demo/reset").set(as("operator")).expect(200);
    expect((await board()).day.date).toBe("2026-10-31");
    const sim = await runtime.dependencies.store.getChc(districtChcId(7));
    expect(sim?.closedDay).toBeUndefined();
    expect(publicSummarySchema.parse((await request(app).get("/public/summary").expect(200)).body).today).toBe("2026-10-31");
  }, 180_000);
});
