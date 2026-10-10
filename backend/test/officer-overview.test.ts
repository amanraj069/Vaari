/**
 * The officer's overview and the farmer's "who am I" for the dashboard frame. The overview must
 * count exactly what the operator's board counts (one way of counting), sum every centre, and carry
 * aggregates only: no farmer's name, phone, token or field id. Only an officer may read it.
 * /farmer/me names the phone session's farmer and never echoes the phone.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { farmerMeSchema, meSchema, officerOverviewSchema, operatorBoardSchema } from "../src/shared";
import { farmerSession, testPhone } from "./helpers";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const tokens: Record<string, string> = {};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator", "officer"]) tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
  // Publish a plan, so promises, plan dates and the days ahead are all filled in.
  const draft = await request(app).post("/operator/plan/generate").set(bearer(tokens.operator!)).send({}).expect(200);
  await request(app).post("/operator/plan/approve").set(bearer(tokens.operator!)).send({ version: draft.body.plan.version }).expect(200);
});

describe("GET /officer/overview", () => {
  it("counts the centre the way the operator's board does, and sums the district", async () => {
    const overview = officerOverviewSchema.parse((await request(app).get("/officer/overview").set(bearer(tokens.officer!)).expect(200)).body);
    const board = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer(tokens.operator!)).expect(200)).body);
    const centre = overview.centres.find((item) => item.id === DEMO_CHC_ID)!;
    expect(centre).toBeDefined();
    expect(centre.name).toBe(board.chc.name);
    expect(centre.promisesOpen).toBe(board.counts.promisesOpen);
    expect(centre.promisesOnTrack).toBe(board.counts.promisesOnTrack);
    expect(centre.burnRisk).toBe(board.counts.burnRisk);
    expect(centre.waitingForDate).toBe(board.counts.requested);
    expect(centre.machinesWorking).toBe(board.counts.machinesWorking);
    expect(centre.machinesTotal).toBe(board.counts.machinesTotal);
    expect(centre.promisesBroken).toBe(board.counts.brokenThisSeason);
    expect(centre.planDate).toBe(board.planDate);
    expect(centre.draftWaiting).toBe(false);

    // Totals are the sum over centres; villages are the villages the centres serve.
    expect(overview.totals.centres).toBe(overview.centres.length);
    expect(overview.totals.promisesOpen).toBe(overview.centres.reduce((sum, item) => sum + item.promisesOpen, 0));
    expect(overview.totals.fieldsActive).toBe(overview.villages.reduce((sum, item) => sum + item.fieldsActive, 0));
    expect(overview.totals.burnRisk).toBe(overview.villages.reduce((sum, item) => sum + item.burnRisk, 0));
    // Villages with burn risk come first.
    const risks = overview.villages.map((village) => village.burnRisk);
    expect(risks).toEqual([...risks].sort((left, right) => right - left));
    // Ten days ahead, from tomorrow; together they hold every planned field inside the horizon.
    expect(overview.sowingAhead).toHaveLength(10);
    expect(overview.sowingAhead[0]!.date > overview.today).toBe(true);
    expect(overview.sowingAhead.reduce((sum, day) => sum + day.fields, 0)).toBeGreaterThan(0);
    // The real district outlines travel with it, for the map.
    expect(overview.districts.length).toBeGreaterThan(0);
  });

  it("carries no farmer's name, phone, token or field id", async () => {
    const response = await request(app).get("/officer/overview").set(bearer(tokens.officer!)).expect(200);
    const text = JSON.stringify(response.body);
    const queue = (await request(app).get("/operator/queue").set(bearer(tokens.operator!)).expect(200)).body.items as { fieldId: string; farmerName: string }[];
    expect(queue.length).toBeGreaterThan(0);
    for (const item of queue) {
      expect(text.includes(item.farmerName), `overview names ${item.farmerName}`).toBe(false);
      expect(text.includes(`"${item.fieldId}"`), `overview carries field ${item.fieldId}`).toBe(false);
    }
    expect(text.replace(/[\s\-()+]/g, "").includes(DEMO_FARMER_PHONE.slice(3))).toBe(false);
    expect(text).not.toMatch(/farmerName|farmerPhone|token/);
  });

  it("is for officers only", async () => {
    for (const role of ["operator", "facilitator"]) {
      expect((await request(app).get("/officer/overview").set(bearer(tokens[role]!))).status).toBe(403);
    }
    expect((await request(app).get("/officer/overview")).status).toBe(401);
    const phoneSession = await farmerSession(app, runtime, DEMO_FARMER_PHONE);
    expect((await request(app).get("/officer/overview").set(bearer(phoneSession))).status).toBe(401);
  });

  it("shows a breakdown at once: the machine is not working and its promises are not on track", async () => {
    const before = officerOverviewSchema.parse((await request(app).get("/officer/overview").set(bearer(tokens.officer!)).expect(200)).body);
    const board = operatorBoardSchema.parse((await request(app).get("/operator/board").set(bearer(tokens.operator!)).expect(200)).body);
    const busyLane = board.lanes.find((lane) => lane.stops.length > 0)!;
    await request(app).post(`/operator/machines/${busyLane.machine.id}/down`).set(bearer(tokens.operator!)).send({ days: 1 }).expect(200);
    const after = officerOverviewSchema.parse((await request(app).get("/officer/overview").set(bearer(tokens.officer!)).expect(200)).body);
    const centreBefore = before.centres.find((item) => item.id === DEMO_CHC_ID)!;
    const centreAfter = after.centres.find((item) => item.id === DEMO_CHC_ID)!;
    expect(centreAfter.machinesWorking).toBe(centreBefore.machinesWorking - 1);
    expect(centreAfter.promisesOnTrack).toBeLessThan(centreBefore.promisesOnTrack);
    expect(centreAfter.draftWaiting).toBe(true);
    await request(app).post(`/operator/machines/${busyLane.machine.id}/up`).set(bearer(tokens.operator!)).send({}).expect(200);
  });
});

describe("GET /farmer/me", () => {
  it("names the demo farmer from their booking, without the phone", async () => {
    const session = await farmerSession(app, runtime, DEMO_FARMER_PHONE);
    const response = await request(app).get("/farmer/me").set(bearer(session)).expect(200);
    const me = farmerMeSchema.parse(response.body);
    expect(me.registered).toBe(true);
    expect(me.name).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain(DEMO_FARMER_PHONE.slice(3));
  });

  it("answers a phone Vaari does not know yet with no name", async () => {
    const session = await farmerSession(app, runtime, testPhone(321));
    expect(farmerMeSchema.parse((await request(app).get("/farmer/me").set(bearer(session)).expect(200)).body)).toEqual({ name: null, registered: false });
  });

  it("refuses a staff token and no token", async () => {
    expect((await request(app).get("/farmer/me").set(bearer(tokens.operator!))).status).toBe(401);
    expect((await request(app).get("/farmer/me")).status).toBe(401);
  });
});

describe("GET /me", () => {
  it("names the centre for staff who work in one, and none for the officer", async () => {
    expect(meSchema.parse((await request(app).get("/me").set(bearer(tokens.operator!)).expect(200)).body).chcName).toBe("Balian Cooperative Society");
    expect(meSchema.parse((await request(app).get("/me").set(bearer(tokens.officer!)).expect(200)).body).chcName).toBeNull();
  });
});
