/**
 * A new Google user (no Cognito group, no profile) is "pending": /me says onboarding is needed,
 * Cedar refuses everything, and after picking a role and CHC on /welcome the app works for them.
 * The Cognito verifier is replaced by a stand-in that resolves the role the same way: stored profile.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { meSchema } from "../src/shared";
import { createApp } from "../src/app";
import type { Principal, TokenVerifier } from "../src/auth/tokens";
import { buildRuntime } from "../src/server";

let app: ReturnType<typeof createApp>;
const bearer = (userId: string) => ({ authorization: `Bearer ${userId}` });

beforeAll(async () => {
  const { dependencies } = await buildRuntime({ freshDemo: true });
  const store = dependencies.store;
  const stubVerifier: TokenVerifier = {
    async verify(token): Promise<Principal> {
      const user = await store.getUser(token);
      return { userId: token, name: user?.name ?? "Google user", role: user?.role ?? null, chcId: user?.chcId ?? null, demo: false };
    },
  };
  app = createApp({ ...dependencies, store, verifier: stubVerifier });
});

describe("onboarding a Google user", () => {
  it("a new user needs onboarding and is refused by Cedar meanwhile", async () => {
    const me = meSchema.parse((await request(app).get("/me").set(bearer("google-new")).expect(200)).body);
    expect(me).toMatchObject({ role: null, needsOnboarding: true, demo: false });
    await request(app).get("/operator/board").set(bearer("google-new")).expect(403);
  });

  it("lists CHCs to choose from", async () => {
    const response = await request(app).get("/chcs").set(bearer("google-new")).expect(200);
    expect(response.body[0]).toMatchObject({ id: "chc-balian", machineCount: 4 });
  });

  it("an operator who picks a CHC can open its board", async () => {
    const response = await request(app)
      .post("/me/profile")
      .set(bearer("google-operator"))
      .send({ name: "Aman", role: "operator", chcId: "chc-balian", language: "en" })
      .expect(200);
    expect(meSchema.parse(response.body)).toMatchObject({ role: "operator", chcId: "chc-balian", needsOnboarding: false });
    await request(app).get("/operator/board").set(bearer("google-operator")).expect(200);
  });

  it("nobody can sign up as a farmer: farmers have no account, only a phone", async () => {
    await request(app).post("/me/profile").set(bearer("google-farmer")).send({ name: "Simran Kaur", role: "farmer", chcId: "chc-balian", language: "pa" }).expect(400);
    const me = meSchema.parse((await request(app).get("/me").set(bearer("google-farmer")).expect(200)).body);
    expect(me).toMatchObject({ role: null, needsOnboarding: true });
    // A signed-in user's token is not a farmer phone session.
    await request(app).get("/farmer/home").set(bearer("google-farmer")).expect(401);
  });

  it("rejects unknown CHCs and roles without pages", async () => {
    await request(app).post("/me/profile").set(bearer("google-x")).send({ name: "X", role: "operator", chcId: "nope", language: "en" }).expect(404);
    await request(app).post("/me/profile").set(bearer("google-x")).send({ name: "X", role: "officer", chcId: "chc-balian", language: "en" }).expect(400);
  });
});
