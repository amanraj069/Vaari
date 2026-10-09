/**
 * A farmer's phone number is stored (it is their identity) but never sent where it does not
 * belong: not on a slot link, not to an officer, not on a public route. Each check books a field
 * with a known phone, then searches every answer for its digits in any format.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import { bookingSchema } from "../src/shared";
import { bookingInput, testPhone } from "./helpers";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const bearer = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });
const PHONE = testPhone(555); // +447700900555
const DIGITS = "7700900555"; // matches +44..., 07700..., "7700 900555" once spaces are removed
let slotToken = "";
let fieldId = "";

/** The phone's digits must not appear anywhere in the body, however it is formatted. */
function expectNoPhone(body: unknown, where: string) {
  const text = JSON.stringify(body).replace(/[\s\-()+]/g, "");
  expect(text.includes(DIGITS), `${where} contains the farmer's phone`).toBe(false);
}

beforeAll(async () => {
  const runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator", "officer"]) tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
  const villageId = (await request(app).get("/villages").set(bearer("facilitator")).expect(200)).body[0].id;
  const booking = bookingSchema.parse((await request(app).post("/fields").set(bearer("facilitator")).send(bookingInput(villageId, { farmerPhone: PHONE })).expect(201)).body);
  slotToken = booking.slot.token;
  fieldId = booking.field.id;
  // Publish a plan so the slot answers carry a promise, a reason and a history too.
  const draft = await request(app).post("/operator/plan/generate").set(bearer("operator")).send({}).expect(200);
  await request(app).post("/operator/plan/approve").set(bearer("operator")).send({ version: draft.body.plan.version }).expect(200);
});

describe("no phone number leaves the API where it does not belong", () => {
  it("slot responses", async () => {
    expectNoPhone((await request(app).get(`/slot/${slotToken}?lang=en`).expect(200)).body, "GET /slot/:token");
    expectNoPhone((await request(app).get(`/slot/${slotToken}/why?lang=pa`).expect(200)).body, "GET /slot/:token/why");
    expectNoPhone((await request(app).post(`/slot/${slotToken}/waiting-limit`).send({ waitingLimitDays: 7 }).expect(200)).body, "POST /slot/:token/waiting-limit");
  });

  it("officer responses", async () => {
    expectNoPhone((await request(app).get("/me").set(bearer("officer")).expect(200)).body, "officer GET /me");
    expectNoPhone((await request(app).get("/chcs").set(bearer("officer")).expect(200)).body, "officer GET /chcs");
    // Everything else an officer tries is refused, and the refusal carries no record either.
    for (const path of ["/operator/board", "/operator/queue", "/operator/plan", `/fields/${fieldId}/why`, `/fields/${fieldId}/slot-link`, "/facilitator/fields"]) {
      const response = await request(app).get(path).set(bearer("officer"));
      expect([403, 404]).toContain(response.status);
      expectNoPhone(response.body, `officer GET ${path}`);
    }
  });

  it("public responses", async () => {
    expectNoPhone((await request(app).get("/public/summary").expect(200)).body, "GET /public/summary");
    const proof = await request(app).get("/public/proof");
    expect([200, 404]).toContain(proof.status);
    expectNoPhone(proof.body, "GET /public/proof");
    expectNoPhone((await request(app).get("/healthz").expect(200)).body, "GET /healthz");
  });

  it("nor in what a facilitator or operator sees of the booking", async () => {
    expectNoPhone((await request(app).get("/facilitator/fields").set(bearer("facilitator")).expect(200)).body, "GET /facilitator/fields");
    expectNoPhone((await request(app).get("/operator/board").set(bearer("operator")).expect(200)).body, "GET /operator/board");
    expectNoPhone((await request(app).get("/operator/queue").set(bearer("operator")).expect(200)).body, "GET /operator/queue");
  });
});
