/**
 * A farmer signs in with their phone and a one-time code; a new one then gives their name and
 * consent; then they book fields for their own phone. Codes: six digits, 10 minutes, 5 tries, once;
 * a new one at most every 30 seconds. Delivery is on screen in DEMO_MODE, or a WhatsApp
 * authentication template. Test numbers: +91 90000 00xxx (DEMO delivery sends nothing anywhere) or
 * Ofcom's fiction range.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { verifyFarmerSession } from "../src/auth/farmer-session";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { bookingSchema, farmerBookingOptionsSchema, farmerHomeSchema, farmerOtpSentSchema } from "../src/shared";
import { farmerSession, testPhone } from "./helpers";
import { whatsappRuntime } from "./whatsapp-helpers";

const PROXY_SECRET = "test-proxy-secret-for-farmer-codes-0000";
let clientCount = 0;
/** Each request from its own browser address (vouched for like the Next proxy does), so the per-client limit never trips. */
const fromNewClient = () => ({ "x-vaari-proxy-secret": PROXY_SECRET, "x-vaari-client-ip": `10.0.${Math.floor(++clientCount / 250)}.${(clientCount % 250) + 1}` });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

type App = ReturnType<typeof createApp>;
type Runtime = Awaited<ReturnType<typeof buildRuntime>>;

const askCode = (app: App, phone: string, language = "en") => request(app).post("/farmer/otp/request").set(fromNewClient()).send({ phone, language });
const sendCode = (app: App, phone: string, code: string) => request(app).post("/farmer/otp/verify").set(fromNewClient()).send({ phone, code });
const wrongCodeFor = (code: string) => (code === "000000" ? "111111" : "000000");

/** A new farmer, the whole way: code, then name and consent. Returns the session. */
async function register(app: App, phone: string, name = "Paramjit Kaur"): Promise<string> {
  const code = (await askCode(app, phone).expect(200)).body.demoCode as string;
  const verified = await sendCode(app, phone, code).expect(200);
  expect(verified.body.registered).toBe(false);
  await request(app).post("/farmer/account").set(bearer(verified.body.sessionToken)).send({ name, consent: true, language: "en" }).expect(201);
  return verified.body.sessionToken as string;
}

describe("farmer sign-in with a code shown on screen (DEMO_MODE)", () => {
  let app: App;
  let runtime: Runtime;

  beforeAll(async () => {
    runtime = await buildRuntime({ freshDemo: true, config: { PROXY_SHARED_SECRET: PROXY_SECRET } });
    app = createApp(runtime.dependencies);
  });

  it("a new number: the code gives a session for that phone, once; then name and consent make the account", async () => {
    const phone = "+919000000201";
    const sent = farmerOtpSentSchema.parse((await askCode(app, "90000 00201").expect(200)).body);
    expect(sent).toMatchObject({ channel: "demo", expiresInSeconds: 600, resendInSeconds: 30 });
    expect(sent.demoCode).toMatch(/^\d{6}$/);
    // Only an HMAC of the code is stored.
    const stored = await runtime.dependencies.store.getOtpChallenge(phone);
    expect(stored).toMatchObject({ attempts: 0, language: "en" });
    expect(JSON.stringify(stored)).not.toContain(sent.demoCode);

    const wrong = await sendCode(app, phone, wrongCodeFor(sent.demoCode!)).expect(401);
    expect(wrong.body).toEqual({ error: "CODE_WRONG", attemptsLeft: 4 });
    const right = await sendCode(app, phone, sent.demoCode!).expect(200);
    expect(right.body).toMatchObject({ expiresIn: 7 * 24 * 60 * 60, registered: false });
    expect(await verifyFarmerSession(runtime.dependencies.config, right.body.sessionToken)).toEqual({ kind: "farmerPhone", phone });
    expect((await sendCode(app, phone, sent.demoCode!).expect(401)).body.error).toBe("CODE_EXPIRED");

    // Not registered yet: the page asks for the name first; no account exists until then.
    const session = right.body.sessionToken as string;
    expect(farmerHomeSchema.parse((await request(app).get("/farmer/home").set(bearer(session)).expect(200)).body)).toMatchObject({ registered: false, fields: [] });
    expect(await runtime.dependencies.store.getFarmerAccount(phone)).toBeNull();
    expect((await request(app).post("/farmer/account").set(bearer(session)).send({ name: "Paramjit Kaur", consent: false, language: "pa" }).expect(400)).body.error).toBe("CONSENT_REQUIRED");
    await request(app).post("/farmer/account").set(bearer(session)).send({ name: "", consent: true, language: "pa" }).expect(400);
    expect((await request(app).post("/farmer/account").set(bearer(session)).send({ name: "Paramjit Kaur", consent: true, language: "pa" }).expect(201)).body).toEqual({ name: "Paramjit Kaur" });
    expect(await runtime.dependencies.store.getFarmerAccount(phone)).toMatchObject({ phone, name: "Paramjit Kaur", consentBy: "farmer", language: "pa" });
    // Never renamed, never a second record.
    expect((await request(app).post("/farmer/account").set(bearer(session)).send({ name: "Somebody Else", consent: true, language: "en" }).expect(200)).body).toEqual({ name: "Paramjit Kaur" });
    expect(farmerHomeSchema.parse((await request(app).get("/farmer/home").set(bearer(session)).expect(200)).body)).toMatchObject({ registered: true, farmerName: "Paramjit Kaur" });
    await request(app).post("/farmer/account").send({ name: "Nobody", consent: true, language: "en" }).expect(401);
  });

  it("a returning farmer is known at once", async () => {
    const phone = "+919000000207";
    await register(app, phone, "Harpreet Kaur");
    const code = (await askCode(app, phone).expect(200)).body.demoCode as string;
    expect((await sendCode(app, phone, code).expect(200)).body.registered).toBe(true);
  });

  it("refuses a malformed phone or code", async () => {
    await askCode(app, "12345").expect(400);
    await sendCode(app, "+919000000202", "12ab56").expect(400);
    expect(await runtime.dependencies.store.getOtpChallenge("+919000000202")).toBeNull();
  });

  it("sends a new code at most every 30 seconds; the new code replaces the old one", async () => {
    const phone = "+919000000203";
    const first = (await askCode(app, phone).expect(200)).body.demoCode as string;
    const again = await askCode(app, phone).expect(429);
    expect(again.body.error).toBe("RESEND_TOO_SOON");
    expect(again.body.retryInSeconds).toBeGreaterThan(0);
    expect(again.body.retryInSeconds).toBeLessThanOrEqual(30);
    const challenge = (await runtime.dependencies.store.getOtpChallenge(phone))!;
    await runtime.dependencies.store.putOtpChallenge({ ...challenge, sentAt: new Date(Date.now() - 31_000).toISOString() });
    const second = (await askCode(app, phone).expect(200)).body.demoCode as string;
    if (second !== first) expect((await sendCode(app, phone, first).expect(401)).body.error).toBe("CODE_WRONG");
    await sendCode(app, phone, second).expect(200);
  });

  it("locks a code after 5 wrong tries, and refuses an expired one", async () => {
    const phone = "+919000000204";
    const code = (await askCode(app, phone).expect(200)).body.demoCode as string;
    for (let attempt = 1; attempt <= 4; attempt++) expect((await sendCode(app, phone, wrongCodeFor(code)).expect(401)).body).toEqual({ error: "CODE_WRONG", attemptsLeft: 5 - attempt });
    expect((await sendCode(app, phone, wrongCodeFor(code)).expect(401)).body.error).toBe("CODE_LOCKED");
    expect((await sendCode(app, phone, code).expect(401)).body.error).toBe("CODE_LOCKED");

    const later = "+919000000205";
    const laterCode = (await askCode(app, later).expect(200)).body.demoCode as string;
    const challenge = (await runtime.dependencies.store.getOtpChallenge(later))!;
    await runtime.dependencies.store.putOtpChallenge({ ...challenge, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await sendCode(app, later, laterCode).expect(401)).body.error).toBe("CODE_EXPIRED");
  });

  it("a phone a helper booked for is known at once: its account comes from that booking, never a second one", async () => {
    const code = (await askCode(app, DEMO_FARMER_PHONE).expect(200)).body.demoCode as string;
    const verified = (await sendCode(app, DEMO_FARMER_PHONE, code).expect(200)).body;
    expect(verified.registered).toBe(true);
    const account = await runtime.dependencies.store.getFarmerAccount(DEMO_FARMER_PHONE);
    expect(account).toMatchObject({ name: "Jaswinder Singh", farmerId: "farmer-jaswinder" });
    expect(account?.consentBy).not.toBe("farmer"); // the helper recorded the consent
    // Sending a name now changes nothing.
    expect((await request(app).post("/farmer/account").set(bearer(verified.sessionToken)).send({ name: "Other", consent: true, language: "en" }).expect(200)).body).toEqual({ name: "Jaswinder Singh" });
    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(bearer(verified.sessionToken)).expect(200)).body);
    expect(home.registered).toBe(true);
    expect(home.fields.length).toBeGreaterThan(0);
  });
});

describe("a farmer books for their own phone", () => {
  let app: App;
  let runtime: Runtime;
  let session: string;
  let operatorToken: string;
  const phone = "+919000000221";

  beforeAll(async () => {
    runtime = await buildRuntime({ freshDemo: true, config: { PROXY_SHARED_SECRET: PROXY_SECRET } });
    app = createApp(runtime.dependencies);
    session = await register(app, phone, "Gurpreet Singh");
    operatorToken = (await request(app).post("/auth/demo").send({ role: "operator" }).expect(200)).body.accessToken;
  });

  const readyDate = async () => {
    const options = farmerBookingOptionsSchema.parse((await request(app).get("/farmer/booking-options").set(bearer(session)).expect(200)).body);
    return { options, readyDate: options.today };
  };

  it("lists every village a machine centre serves, with that centre", async () => {
    const { options } = await readyDate();
    expect(options.villages.length).toBeGreaterThan(0);
    expect(options.villages.some((village) => village.chcId === DEMO_CHC_ID)).toBe(true);
    expect(new Set(options.villages.map((village) => village.id)).size).toBe(options.villages.length);
  });

  it("books a field: it shows on their page, in the operator's queue, and the answer carries no phone", async () => {
    const { options, readyDate: today } = await readyDate();
    const village = options.villages.find((item) => item.chcId === DEMO_CHC_ID)!;
    const response = await request(app).post("/farmer/fields").set(bearer(session)).set("origin", "http://localhost:3000").send({ villageId: village.id, acres: 4, readyDate: today, waitingLimitDays: 6 }).expect(201);
    const booking = bookingSchema.parse(response.body);
    expect(JSON.stringify(response.body)).not.toContain(phone);
    expect(booking.slot.path).toMatch(/^\/slot\//);

    const stored = await runtime.dependencies.store.getField(DEMO_CHC_ID, booking.field.id);
    expect(stored).toMatchObject({ farmerPhone: phone, farmerName: "Gurpreet Singh", bookedBy: null, consentBy: "farmer" });
    const home = farmerHomeSchema.parse((await request(app).get("/farmer/home").set(bearer(session)).expect(200)).body);
    expect(home.fields.map((field) => field.id)).toContain(booking.field.id);
    const queue = await request(app).get("/operator/queue").set(bearer(operatorToken)).expect(200);
    expect(JSON.stringify(queue.body)).toContain(booking.field.id);
  });

  it("refuses an unknown village, a ready date out of range, and bad input", async () => {
    const { options, readyDate: today } = await readyDate();
    const villageId = options.villages[0]!.id;
    await request(app).post("/farmer/fields").set(bearer(session)).send({ villageId: "nowhere", acres: 2, readyDate: today, waitingLimitDays: 5 }).expect(404);
    expect((await request(app).post("/farmer/fields").set(bearer(session)).send({ villageId, acres: 2, readyDate: "2027-06-01", waitingLimitDays: 5 }).expect(400)).body.error).toBe("READY_DATE_OUT_OF_RANGE");
    await request(app).post("/farmer/fields").set(bearer(session)).send({ villageId, acres: 0, readyDate: today, waitingLimitDays: 5 }).expect(400);
  });

  it("a farmer who came in by a login link books too: their account comes from the helper's booking", async () => {
    const { options, readyDate: today } = await readyDate();
    const jaswinder = await farmerSession(app, runtime, DEMO_FARMER_PHONE);
    await request(app).post("/farmer/fields").set(bearer(jaswinder)).send({ villageId: options.villages[0]!.id, acres: 2, readyDate: today, waitingLimitDays: 5 }).expect(201);
    expect(await runtime.dependencies.store.getFarmerAccount(DEMO_FARMER_PHONE)).toMatchObject({ name: "Jaswinder Singh", farmerId: "farmer-jaswinder" });
  });

  it("needs a phone with an account or a booking: not a session that has not finished signing up, not staff, not nobody", async () => {
    const { options, readyDate: today } = await readyDate();
    const body = { villageId: options.villages[0]!.id, acres: 2, readyDate: today, waitingLimitDays: 5 };
    const unregistered = await farmerSession(app, runtime, testPhone(222));
    expect((await request(app).post("/farmer/fields").set(bearer(unregistered)).send(body).expect(403)).body.error).toBe("NOT_REGISTERED");
    await request(app).post("/farmer/fields").set(bearer(operatorToken)).send(body).expect(401);
    await request(app).post("/farmer/fields").send(body).expect(401);
    await request(app).get("/farmer/booking-options").expect(401);
  });

  it("holds at most 10 unsown fields per phone", async () => {
    const { options, readyDate: today } = await readyDate();
    const villageId = options.villages[0]!.id;
    const open = (await runtime.dependencies.store.listFieldsByPhone(phone)).filter((field) => field.state !== "done").length;
    for (let count = open; count < 10; count++) await request(app).post("/farmer/fields").set(bearer(session)).send({ villageId, acres: 1, readyDate: today, waitingLimitDays: 5 }).expect(201);
    expect((await request(app).post("/farmer/fields").set(bearer(session)).send({ villageId, acres: 1, readyDate: today, waitingLimitDays: 5 }).expect(409)).body.error).toBe("TOO_MANY_FIELDS");
  });
});

describe("sign-in codes on WhatsApp", () => {
  const allowed = testPhone(301);

  it("sends the code in the authentication template, never in the answer", async () => {
    const wa = await whatsappRuntime({ config: { FARMER_OTP_DELIVERY: "whatsapp", WHATSAPP_TEMPLATE_OTP: "vaari_code", WHATSAPP_ALLOWED_TEST_NUMBERS: allowed, PROXY_SHARED_SECRET: PROXY_SECRET } });
    const answer = farmerOtpSentSchema.parse((await askCode(wa.app, allowed, "pa").expect(200)).body);
    expect(answer).toEqual({ channel: "whatsapp", expiresInSeconds: 600, resendInSeconds: 30, demoCode: null });
    const sent = wa.sender.sent.at(-1);
    expect(sent).toMatchObject({ type: "authCode", to: allowed, name: "vaari_code", language: "pa" });
    expect(sent?.type === "authCode" && sent.code).toMatch(/^\d{6}$/);
    if (sent?.type === "authCode") await sendCode(wa.app, allowed, sent.code).expect(200);
  });

  it("in DEMO_MODE writes only to the test numbers; a failed send leaves no code behind", async () => {
    const wa = await whatsappRuntime({ config: { FARMER_OTP_DELIVERY: "whatsapp", WHATSAPP_TEMPLATE_OTP: "vaari_code", WHATSAPP_ALLOWED_TEST_NUMBERS: allowed, PROXY_SHARED_SECRET: PROXY_SECRET } });
    expect((await askCode(wa.app, testPhone(302)).expect(403)).body.error).toBe("NUMBER_NOT_ALLOWED");
    wa.sender.failing = true;
    expect((await askCode(wa.app, allowed).expect(503)).body.error).toBe("OTP_SEND_FAILED");
    expect(await wa.runtime.dependencies.store.getOtpChallenge(allowed)).toBeNull();
  });

  it("is closed when delivery is off", async () => {
    const runtime = await buildRuntime({ freshDemo: true, config: { FARMER_OTP_DELIVERY: "off", PROXY_SHARED_SECRET: PROXY_SECRET } });
    expect((await askCode(createApp(runtime.dependencies), testPhone(303)).expect(503)).body.error).toBe("OTP_OFF");
  });
});
