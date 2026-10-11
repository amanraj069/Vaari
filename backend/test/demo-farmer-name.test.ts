/**
 * Every visitor's "Try as farmer" signs in with the same demo phone, so its name belongs to the seed.
 * Once a visitor cancelled Jaswinder's field, the phone had no booking, the dashboard asked for a
 * name, and the name typed there ("Aman Raj") became the demo farmer's for everyone after. The seed
 * now writes the demo phone's account, and a reset puts it back.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { farmerSession } from "./helpers";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  app = createApp(runtime.dependencies);
});

describe("the demo farmer's name", () => {
  it("stays Jaswinder Singh after the field is cancelled: no name is asked for, none is taken", async () => {
    const jaswinder = { authorization: `Bearer ${await farmerSession(app, runtime, DEMO_FARMER_PHONE)}` };
    await request(app).post(`/farmer/fields/${DEMO_CHC_ID}/f-jaswinder/cancel`).set(jaswinder).expect(200);
    const home = await request(app).get("/farmer/home").set(jaswinder).expect(200);
    expect(home.body).toMatchObject({ registered: true, farmerName: "Jaswinder Singh", fields: [] });
    const named = await request(app).post("/farmer/account").set(jaswinder).send({ name: "Aman Raj", consent: true, language: "en" }).expect(200);
    expect(named.body.name).toBe("Jaswinder Singh");
    expect((await request(app).get("/farmer/me").set(jaswinder).expect(200)).body).toEqual({ name: "Jaswinder Singh", registered: true });
  });

  it("a reset replaces any other name on the demo phone", async () => {
    const { store } = runtime.dependencies;
    const at = new Date().toISOString();
    await store.putFarmerAccount({ phone: DEMO_FARMER_PHONE, farmerId: "farmer-visitor", name: "Aman Raj", language: "en", consentAt: at, consentBy: "farmer", createdAt: at });
    const operator = (await request(app).post("/auth/demo").send({ role: "operator" }).expect(200)).body.accessToken as string;
    await request(app).post("/operator/demo/reset").set({ authorization: `Bearer ${operator}` }).expect(200);
    const jaswinder = { authorization: `Bearer ${await farmerSession(app, runtime, DEMO_FARMER_PHONE)}` };
    expect((await request(app).get("/farmer/me").set(jaswinder).expect(200)).body).toEqual({ name: "Jaswinder Singh", registered: true });
    expect(await store.getFarmerAccount(DEMO_FARMER_PHONE)).toMatchObject({ farmerId: "farmer-jaswinder", name: "Jaswinder Singh" });
  });
});
