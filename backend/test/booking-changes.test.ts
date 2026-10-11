/**
 * A booking changes when the farmer's harvest moves or they no longer need the machine. The old
 * promise ends as "replaced" (the farmer changed it; the centre did not break it), the field waits
 * for a new date or is gone, and a draft is made at once. The farmer (by phone session or slot
 * link), the helper who booked it and the centre's operator may do it; nobody else may.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { mintSlotToken } from "../src/auth/slot-token";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { bookingInput, farmerSession, testPhone } from "./helpers";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator", "officer"]) tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
});

async function bookAndPromise(phoneSuffix: number) {
  const chc = (await runtime.dependencies.store.getChc(DEMO_CHC_ID))!;
  const booked = await request(app).post("/fields").set(as("facilitator")).send(bookingInput(chc.villageIds[0]!, { farmerPhone: testPhone(phoneSuffix) })).expect(201);
  const draft = await request(app).post("/operator/plan/generate").set(as("operator")).send({}).expect(200);
  await request(app).post("/operator/plan/approve").set(as("operator")).send({ version: draft.body.plan.version }).expect(200);
  return booked.body.field.id as string;
}

describe("changing a booking", () => {
  it("moves the harvest: the promise is replaced, not broken, and the field waits for a new date", async () => {
    const fieldId = await bookAndPromise(401);
    const { store, planner } = runtime.dependencies;
    expect((await store.promiseHistory(DEMO_CHC_ID, fieldId)).at(-1)?.state).toBe("held");
    for (const role of ["officer"]) expect((await request(app).post(`/fields/${fieldId}/harvest`).set(as(role)).send({ readyDate: "2026-11-06" })).status).toBe(403);
    await request(app).post(`/fields/${fieldId}/harvest`).set(as("facilitator")).send({ readyDate: "2026-11-06" }).expect(200);
    const field = (await store.getField(DEMO_CHC_ID, fieldId))!;
    expect(field).toMatchObject({ readyDay: planner.isoToDay("2026-11-06"), state: "waiting", plannedDay: null });
    const history = await store.promiseHistory(DEMO_CHC_ID, fieldId);
    expect(history.every((record) => record.state !== "broken")).toBe(true);
    expect(history.at(-1)?.state).toBe("replaced");
    expect((await planner.latestPlan(DEMO_CHC_ID))).toMatchObject({ status: "draft", cause: "farmer_update" });
    expect((await request(app).post(`/fields/${fieldId}/harvest`).set(as("facilitator")).send({ readyDate: "2027-03-01" })).status).toBe(409);
  });

  it("cancels from the farmer's own phone, and not from another phone", async () => {
    const fieldId = await bookAndPromise(402);
    const other = await farmerSession(app, runtime, testPhone(403));
    expect((await request(app).post(`/farmer/fields/${DEMO_CHC_ID}/${fieldId}/cancel`).set({ authorization: `Bearer ${other}` })).status).toBe(403);
    const own = await farmerSession(app, runtime, testPhone(402));
    await request(app).post(`/farmer/fields/${DEMO_CHC_ID}/${fieldId}/cancel`).set({ authorization: `Bearer ${own}` }).expect(200);
    expect(await runtime.dependencies.store.getField(DEMO_CHC_ID, fieldId)).toBeNull();
    expect((await runtime.dependencies.store.promiseHistory(DEMO_CHC_ID, fieldId)).at(-1)?.state).toBe("replaced");
  });

  it("works from the slot link, which stops working once the booking is cancelled", async () => {
    const { store } = runtime.dependencies;
    const field = (await store.getField(DEMO_CHC_ID, "f-jaswinder"))!;
    const token = await mintSlotToken(runtime.dependencies.config, field);
    const moved = await request(app).post(`/slot/${token}/harvest`).send({ readyDate: "2026-11-03" }).expect(200);
    expect(moved.body.status).toBe("requested");
    await request(app).post(`/slot/${token}/cancel`).expect(200);
    expect((await request(app).get(`/slot/${token}`)).status).toBe(404);
    const session = await farmerSession(app, runtime, DEMO_FARMER_PHONE);
    expect(JSON.stringify((await request(app).get("/farmer/home").set({ authorization: `Bearer ${session}` }).expect(200)).body)).not.toContain("f-jaswinder");
  });
});
