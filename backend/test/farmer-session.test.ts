/**
 * Farmers have no account. A one-time login link (typ "farmer-login", 15 minutes, single use)
 * becomes a 7-day phone session that reads every field booked with that phone, across CHCs, and
 * nothing else. In DEMO_MODE the farmer persona signs in with the same kind of link.
 */
import request from "supertest";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { exchangeFarmerLogin, FARMER_LOGIN_SECONDS, mintFarmerLoginLink, verifyFarmerSession } from "../src/auth/farmer-session";
import { AuthError } from "../src/auth/tokens";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { farmerHomeSchema } from "../src/shared";
import { bookingInput, farmerSession, testPhone } from "./helpers";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const tokens: Record<string, string> = {};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator"]) tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
});

describe("farmer login link", () => {
  it("is exchanged once for a session scoped to its phone; a second use is refused", async () => {
    const { config, store } = runtime.dependencies;
    const link = await mintFarmerLoginLink(config, store, DEMO_FARMER_PHONE);
    expect(link.path).toBe(`/farmer/login/${link.token}`);
    const first = await request(app).post("/farmer/login").send({ token: link.token }).expect(200);
    expect(first.body.expiresIn).toBe(7 * 24 * 60 * 60);
    expect(await verifyFarmerSession(config, first.body.sessionToken)).toEqual({ kind: "farmerPhone", phone: DEMO_FARMER_PHONE });
    expect((await request(app).post("/farmer/login").send({ token: link.token }).expect(401)).body.error).toBe("UNAUTHENTICATED");
  });

  it("expires after 15 minutes", async () => {
    const { config, store } = runtime.dependencies;
    const minted = new Date(Date.now() - (FARMER_LOGIN_SECONDS + 5) * 1000);
    const stale = await mintFarmerLoginLink(config, store, DEMO_FARMER_PHONE, minted);
    await expect(exchangeFarmerLogin(config, store, stale.token)).rejects.toBeInstanceOf(AuthError);
    await request(app).post("/farmer/login").send({ token: stale.token }).expect(401);
  });

  it("refuses a tampered link, a forged one, and any other kind of token", async () => {
    const { config, store } = runtime.dependencies;
    const link = await mintFarmerLoginLink(config, store, DEMO_FARMER_PHONE);
    await request(app).post("/farmer/login").send({ token: `${link.token.slice(0, -4)}AAAA` }).expect(401);
    // Correctly signed, but its jti was never stored (not minted by us): refused.
    const forged = await new SignJWT({ typ: "farmer-login", phone: DEMO_FARMER_PHONE })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("vaari")
      .setAudience("vaari-farmer-login")
      .setJti("never-minted")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(config.SLOT_TOKEN_SECRET));
    await request(app).post("/farmer/login").send({ token: forged }).expect(401);
    // A slot link or a session is not a login link, and a login link is not a session.
    const slotLink = (await request(app).get("/fields/f-jaswinder/slot-link").set(bearer(tokens.operator!)).expect(200)).body.token;
    await request(app).post("/farmer/login").send({ token: slotLink }).expect(401);
    await request(app).get("/farmer/home").set(bearer(slotLink)).expect(401);
    await request(app).get("/farmer/home").set(bearer(link.token)).expect(401);
    await request(app).get("/farmer/home").expect(401);
    // A signed-in user's token is not a phone session either.
    await request(app).get("/farmer/home").set(bearer(tokens.operator!)).expect(401);
  });

  it("is minted only for a phone number in E.164", async () => {
    const { config, store } = runtime.dependencies;
    await expect(mintFarmerLoginLink(config, store, "98765 43210")).rejects.toThrow("E.164");
  });
});

describe("/farmer/home (phone session)", () => {
  it("lists every field booked with that phone, in every CHC, newest first, and nobody else's", async () => {
    const phone = testPhone(401);
    const { store } = runtime.dependencies;
    const villageId = (await request(app).get("/villages").set(bearer(tokens.facilitator!)).expect(200)).body[0].id;
    const thisSeason = (await request(app).post("/fields").set(bearer(tokens.facilitator!)).send(bookingInput(villageId, { farmerPhone: phone })).expect(201)).body.field.id;
    // The same phone booked last season at another CHC (written straight to the store).
    const seeded = (await store.getField(DEMO_CHC_ID, "f-sim-00"))!;
    await store.putChc({ ...(await store.getChc(DEMO_CHC_ID))!, id: "chc-other", name: "Other Society" });
    await store.putField({ ...seeded, chcId: "chc-other", id: "f-old", farmerPhone: phone, createdAt: "2025-10-20T08:00:00.000Z", state: "done" });
    // Someone else's field in the same CHC.
    await request(app).post("/fields").set(bearer(tokens.facilitator!)).send(bookingInput(villageId, { farmerPhone: testPhone(402) })).expect(201);

    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home?lang=pa").set(bearer(await farmerSession(app, runtime, phone))).expect(200)).body);
    expect(home.fields.map((field) => `${field.chcId}/${field.id}`)).toEqual([`${DEMO_CHC_ID}/${thisSeason}`, "chc-other/f-old"]);
    expect(home.fields.map((field) => field.chcName)).toEqual(["Balian Cooperative Society", "Other Society"]);
    expect(home.farmerName).toBe("Paramjit Kaur");
    expect(home.fields[0]!.history).toBeDefined();
    // The farmer's own number is not repeated back.
    expect(JSON.stringify(home)).not.toContain(phone.slice(3));
    await store.clearChcData("chc-other");
  });

  it("is read-only: a phone session can change nothing", async () => {
    const session = bearer(await farmerSession(app, runtime, DEMO_FARMER_PHONE));
    await request(app).post("/farmer/home").set(session).send({}).expect(404);
    await request(app).post("/fields").set(session).send({}).expect(401);
    await request(app).post("/fields/f-jaswinder/slot-link/reissue").set(session).expect(401);
    await request(app).post("/operator/fields/f-jaswinder/sown").set(session).send({}).expect(401);
    await request(app).get("/fields/f-jaswinder/slot-link").set(session).expect(401);
  });
});

describe("demo farmer persona", () => {
  it("signs in with a one-time phone login link, as the WhatsApp bot will", async () => {
    const demo = await request(app).post("/auth/demo").send({ role: "farmer" }).expect(200);
    expect(demo.body).toMatchObject({ persona: "farmer" });
    expect(demo.body.accessToken).toBeUndefined();
    const token = String(demo.body.loginPath).replace("/farmer/login/", "");
    const session = (await request(app).post("/farmer/login").send({ token }).expect(200)).body.sessionToken;
    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(bearer(session)).expect(200)).body);
    expect(home.fields.map((field) => field.id)).toEqual(["f-jaswinder"]);
    expect(home.farmerName).toBe("Jaswinder Singh");
  });

  it("is off when DEMO_MODE is off", async () => {
    const off = createApp({ ...runtime.dependencies, config: { ...runtime.dependencies.config, DEMO_MODE: false } });
    await request(off).post("/auth/demo").send({ role: "farmer" }).expect(404);
  });
});
