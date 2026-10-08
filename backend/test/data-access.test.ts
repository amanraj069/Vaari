/**
 * Access patterns through the API: a facilitator sees only the fields they booked (booked-by-index),
 * a slot link opens exactly one field (chcId + fieldId in the token = one GetItem), and demo
 * personas never overwrite a real user's profile, not even through a demo reset.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Principal, TokenVerifier } from "../src/auth/tokens";
import { DEMO_CHC_ID, DEMO_USERS } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { farmerFieldSchema, meSchema, queueItemSchema } from "../src/shared";

let runtime: Awaited<ReturnType<typeof buildRuntime>>;
let app: ReturnType<typeof createApp>;
let googleApp: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const villageId = async () => (await request(app).get("/villages").set(bearer(tokens.farmer!)).expect(200)).body[0].id as string;

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["farmer", "facilitator", "operator"]) {
    tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
  }
  // A stand-in for Cognito: the bearer token is the user id, the profile comes from the store.
  const store = runtime.dependencies.store;
  const googleVerifier: TokenVerifier = {
    async verify(token): Promise<Principal> {
      const user = await store.getUser(token);
      return { userId: token, name: user?.name ?? "Google user", role: user?.role ?? null, chcId: user?.chcId ?? null, farmerId: user?.farmerId ?? null, demo: false };
    },
  };
  googleApp = createApp({ ...runtime.dependencies, verifier: googleVerifier });
});

describe("facilitator bookings", () => {
  it("lists only the fields this facilitator booked", async () => {
    const { planner } = runtime.dependencies;
    const input = { villageId: await villageId(), acres: 2, readyDate: "2026-11-02", waitingLimitDays: 6 };
    const mine = await planner.requestField(DEMO_CHC_ID, { farmerId: "farmer-booked-1", farmerName: "Booked One", bookedBy: DEMO_USERS.facilitator }, input);
    const theirs = await planner.requestField(DEMO_CHC_ID, { farmerId: "farmer-booked-2", farmerName: "Booked Two", bookedBy: "another-facilitator" }, input);
    const response = await request(app).get("/facilitator/fields").set(bearer(tokens.facilitator!)).expect(200);
    const ids = response.body.items.map((item: unknown) => queueItemSchema.parse(item).fieldId);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    // Seeded fields were booked by nobody, so they do not appear either.
    expect(ids).not.toContain("f-jaswinder");
  });

  it("is only for facilitators", async () => {
    await request(app).get("/facilitator/fields").set(bearer(tokens.farmer!)).expect(403);
  });
});

describe("slot links", () => {
  it("opens exactly one field without signing in", async () => {
    const link = await request(app).get("/fields/f-jaswinder/slot-link").set(bearer(tokens.farmer!)).expect(200);
    expect(link.body.path).toBe(`/slot/${link.body.token}`);
    const slot = await request(app).get(`/slot/${link.body.token}`).expect(200);
    expect(farmerFieldSchema.parse(slot.body).id).toBe("f-jaswinder");
  });

  it("rejects a tampered token and refuses links to other farmers' fields", async () => {
    const link = await request(app).get("/fields/f-jaswinder/slot-link").set(bearer(tokens.farmer!)).expect(200);
    const tampered = `${link.body.token.slice(0, -4)}AAAA`;
    await request(app).get(`/slot/${tampered}`).expect(401);
    await request(app).get("/fields/f-sim-00/slot-link").set(bearer(tokens.farmer!)).expect(403);
  });
});

describe("real users and demo personas", () => {
  const realUser = "google-real-user-1";

  it("a demo persona cannot change any profile", async () => {
    await request(app).post("/me/profile").set(bearer(tokens.farmer!)).send({ name: "X", role: "operator", chcId: DEMO_CHC_ID, language: "en" }).expect(403);
  });

  it("a real user's profile survives a demo reset", async () => {
    await request(googleApp).post("/me/profile").set(bearer(realUser)).send({ name: "Simran Kaur", role: "operator", chcId: DEMO_CHC_ID, language: "pa" }).expect(200);
    await request(app).post("/operator/demo/reset").set(bearer(tokens.operator!)).expect(200);
    const me = meSchema.parse((await request(googleApp).get("/me").set(bearer(realUser)).expect(200)).body);
    expect(me).toMatchObject({ name: "Simran Kaur", role: "operator", chcId: DEMO_CHC_ID, language: "pa", needsOnboarding: false });
    // And the reset re-created the demo personas without touching the real user.
    expect((await runtime.dependencies.store.getUser(DEMO_USERS.operator))?.name).toBe("Harpal Singh");
  });
});
