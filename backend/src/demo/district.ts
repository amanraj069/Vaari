/**
 * The rest of the demo district: 24 more SIMULATED machine centres, so the agriculture officer's
 * page shows a district rather than the demo centre a second time.
 *
 * Why it exists and what it decides: the officer allocates machines across centres, which only
 * means something with many centres. Nothing here is invented for the page: every centre, machine,
 * breakdown and field comes from the season simulator's committed replay (data/sim/results.json,
 * `replay`: the median of its seeded seasons, 25 centres placed by a fixed rule, real village
 * positions and FIRMS-calibrated harvest timing). The district is the replay as it stands on the
 * site's today: fields booked by then, those Vaari had sown before today as done (with their first
 * promise kept or broken as the replay played it), the rest waiting. The replay's later sowing days
 * are outcomes, not plans, so they are never copied: each centre gets its plan from our own planner
 * (seedDistrictPlans). The replay's first centre (Ubhawal, the fire hotspot) is left out: the live
 * demo centre (Balian) serves that corner, and its villages are never given to another centre.
 * Seeded once (a DynamoDB deployment keeps it across restarts); a demo reset never touches it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dateToDay, type FieldPromise } from "../shared";
import type { Config } from "../config";
import { haversineKm } from "../data/geo";
import type { ChcRecord, FieldRecord, MachineRecord, PlanRecord, PromiseRecord, VaariStore } from "../store/types";
import type { Planner } from "../domain/planner";

export const DISTRICT_CHC_PREFIX = "chc-sim-";

const promiseSchema = z.union([
  z.object({ kind: z.literal("firm"), day: z.number().int() }),
  z.object({ kind: z.literal("window"), startDay: z.number().int(), endDay: z.number().int() }),
]);

const replaySchema = z.object({
  seasonStartDate: z.string(),
  replay: z.object({
    rainDays: z.array(z.number().int()),
    centres: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), machines: z.number().int() })),
    villages: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number() })),
    breakdowns: z.array(z.object({ machine: z.string(), startDay: z.number().int(), days: z.number().int() })),
    fields: z.array(
      z.object({
        id: z.string(),
        villageId: z.string(),
        acres: z.number(),
        requestDay: z.number().int(),
        readyDay: z.number().int(),
        burnDeadline: z.number().int(),
        sownDay: z.object({ vaari: z.number().int().nullable() }),
        burnedDay: z.object({ vaari: z.number().int().nullable() }),
        firstPromise: promiseSchema.nullable(),
      }),
    ),
  }),
});

type Replay = z.infer<typeof replaySchema>;

// Invented names for simulated farmers (the officer never sees them; the centres' own pages would).
const FIRST_NAMES = ["Gurpreet", "Baldev", "Sukhwinder", "Kulwant", "Manjit", "Paramjit", "Rajinder", "Harbhajan", "Jagdeep", "Amarjit", "Balwinder", "Gurmeet", "Hardeep", "Karamjit"];

function loadReplay(config: Config): Replay {
  const file = path.join(config.DATA_DIR, "sim", "results.json");
  return replaySchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

const lastPromiseDay = (promise: FieldPromise) => (promise.kind === "firm" ? promise.day : promise.endDay);

/** The district centres' ids (the replay's centre index, so the seed is the same on every run). */
export function districtChcId(index: number): string {
  return `${DISTRICT_CHC_PREFIX}${String(index).padStart(2, "0")}`;
}

/**
 * Writes the district centres as they stand on `todayIso`, skipping `reservedVillageIds` (the demo
 * centre's). Returns every district centre's id, in order. A centre already in the store is left
 * as it is; each centre's record is written after its machines and fields, so a seed cut short
 * rewrites only the centre it was in the middle of.
 */
export async function seedDistrict(store: VaariStore, config: Config, todayIso: string, reservedVillageIds: ReadonlySet<string>, options: { rewrite?: boolean } = {}): Promise<string[]> {
  const { seasonStartDate, replay } = loadReplay(config);
  // Replay days count from its own season start; ours from SEASON_START_DATE.
  const dayOffset = dateToDay(config.SEASON_START_DATE, seasonStartDate);
  const today = dateToDay(config.SEASON_START_DATE, todayIso);
  const now = new Date().toISOString();

  // Every village to its nearest centre: the simulator's own rule (sim/district.py).
  const villagesByCentre = new Map<number, string[]>();
  for (const village of replay.villages) {
    let nearest = 0;
    let nearestKm = Infinity;
    replay.centres.forEach((centre, index) => {
      const distance = haversineKm(village.lat, village.lon, centre.lat, centre.lon);
      if (distance < nearestKm) [nearest, nearestKm] = [index, distance];
    });
    villagesByCentre.set(nearest, [...(villagesByCentre.get(nearest) ?? []), village.id]);
  }

  const written: string[] = [];
  // Index 0 is the hotspot centre the live demo centre stands in for.
  for (let index = 1; index < replay.centres.length; index += 1) {
    const centre = replay.centres[index]!;
    const chcId = districtChcId(index);
    if (!options.rewrite && (await store.getChc(chcId))) {
      written.push(chcId);
      continue;
    }
    if (options.rewrite) await store.clearChcData(chcId);
    const villageIds = (villagesByCentre.get(index) ?? []).filter((villageId) => !reservedVillageIds.has(villageId));
    const served = new Set(villageIds);
    const prefix = `c${String(index).padStart(2, "0")}-`;

    for (let number = 1; number <= centre.machines; number += 1) {
      const replayMachine = `${prefix}m${number}`;
      const downDays = replay.breakdowns
        .filter((breakdown) => breakdown.machine === replayMachine)
        .flatMap((breakdown) => Array.from({ length: breakdown.days }, (_, offset) => breakdown.startDay + offset + dayOffset));
      const machine: MachineRecord = { chcId, id: `m${number}`, name: `Super Seeder ${number}`, kind: "super_seeder", hoursPerDay: 8, downDays };
      await store.putMachine(machine);
    }

    // Booked by today, in the order the farmers asked.
    const booked = replay.fields
      .filter((field) => field.id.startsWith(prefix) && served.has(field.villageId) && field.requestDay + dayOffset <= today)
      .sort((left, right) => left.requestDay - right.requestDay || left.id.localeCompare(right.id));
    let order = 0;
    for (const replayField of booked) {
      const sownDay = replayField.sownDay.vaari === null ? null : replayField.sownDay.vaari + dayOffset;
      const burnedDay = replayField.burnedDay.vaari === null ? null : replayField.burnedDay.vaari + dayOffset;
      // A farmer who burned before today is gone from the queue; the replay counts them, we do not.
      if (burnedDay !== null && burnedDay < today && (sownDay === null || sownDay >= today)) continue;
      const done = sownDay !== null && sownDay < today;
      const readyDay = replayField.readyDay + dayOffset;
      const field: FieldRecord = {
        chcId,
        id: `sim-${replayField.id}`,
        token: order + 1,
        farmerId: `farmer-sim-${replayField.id}`,
        farmerName: `${FIRST_NAMES[(index * 31 + order) % FIRST_NAMES.length]} Singh`,
        villageId: replayField.villageId,
        acres: replayField.acres,
        readyDay,
        waitingLimitDays: replayField.burnDeadline - replayField.readyDay,
        requestOrder: order,
        createdAt: now,
        state: done ? "done" : "waiting",
        plannedDay: done ? sownDay : null,
        plannedMachineId: null,
        bookedBy: null,
        farmerPhone: null,
        consentAt: null,
        consentBy: null,
        linkVersion: 1,
        soonerRequestedAt: null,
      };
      await store.putField(field);
      // A sown field's first promise, kept or broken as the replay played it. Waiting fields get
      // their promises from our planner, never from the replay.
      if (done && replayField.firstPromise) {
        const promise: FieldPromise =
          replayField.firstPromise.kind === "firm"
            ? { kind: "firm", day: replayField.firstPromise.day + dayOffset }
            : { kind: "window", startDay: replayField.firstPromise.startDay + dayOffset, endDay: replayField.firstPromise.endDay + dayOffset };
        const record: PromiseRecord = { chcId, fieldId: field.id, version: 1, promise, state: sownDay! <= lastPromiseDay(promise) ? "kept" : "broken", at: now, reason: "first_promise" };
        await store.putPromise(record);
      }
      order += 1;
    }

    const baseVillage = replay.villages.find((village) => village.id === centre.id);
    const chc: ChcRecord = {
      id: chcId,
      name: `${centre.name} CHC`,
      baseVillageId: centre.id,
      base: { lat: baseVillage?.lat ?? centre.lat, lon: baseVillage?.lon ?? centre.lon },
      villageIds,
      operatorPhone: "+91 00000 00000",
      settings: { fairnessKDays: 2 },
      rainDays: replay.rainDays.map((day) => day + dayOffset),
    };
    await store.putChc(chc);
    written.push(chcId);
  }
  return written;
}

/** The centre the server checks: once it has a published plan, the whole district is seeded and planned. */
export function lastDistrictChcId(config: Config): string {
  return districtChcId(loadReplay(config).replay.centres.length - 1);
}

/**
 * The simulated centres have no person to approve a re-plan, so their simulated operator approves
 * a draft that breaks no promise (as a careful operator would). A draft that breaks one waits, and
 * the officer sees "Re-plan waiting" for that centre. Real centres (the demo centre included)
 * always wait for their operator.
 */
export async function approveForSimulatedOperator(planner: Planner, plan: PlanRecord): Promise<void> {
  if (!plan.chcId.startsWith(DISTRICT_CHC_PREFIX) || plan.status !== "draft" || plan.changes.broken.length > 0) return;
  await planner.approvePlan(plan.chcId, plan.version, "Simulated operator");
}

/**
 * A new season day at the simulated centres: the farmers who asked on that day in the replay book
 * now (waiting; tonight's plan gives them dates). Never twice: a field already stored is skipped.
 * Returns how many fields were booked.
 */
export async function bookDistrictDay(store: VaariStore, config: Config, dayIso: string): Promise<number> {
  const { seasonStartDate, replay } = loadReplay(config);
  const dayOffset = dateToDay(config.SEASON_START_DATE, seasonStartDate);
  const day = dateToDay(config.SEASON_START_DATE, dayIso);
  const now = new Date().toISOString();
  let booked = 0;
  for (let index = 1; index < replay.centres.length; index += 1) {
    const chcId = districtChcId(index);
    const chc = await store.getChc(chcId);
    if (!chc) continue;
    const served = new Set(chc.villageIds);
    const prefix = `c${String(index).padStart(2, "0")}-`;
    const existing = await store.listFields(chcId);
    const known = new Set(existing.map((field) => field.id));
    let order = existing.reduce((highest, field) => Math.max(highest, field.requestOrder), -1) + 1;
    let token = existing.reduce((highest, field) => Math.max(highest, field.token), 0) + 1;
    const arriving = replay.fields
      .filter((field) => field.id.startsWith(prefix) && served.has(field.villageId) && field.requestDay + dayOffset === day && !known.has(`sim-${field.id}`))
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const replayField of arriving) {
      const field: FieldRecord = {
        chcId,
        id: `sim-${replayField.id}`,
        token,
        farmerId: `farmer-sim-${replayField.id}`,
        farmerName: `${FIRST_NAMES[(index * 31 + order) % FIRST_NAMES.length]} Singh`,
        villageId: replayField.villageId,
        acres: replayField.acres,
        readyDay: replayField.readyDay + dayOffset,
        waitingLimitDays: replayField.burnDeadline - replayField.readyDay,
        requestOrder: order,
        createdAt: now,
        state: "waiting",
        plannedDay: null,
        plannedMachineId: null,
        bookedBy: null,
        farmerPhone: null,
        consentAt: null,
        consentBy: null,
        linkVersion: 1,
        soonerRequestedAt: null,
      };
      await store.putField(field);
      order += 1;
      token += 1;
      booked += 1;
    }
  }
  return booked;
}

/** Every simulated centre's id that is in the store, in order. */
export async function districtCentreIds(store: VaariStore): Promise<string[]> {
  return (await store.listChcs()).map((chc) => chc.id).filter((id) => id.startsWith(DISTRICT_CHC_PREFIX));
}
