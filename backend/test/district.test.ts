/**
 * The simulated district around the demo centre: 24 more centres from the simulator's committed
 * replay as it stands on the site's today, each planned by our own planner, and the officer's
 * outlook over all of them. The replay's future never leaks in (no field booked after today), no
 * village is served twice, the demo centre's corner stays its own, and the outlook's suggestions
 * obey their rules.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { DISTRICT_CHC_PREFIX, seedDistrict } from "../src/demo/district";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { buildRuntime } from "../src/server";
import { dateToDay, officerOverviewSchema, type OfficerOverview } from "../src/shared";
import { MemoryStore } from "../src/store/memory";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
let overview: OfficerOverview;
let overviewText: string;

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true, district: true });
  app = createApp(runtime.dependencies);
  const officer = (await request(app).post("/auth/demo").send({ role: "officer" }).expect(200)).body.accessToken as string;
  const response = await request(app).get("/officer/overview").set({ authorization: `Bearer ${officer}` }).expect(200);
  overview = officerOverviewSchema.parse(response.body);
  overviewText = JSON.stringify(response.body);
}, 180_000);

describe("the simulated district", () => {
  it("has the demo centre and 24 simulated centres, each with a published plan", async () => {
    const chcs = await runtime.dependencies.store.listChcs();
    expect(chcs.filter((chc) => chc.id.startsWith(DISTRICT_CHC_PREFIX))).toHaveLength(24);
    expect(overview.totals.centres).toBe(25);
    expect(overview.centres.map((centre) => centre.id)).toContain(DEMO_CHC_ID);
    for (const centre of overview.centres) expect(centre.planDate, centre.name).not.toBeNull();
    // The replay's sown fields bring the season so far with them.
    expect(overview.totals.fieldsSown).toBeGreaterThan(0);
    expect(overview.totals.promisesKept).toBeGreaterThan(0);
  });

  it("books nothing after today and copies no plan from the replay", async () => {
    const { config, store } = runtime.dependencies;
    const today = dateToDay(config.SEASON_START_DATE, config.DATE_TODAY);
    const chcs = (await store.listChcs()).filter((chc) => chc.id.startsWith(DISTRICT_CHC_PREFIX));
    for (const chc of chcs) {
      for (const field of await store.listFields(chc.id)) {
        // Farmers ask at most 3 days before harvest (the simulator's request lead, assumed).
        expect(field.readyDay, field.id).toBeLessThanOrEqual(today + 3);
        if (field.state === "done") expect(field.plannedDay!, field.id).toBeLessThan(today);
        else if (field.plannedDay !== null) expect(field.plannedDay, field.id).toBeGreaterThan(today);
        expect(field.farmerPhone).toBeNull();
      }
    }
  });

  it("serves every village from one centre, and leaves the demo centre's villages to it", async () => {
    const chcs = await runtime.dependencies.store.listChcs();
    const demo = chcs.find((chc) => chc.id === DEMO_CHC_ID)!;
    const seen = new Set<string>();
    for (const chc of chcs) {
      for (const villageId of chc.villageIds) {
        expect(seen.has(villageId), `${villageId} served twice`).toBe(false);
        seen.add(villageId);
      }
      if (chc.id !== DEMO_CHC_ID) for (const field of await runtime.dependencies.store.listFields(chc.id)) expect(demo.villageIds).not.toContain(field.villageId);
    }
  });

  it("is the same district on every seed", async () => {
    const config = loadConfig({ NODE_ENV: "test" });
    const [first, second] = [new MemoryStore(), new MemoryStore()];
    await seedDistrict(first, config, config.DATE_TODAY, new Set());
    await seedDistrict(second, config, config.DATE_TODAY, new Set());
    const strip = (fields: Awaited<ReturnType<MemoryStore["listFields"]>>) => fields.map((field) => ({ ...field, createdAt: "" }));
    expect(strip(await second.listFields(`${DISTRICT_CHC_PREFIX}07`))).toEqual(strip(await first.listFields(`${DISTRICT_CHC_PREFIX}07`)));
    expect(await second.listMachines(`${DISTRICT_CHC_PREFIX}07`)).toEqual(await first.listMachines(`${DISTRICT_CHC_PREFIX}07`));
  });
});

describe("the officer's fleet counts", () => {
  it("places every centre in a real district, and the fleets add up to the district's machines", () => {
    const names = new Set(overview.districts.map((district) => district.name));
    for (const centre of overview.centres) {
      expect(centre.district, centre.name).not.toBeNull();
      expect(names.has(centre.district!)).toBe(true);
      expect(centre.fleet.own).toBe(centre.fleet.superSeeders + centre.fleet.happySeeders);
      expect(centre.fleet.acresBookedSeason).toBeGreaterThanOrEqual(centre.acresActive);
    }
    const own = overview.centres.reduce((sum, centre) => sum + centre.fleet.own, 0);
    const borrowed = overview.centres.reduce((sum, centre) => sum + centre.fleet.borrowedIn, 0);
    expect(own + borrowed).toBe(overview.totals.machinesTotal);
  });
});

describe("the officer's outlook", () => {
  it("adds up: district late acres are the centres' late acres, and every day has capacity", () => {
    const sum = overview.centres.reduce((total, centre) => total + centre.outlook.lateAcres, 0);
    expect(overview.outlook.lateAcres).toBeCloseTo(sum, 0);
    expect(overview.outlook.days).toHaveLength(10);
    for (const day of overview.outlook.days) expect(day.capacityAcres).toBeGreaterThan(0);
  });

  it("lends only from a centre that stays on time without the machine, within reach, and only when it helps", () => {
    const byId = new Map(overview.centres.map((centre) => [centre.id, centre]));
    const lent = new Map<string, number>();
    for (const move of overview.outlook.moves) {
      const lender = byId.get(move.fromCentreId)!;
      lent.set(lender.id, (lent.get(lender.id) ?? 0) + 1);
      expect(lender.outlook.lateAcres).toBe(0);
      expect(lender.outlook.lateIfOneDownAcres ?? Infinity).toBeLessThanOrEqual(0.5);
      expect(lender.machinesTotal - lent.get(lender.id)!).toBeGreaterThanOrEqual(1);
      expect(move.distanceKm).toBeLessThanOrEqual(overview.outlook.assumptions.maxLendKm);
      expect(move.lateAfterAcres).toBeLessThan(move.lateBeforeAcres);
      expect(byId.get(move.toCentreId)!.outlook.lateAcres).toBe(move.lateBeforeAcres);
    }
  });

  it("names no farmer and carries no field id from the district", async () => {
    const fields = await runtime.dependencies.store.listFields(`${DISTRICT_CHC_PREFIX}07`);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(overviewText.includes(`"${field.id}"`)).toBe(false);
      expect(overviewText.includes(field.farmerName)).toBe(false);
    }
  });
});
