/**
 * The demo season's ready days come from the real harvest curves (data/harvest_curves.json),
 * inside the booking window around the demo day, and seeding never touches real users.
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { dateToDay } from "../src/shared";
import { isDemoFarmerPhone } from "../src/demo/phones";
import { DEMO_CHC_ID, DEMO_USERS, loadHarvestCurves, seedDemo } from "../src/demo/seed";
import { MemoryStore } from "../src/store/memory";

describe("demo seed", () => {
  const config = loadConfig({ NODE_ENV: "test" });
  const today = dateToDay(config.SEASON_START_DATE, config.DATE_TODAY);
  const curves = loadHarvestCurves(config);
  const curveByVillage = new Map(curves.villages.map((curve) => [curve.villageId, new Map(curve.readyDays)]));
  const district = new Map(curves.district.readyDays);

  it("draws every ready day from the village's harvest curve (or the district's) inside the booking window", async () => {
    const store = new MemoryStore();
    await seedDemo(store, config, config.DATE_TODAY);
    const fields = await store.listFields(DEMO_CHC_ID);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.readyDay).toBeGreaterThanOrEqual(today - 2);
      expect(field.readyDay).toBeLessThanOrEqual(today + 7);
      // Season starts on 1 October, so the day index is the curve's day offset.
      const probability = curveByVillage.get(field.villageId)?.get(field.readyDay) ?? district.get(field.readyDay) ?? 0;
      expect(probability, `${field.id} ready day ${field.readyDay} in ${field.villageId}`).toBeGreaterThan(0);
      expect(field.waitingLimitDays).toBeGreaterThanOrEqual(3);
      expect(field.waitingLimitDays).toBeLessThanOrEqual(10);
    }
  });

  it("is the same season on every reset", async () => {
    const first = new MemoryStore();
    const second = new MemoryStore();
    await seedDemo(first, config, config.DATE_TODAY);
    await seedDemo(second, config, config.DATE_TODAY);
    expect(await second.listFields(DEMO_CHC_ID)).toEqual(
      // Timestamps are when the seed ran; everything else is identical.
      (await first.listFields(DEMO_CHC_ID)).map((field) => ({ ...field, createdAt: expect.any(String), consentAt: field.consentAt === null ? null : expect.any(String) })),
    );
  });

  it("gives the demo helper six bookings, each with the farmer's phone and consent, all demo phones (never messaged)", async () => {
    const store = new MemoryStore();
    await seedDemo(store, config, config.DATE_TODAY);
    const helpers = (await store.listFields(DEMO_CHC_ID)).filter((field) => field.bookedBy === DEMO_USERS.facilitator);
    expect(helpers).toHaveLength(6);
    for (const field of helpers) {
      expect(field.farmerPhone).toMatch(/^\+447700900\d{3}$/);
      expect(field.consentBy).toBe(DEMO_USERS.facilitator);
      expect(isDemoFarmerPhone(config, field.farmerPhone!)).toBe(true);
    }
  });

  it("never overwrites a real user's profile", async () => {
    const store = new MemoryStore();
    const realUser = { userId: "google-sub-123", name: "Real Person", role: "operator" as const, chcId: DEMO_CHC_ID, language: "pa" as const };
    await store.putUser(realUser);
    await seedDemo(store, config, config.DATE_TODAY);
    expect(await store.getUser(realUser.userId)).toEqual(realUser);
  });
});
