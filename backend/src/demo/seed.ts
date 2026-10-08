/**
 * The demo season. Everything here is SIMULATED and labelled so in the UI: the CHC, the machines,
 * the farmers (invented names) and their fields. Village names and locations are real
 * (OpenStreetMap, data/derived/villages_sangrur.json). Harvest timing will be calibrated from NASA
 * FIRMS fire history in the simulator stage; until then ready days are spread around the demo day.
 * A fixed seed makes every reset produce the same season. Seeding writes only the demo CHC's data
 * and the four demo persona users (ids start with "demo-"); real users' profiles are never touched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { dateToDay } from "../shared";
import type { Config } from "../config";
import type { FieldRecord, MachineRecord, UserRecord, VaariStore, VillageRecord } from "../store/types";

export const DEMO_CHC_ID = "chc-balian";
export const DEMO_USERS = {
  farmer: "demo-farmer-jaswinder",
  facilitator: "demo-facilitator-gurpreet",
  operator: "demo-operator-harpal",
  officer: "demo-officer-sangrur",
} as const;
const JASWINDER_FARMER_ID = "farmer-jaswinder";
const CLUSTER_RADIUS_KM = 6;
const FIELD_COUNT = 34;
const SEED = 20261008;

// Invented names for simulated farmers. Not real people.
const FIRST_NAMES = [
  "Gurpreet", "Baldev", "Sukhwinder", "Kulwant", "Manjit", "Paramjit", "Rajinder", "Harbhajan", "Jagdeep",
  "Amarjit", "Balwinder", "Gurmeet", "Hardeep", "Karamjit", "Lakhwinder", "Navdeep", "Ranjit", "Sarabjit",
  "Tarsem", "Inderjit", "Jagtar", "Kuldeep", "Mandeep", "Satnam", "Gurdev", "Malkit", "Nirmal", "Charanjit",
];
const FIELD_SIZES_ACRES = [1.5, 2, 2.5, 3, 3, 3.5, 4, 4, 5, 6];

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

function distanceKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(latB - latA);
  const deltaLon = toRadians(lonB - lonA);
  const chord = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(chord));
}

export function loadVillages(config: Config): VillageRecord[] {
  const file = path.join(config.DATA_DIR, "derived/villages_sangrur.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { villages: VillageRecord[] };
  return parsed.villages.map(({ id, name, namePa, lat, lon }) => ({ id, name, namePa: namePa ?? null, lat, lon }));
}

export async function seedDemo(store: VaariStore, config: Config): Promise<void> {
  const random = seededRandom(SEED);
  const pick = <Item>(items: Item[]): Item => items[Math.floor(random() * items.length)]!;
  const villages = loadVillages(config);

  const baseVillage = villages.find((village) => village.name === "Balian");
  if (!baseVillage) throw new Error("Balian missing from data/derived/villages_sangrur.json");
  const clusterVillages = villages
    .filter((village) => distanceKm(baseVillage.lat, baseVillage.lon, village.lat, village.lon) <= CLUSTER_RADIUS_KM)
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

  const today = dateToDay(config.SEASON_START_DATE, config.DEMO_TODAY);
  const now = new Date().toISOString();
  const jaswinderOrder = 17;
  for (let order = 0; order < FIELD_COUNT; order += 1) {
    const isJaswinder = order === jaswinderOrder;
    const farmerId = isJaswinder ? JASWINDER_FARMER_ID : `farmer-sim-${order}`;
    const farmerName = isJaswinder ? "Jaswinder Singh" : `${pick(FIRST_NAMES)} ${random() < 0.2 ? "Kaur" : "Singh"}`;
    const field: FieldRecord = {
      chcId: DEMO_CHC_ID,
      id: isJaswinder ? "f-jaswinder" : `f-sim-${String(order).padStart(2, "0")}`,
      token: order + 1,
      farmerId,
      farmerName,
      villageId: isJaswinder ? baseVillage.id : pick(clusterVillages).id,
      acres: isJaswinder ? 6 : pick(FIELD_SIZES_ACRES),
      readyDay: isJaswinder ? today + 1 : today - 2 + Math.floor(random() * 8),
      waitingLimitDays: isJaswinder ? 5 : 3 + Math.floor(random() * 8),
      requestOrder: order,
      createdAt: now,
      state: "waiting",
      plannedDay: null,
      plannedMachineId: null,
      bookedBy: null,
    };
    await store.putField(field);
    await store.putFarmer({ id: farmerId, name: farmerName, phone: "simulated", language: "pa", facilitatorId: null });
  }

  const users: UserRecord[] = [
    { userId: DEMO_USERS.farmer, name: "Jaswinder Singh", role: "farmer", chcId: DEMO_CHC_ID, farmerId: JASWINDER_FARMER_ID, language: "en" },
    { userId: DEMO_USERS.facilitator, name: "Gurpreet Kaur", role: "facilitator", chcId: DEMO_CHC_ID, farmerId: null, language: "en" },
    { userId: DEMO_USERS.operator, name: "Harpal Singh", role: "operator", chcId: DEMO_CHC_ID, farmerId: null, language: "en" },
    { userId: DEMO_USERS.officer, name: "District officer (demo)", role: "officer", chcId: null, farmerId: null, language: "en" },
  ];
  for (const user of users) await store.putUser(user);
}
