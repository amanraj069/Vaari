/**
 * The demo season. Everything here is SIMULATED and labelled so in the UI: the CHC, the machines,
 * the farmers (invented names) and their fields. Village names and locations are real
 * (OpenStreetMap, data/villages.json). Each field's ready day is drawn from its village's harvest
 * curve (data/harvest_curves.json, built from NASA FIRMS fire detections, 2024 and 2025 seasons),
 * restricted to the booking window around the demo day. Field sizes, waiting limits and the
 * booking window are ASSUMPTIONS, labelled below. A fixed seed makes every reset the same season. Seeding writes only the demo CHC's data
 * and the three demo persona users (ids start with "demo-"); real users' profiles are never touched.
 * The farmer persona (Jaswinder) has no account: their field carries a phone number, and "Try as
 * farmer" signs in with a one-time phone login link, exactly as the WhatsApp bot will.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { dateToDay } from "../shared";
import type { Config } from "../config";
import { haversineKm } from "../data/geo";
import { sampleReadyDay, type HarvestCurves } from "../data/harvest";
import type { FieldRecord, MachineRecord, UserRecord, VaariStore, VillageRecord } from "../store/types";

export const DEMO_CHC_ID = "chc-balian";
export const DEMO_USERS = {
  facilitator: "demo-facilitator-gurpreet",
  operator: "demo-operator-harpal",
  officer: "demo-officer-sangrur",
} as const;
// SIMULATED phone for the demo farmer: Ofcom reserves +44 7700 900000-900999 for fiction, so it can
// never be a real person's number. It is never shown on any page and never messaged.
export const DEMO_FARMER_PHONE = "+447700900017";
const JASWINDER_FARMER_ID = "farmer-jaswinder";
export const DEMO_OPERATOR_NAME = "Harpal Singh";
const CLUSTER_RADIUS_KM = 6;
const FIELD_COUNT = 34;
const SEED = 20261008;

// Invented names for simulated farmers. Not real people.
const FIRST_NAMES = [
  "Gurpreet", "Baldev", "Sukhwinder", "Kulwant", "Manjit", "Paramjit", "Rajinder", "Harbhajan", "Jagdeep",
  "Amarjit", "Balwinder", "Gurmeet", "Hardeep", "Karamjit", "Lakhwinder", "Navdeep", "Ranjit", "Sarabjit",
  "Tarsem", "Inderjit", "Jagtar", "Kuldeep", "Mandeep", "Satnam", "Gurdev", "Malkit", "Nirmal", "Charanjit",
];
// ASSUMPTION: field sizes in acres (no per-field data; swept in the simulator later).
const FIELD_SIZES_ACRES = [1.5, 2, 2.5, 3, 3, 3.5, 4, 4, 5, 6];
// ASSUMPTION: days a farmer will wait after harvest before burning (the simulator sweeps 3 to 10).
const WAITING_LIMIT_MIN_DAYS = 3;
const WAITING_LIMIT_MAX_DAYS = 10;
// ASSUMPTION: by the demo day, the farmers who have booked are those whose fields became ready
// from 2 days ago up to 7 days ahead. Ready days are drawn from the curves inside this window.
const BOOKING_WINDOW_DAYS_BEFORE = 2;
const BOOKING_WINDOW_DAYS_AFTER = 7;

/** mulberry32: a tiny deterministic PRNG so the demo season is identical on every reset. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Village points for the whole box (OpenStreetMap), shared with the planner. */
export function loadVillages(config: Config): VillageRecord[] {
  const file = path.join(config.DATA_DIR, "villages.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { villages: VillageRecord[] };
  return parsed.villages.map(({ id, name, namePa, lat, lon }) => ({ id, name, namePa: namePa ?? null, lat, lon }));
}

export function loadHarvestCurves(config: Config): HarvestCurves {
  const file = path.join(config.DATA_DIR, "harvest_curves.json");
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HarvestCurves;
  } catch {
    throw new Error("data/harvest_curves.json is missing: run `npm run data:prepare` in backend/ (needs the FIRMS CSVs in data/raw)");
  }
}

/** Seeds the demo centre around `todayIso` (the season clock), so the season always looks in progress. */
export async function seedDemo(store: VaariStore, config: Config, todayIso: string): Promise<void> {
  const random = seededRandom(SEED);
  const pick = <Item>(items: Item[]): Item => items[Math.floor(random() * items.length)]!;
  const villages = loadVillages(config);
  const curves = loadHarvestCurves(config);
  const curveByVillage = new Map(curves.villages.map((curve) => [curve.villageId, curve.readyDays]));

  const baseVillage = villages.find((village) => village.name === "Balian");
  if (!baseVillage) throw new Error("Balian missing from data/villages.json");
  const clusterVillages = villages
    .filter((village) => haversineKm(baseVillage.lat, baseVillage.lon, village.lat, village.lon) <= CLUSTER_RADIUS_KM)
    .sort((left, right) => left.name.localeCompare(right.name));

  await store.putChc({
    id: DEMO_CHC_ID,
    name: "Balian Cooperative Society",
    baseVillageId: baseVillage.id,
    base: { lat: baseVillage.lat, lon: baseVillage.lon },
    villageIds: clusterVillages.map((village) => village.id),
    operatorPhone: "+91 00000 00000",
    settings: { fairnessKDays: 2 },
    rainDays: [],
  });

  const machines: MachineRecord[] = [
    { chcId: DEMO_CHC_ID, id: "m1", name: "Super Seeder 1", kind: "super_seeder", hoursPerDay: 8, downDays: [] },
    { chcId: DEMO_CHC_ID, id: "m2", name: "Super Seeder 2", kind: "super_seeder", hoursPerDay: 8, downDays: [] },
    { chcId: DEMO_CHC_ID, id: "m3", name: "Super Seeder 3", kind: "super_seeder", hoursPerDay: 8, downDays: [] },
    { chcId: DEMO_CHC_ID, id: "m4", name: "Happy Seeder", kind: "happy_seeder", hoursPerDay: 8, downDays: [] },
  ];
  for (const machine of machines) await store.putMachine(machine);

  const today = dateToDay(config.SEASON_START_DATE, todayIso);
  // Curves count days from 1 October of the season; convert to the demo season's day index.
  const curveDayZero = dateToDay(config.SEASON_START_DATE, `${config.SEASON_START_DATE.slice(0, 4)}-10-01`);
  const windowFrom = today - BOOKING_WINDOW_DAYS_BEFORE - curveDayZero;
  const windowTo = today + BOOKING_WINDOW_DAYS_AFTER - curveDayZero;
  const drawReadyDay = (villageId: string): number => {
    // The village's own curve first (it may itself be blended or district); the district curve if
    // the village has no ready days inside the booking window.
    // Outside the fire season's days (a clock moved far from it) no curve has ready days in the
    // window: spread the fields evenly over it instead, so a demo season can start on any date.
    const day =
      sampleReadyDay(curveByVillage.get(villageId) ?? [], random, windowFrom, windowTo) ??
      sampleReadyDay(curves.district.readyDays, random, windowFrom, windowTo) ??
      windowFrom + Math.floor(random() * (windowTo - windowFrom + 1));
    return day + curveDayZero;
  };
  const now = new Date().toISOString();
  const jaswinderOrder = 17;
  for (let order = 0; order < FIELD_COUNT; order += 1) {
    const isJaswinder = order === jaswinderOrder;
    const farmerId = isJaswinder ? JASWINDER_FARMER_ID : `farmer-sim-${order}`;
    const farmerName = isJaswinder ? "Jaswinder Singh" : `${pick(FIRST_NAMES)} ${random() < 0.2 ? "Kaur" : "Singh"}`;
    const villageId = isJaswinder ? baseVillage.id : pick(clusterVillages).id;
    const field: FieldRecord = {
      chcId: DEMO_CHC_ID,
      id: isJaswinder ? "f-jaswinder" : `f-sim-${String(order).padStart(2, "0")}`,
      token: order + 1,
      farmerId,
      farmerName,
      villageId,
      acres: isJaswinder ? 6 : pick(FIELD_SIZES_ACRES),
      readyDay: drawReadyDay(villageId),
      waitingLimitDays: isJaswinder ? 5 : WAITING_LIMIT_MIN_DAYS + Math.floor(random() * (WAITING_LIMIT_MAX_DAYS - WAITING_LIMIT_MIN_DAYS + 1)),
      requestOrder: order,
      createdAt: now,
      state: "waiting",
      plannedDay: null,
      plannedMachineId: null,
      // Seeded farmers were booked by nobody. Only the demo farmer has a phone (and simulated consent).
      bookedBy: null,
      farmerPhone: isJaswinder ? DEMO_FARMER_PHONE : null,
      consentAt: isJaswinder ? now : null,
      consentBy: isJaswinder ? DEMO_USERS.facilitator : null,
      linkVersion: 1,
      soonerRequestedAt: null,
    };
    await store.putField(field);
    await store.putFarmer({ id: farmerId, name: farmerName, phone: isJaswinder ? DEMO_FARMER_PHONE : "", language: "pa", facilitatorId: null });
  }

  const users: UserRecord[] = [
    { userId: DEMO_USERS.facilitator, name: "Gurpreet Kaur", role: "facilitator", chcId: DEMO_CHC_ID, language: "en" },
    { userId: DEMO_USERS.operator, name: DEMO_OPERATOR_NAME, role: "operator", chcId: DEMO_CHC_ID, language: "en" },
    { userId: DEMO_USERS.officer, name: "District officer (demo)", role: "officer", chcId: null, language: "en" },
  ];
  for (const user of users) await store.putUser(user);
}
