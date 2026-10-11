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
import { loadDistrictOutlines, districtAt } from "../src/data/boundaries";
import { DEMO_CHC_ID, DEMO_OFFICER_DISTRICT } from "../src/demo/seed";
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
    // The demo officer runs Sangrur: Balian and the 19 simulated centres inside Sangrur's outline.
    expect(overview.totals.centres).toBe(20);
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

describe("the officer's own district", () => {
  it("shows the officer only their district's centres, villages, loans and outline", async () => {
    const { config, store } = runtime.dependencies;
    const outlines = loadDistrictOutlines(config.DATA_DIR);
    const chcs = await store.listChcs();
    const sangrurIds = chcs.filter((chc) => districtAt(chc.base.lon, chc.base.lat, outlines) === DEMO_OFFICER_DISTRICT).map((chc) => chc.id);
    const otherIds = chcs.map((chc) => chc.id).filter((id) => !sangrurIds.includes(id));
    expect(otherIds.length).toBeGreaterThan(0); // Malerkotla's centres exist, and stay hidden
    expect(overview.centres.map((centre) => centre.id).sort()).toEqual([...sangrurIds].sort());
    expect(overview.districts.map((district) => district.name)).toEqual([DEMO_OFFICER_DISTRICT]);
    for (const village of overview.villages) expect(sangrurIds).toContain(village.centreId);
    for (const move of overview.outlook.moves) {
      expect(sangrurIds).toContain(move.fromCentreId);
      expect(sangrurIds).toContain(move.toCentreId);
    }
    for (const id of otherIds) expect(overviewText).not.toContain(id);
  });

  it("refuses a loan that touches another district's centre", async () => {
    const { config, store } = runtime.dependencies;
    const outlines = loadDistrictOutlines(config.DATA_DIR);
    const malerkotla = (await store.listChcs()).find((chc) => districtAt(chc.base.lon, chc.base.lat, outlines) === "Malerkotla")!;
    const officer = (await request(app).post("/auth/demo").send({ role: "officer" }).expect(200)).body.accessToken as string;
    for (const pair of [{ fromChcId: DEMO_CHC_ID, toChcId: malerkotla.id }, { fromChcId: malerkotla.id, toChcId: DEMO_CHC_ID }]) {
      expect((await request(app).post("/officer/loans").set({ authorization: `Bearer ${officer}` }).send(pair)).status).toBe(403);
    }
    expect((await store.listMachines(DEMO_CHC_ID)).some((machine) => machine.loan)).toBe(false);
  });

  it("tells the officer which district is theirs", async () => {
    const officer = (await request(app).post("/auth/demo").send({ role: "officer" }).expect(200)).body.accessToken as string;
    const me = (await request(app).get("/me").set({ authorization: `Bearer ${officer}` }).expect(200)).body;
    expect(me.district).toBe(DEMO_OFFICER_DISTRICT);
  });
});

describe("the officer's fleet counts", () => {
  it("places every centre in the officer's district, and the fleets add up to the district's machines", () => {
    for (const centre of overview.centres) {
      expect(centre.district, centre.name).toBe(DEMO_OFFICER_DISTRICT);
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
