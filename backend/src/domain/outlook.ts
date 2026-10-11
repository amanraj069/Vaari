/**
 * The district outlook: will each machine centre reach its fields before their last waiting day
 * over the plan's ten days, and where would one machine more (or less) change that?
 *
 * Why it exists: the agriculture officer's decision is where machines go (lend one between centres,
 * park a standby, add a machine). The engine plans one centre's machines field by field; this asks
 * the coarser district question cheaply, for every centre, many times per request. What it decides:
 * acres, not fields or dates for any farmer. Day by day, each centre's machines sow the ready acres
 * with the earliest last waiting day first (as the engine's first pass prefers), at the cautious
 * (promise) speed, before travel and setup; acres still unsown after their last waiting day are
 * late. Demand is the booked fields plus a FORECAST of acres not booked yet: the centre's season
 * acres (machines times the simulator's assumed acres per machine) spread over its villages' real
 * harvest curves (NASA FIRMS), each day's expected acres split evenly over the assumed waiting
 * limits. Every assumption is the simulator's own, read from data/sim/assumptions.json, and the
 * page labels the result a forecast.
 */
import { haversineKm } from "../data/geo";

export type OutlookLot = { readyDay: number; lastDay: number; acres: number };

export type OutlookAssumptions = {
  acresPerMachineSeason: number;
  waitingLimitMinDays: number;
  waitingLimitMaxDays: number;
  // Season window in curve days (day 0 = 1 October), as the simulator normalises the curves.
  windowFirstCurveDay: number;
  windowLastCurveDay: number;
};

/** A village's chance of a field becoming ready on each season day, inside the season window. */
export type ReadyShare = Map<number, number>;

/**
 * Plays the next days: `capacityByDay[index]` acres can be sown on `firstDay + index`. Returns the
 * acres left unsown after their last waiting day, and each day's sown and still-waiting acres.
 * Lots already past their last day still take capacity first (the planner sows them anyway) but
 * are not counted here: they are at burn risk now, counted from the fields themselves.
 */
export function playOutlook(lots: OutlookLot[], firstDay: number, capacityByDay: number[]): { lateAcres: number; days: { sownAcres: number; waitingAcres: number }[] } {
  const remaining = lots.map((lot) => ({ ...lot })).sort((left, right) => left.lastDay - right.lastDay || left.readyDay - right.readyDay);
  let lateAcres = 0;
  const days = capacityByDay.map((capacity, index) => {
    const day = firstDay + index;
    let left = capacity;
    let sownAcres = 0;
    for (const lot of remaining) {
      if (left <= 0) break;
      if (lot.readyDay > day || lot.acres <= 0) continue;
      const sown = Math.min(left, lot.acres);
      lot.acres -= sown;
      left -= sown;
      sownAcres += sown;
    }
    for (const lot of remaining) {
      if (lot.lastDay === day && lot.acres > 0) {
        lateAcres += lot.acres;
        lot.acres = 0;
      }
    }
    const waitingAcres = remaining.reduce((sum, lot) => sum + (lot.readyDay <= day ? lot.acres : 0), 0);
    return { sownAcres, waitingAcres };
  });
  return { lateAcres, days };
}

/**
 * The expected acres not booked yet, as lots: for each coming day, the centre's season acres times
 * its villages' mean ready share that day, less the acres already booked to be ready that day,
 * split evenly over the waiting limits (each its own last day).
 */
export function forecastLots(
  shares: ReadyShare[],
  seasonAcres: number,
  bookedAcresByReadyDay: ReadonlyMap<number, number>,
  days: number[],
  assumptions: Pick<OutlookAssumptions, "waitingLimitMinDays" | "waitingLimitMaxDays">,
): { lots: OutlookLot[]; expectedByDay: number[] } {
  const limits = Array.from({ length: assumptions.waitingLimitMaxDays - assumptions.waitingLimitMinDays + 1 }, (_, offset) => assumptions.waitingLimitMinDays + offset);
  const lots: OutlookLot[] = [];
  const expectedByDay = days.map((day) => {
    const share = shares.length === 0 ? 0 : shares.reduce((sum, villageShare) => sum + (villageShare.get(day) ?? 0), 0) / shares.length;
    const expected = Math.max(0, seasonAcres * share - (bookedAcresByReadyDay.get(day) ?? 0));
    if (expected > 0) for (const limit of limits) lots.push({ readyDay: day, lastDay: day + limit, acres: expected / limits.length });
    return expected;
  });
  return { lots, expectedByDay };
}

/** Normalises a village's curve (pairs of curve day and chance) inside the window, in season days. */
export function readyShare(curve: [number, number][], curveDayZero: number, assumptions: Pick<OutlookAssumptions, "windowFirstCurveDay" | "windowLastCurveDay">): ReadyShare {
  const inside = curve.filter(([curveDay]) => curveDay >= assumptions.windowFirstCurveDay && curveDay <= assumptions.windowLastCurveDay);
  const total = inside.reduce((sum, [, chance]) => sum + chance, 0);
  return new Map(total > 0 ? inside.map(([curveDay, chance]) => [curveDay + curveDayZero, chance / total]) : []);
}

export type CentreOutlookInput = {
  id: string;
  lat: number;
  lon: number;
  machinesTotal: number;
  lots: OutlookLot[];
  // Acres one working machine sows per day (cautious speed), and the machines working each day.
  acresPerMachineDay: number;
  workingByDay: number[];
};

export type CentreOutlook = { lateAcres: number; lateIfOneDownAcres: number | null; lateIfOneMoreAcres: number };

const capacityWith = (centre: CentreOutlookInput, extraMachines: number) => centre.workingByDay.map((working) => Math.max(0, working + extraMachines) * centre.acresPerMachineDay);

export function centreOutlook(centre: CentreOutlookInput, firstDay: number): CentreOutlook {
  const late = (extra: number) => playOutlook(centre.lots, firstDay, capacityWith(centre, extra)).lateAcres;
  return { lateAcres: late(0), lateIfOneDownAcres: centre.machinesTotal > 1 ? late(-1) : null, lateIfOneMoreAcres: late(1) };
}

// A lent machine drives there on a tractor: further than this it loses too much of its day.
export const MAX_LEND_KM = 30;
const MAX_MOVES = 6;
// Below this many acres the forecast cannot tell late from on time.
export const LATE_EPSILON_ACRES = 0.5;

export type MachineMove = { fromCentreId: string; toCentreId: string; distanceKm: number; lateBeforeAcres: number; lateAfterAcres: number };
export type ExtraMachines = { centreId: string; machines: number; lateAcres: number };

/**
 * Lending, then adding. Repeatedly: the centre with the most late acres borrows one machine from
 * the nearest centre (within MAX_LEND_KM) that would still have no late acres without it; the move
 * is kept only if it cuts the borrower's late acres. Whatever is still late afterwards is answered
 * with the fewest added machines that clear it (at most 5 tried per centre).
 */
export function suggestMoves(centres: CentreOutlookInput[], firstDay: number): { moves: MachineMove[]; extra: ExtraMachines[] } {
  const late = (centre: CentreOutlookInput, extra: number) => playOutlook(centre.lots, firstDay, capacityWith(centre, extra)).lateAcres;
  const change = new Map(centres.map((centre) => [centre.id, 0]));
  const lateNow = new Map(centres.map((centre) => [centre.id, late(centre, 0)]));
  const moves: MachineMove[] = [];
  const refused = new Set<string>();

  for (let round = 0; round < MAX_MOVES; round += 1) {
    const borrower = centres
      .filter((centre) => (lateNow.get(centre.id) ?? 0) > LATE_EPSILON_ACRES && !refused.has(centre.id))
      .sort((left, right) => lateNow.get(right.id)! - lateNow.get(left.id)! || left.id.localeCompare(right.id))[0];
    if (!borrower) break;
    const lender = centres
      .filter((centre) => centre.id !== borrower.id && change.get(centre.id)! <= 0 && centre.machinesTotal + change.get(centre.id)! > 1)
      .map((centre) => ({ centre, distanceKm: haversineKm(borrower.lat, borrower.lon, centre.lat, centre.lon) }))
      .filter(({ centre, distanceKm }) => distanceKm <= MAX_LEND_KM && late(centre, change.get(centre.id)! - 1) <= LATE_EPSILON_ACRES)
      .sort((left, right) => left.distanceKm - right.distanceKm || left.centre.id.localeCompare(right.centre.id))[0];
    if (!lender) {
      refused.add(borrower.id);
      continue;
    }
    const before = lateNow.get(borrower.id)!;
    const after = late(borrower, change.get(borrower.id)! + 1);
    if (after >= before - LATE_EPSILON_ACRES) {
      refused.add(borrower.id);
      continue;
    }
    change.set(borrower.id, change.get(borrower.id)! + 1);
    change.set(lender.centre.id, change.get(lender.centre.id)! - 1);
    lateNow.set(borrower.id, after);
    moves.push({ fromCentreId: lender.centre.id, toCentreId: borrower.id, distanceKm: Math.round(lender.distanceKm), lateBeforeAcres: roundAcres(before), lateAfterAcres: roundAcres(after) });
  }

  const extra: ExtraMachines[] = [];
  for (const centre of centres) {
    const stillLate = lateNow.get(centre.id)!;
    if (stillLate <= LATE_EPSILON_ACRES) continue;
    let machines = 1;
    while (machines < 5 && late(centre, change.get(centre.id)! + machines) > LATE_EPSILON_ACRES) machines += 1;
    extra.push({ centreId: centre.id, machines, lateAcres: roundAcres(stillLate) });
  }
  extra.sort((left, right) => right.lateAcres - left.lateAcres || left.centreId.localeCompare(right.centreId));
  return { moves, extra };
}

export const roundAcres = (acres: number) => Math.round(acres * 10) / 10;
