/**
 * Harvest-timing curves from satellite fire detections. Why it exists: a farmer burns stubble
 * a few days after the paddy is cut, so the dates fires were seen near a village tell us when its
 * fields became ready. Each detection goes to the nearest village within 2 km; each village gets a
 * daily histogram per season, shifted earlier by an assumed harvest-to-fire delay; villages with
 * few detections lean on the district curve. Pure functions: same inputs, same bytes out.
 */
import type { FireDetection } from "./firms";
import { haversineKm } from "./geo";

/** ASSUMPTION: days between a field becoming ready (harvested) and its stubble fire being seen. */
export const HARVEST_TO_FIRE_DAYS = 3;
/** A detection counts for a village only if the village point is within this distance. */
export const ASSIGNMENT_RADIUS_KM = 2;
/** Villages with fewer detections than this blend towards the district curve (weight = count / this). */
export const FULL_WEIGHT_DETECTIONS = 5;
/** Low-confidence VIIRS detections are left out (FIRMS flags them as likely false alarms). */
export const EXCLUDED_CONFIDENCE: FireDetection["confidence"][] = ["l"];
/** The study box (west, south, east, north), the same one used everywhere in Vaari. */
export const SANGRUR_BOX = { west: 75.2, south: 29.8, east: 76.2, north: 30.6 } as const;
/** Day 0 of every curve is 1 October of the season's year, matching the demo season's start. */
export const DAY_ZERO_MONTH_DAY = "10-01";

export type VillagePoint = { id: string; name: string; lat: number; lon: number };
export type CurveMethod = "village" | "blended" | "district";
/** [day offset from 1 October, probability] pairs with probability > 0, sorted by day. */
export type ReadyDayDistribution = [number, number][];

export type VillageCurve = {
  villageId: string;
  name: string;
  method: CurveMethod;
  detections: number;
  detectionsBySeason: Record<string, number>;
  readyDays: ReadyDayDistribution;
};

export type HarvestCurves = {
  schemaVersion: 1;
  assumptions: {
    harvestToFireDays: number;
    assignmentRadiusKm: number;
    fullWeightDetections: number;
    excludedConfidence: string[];
    dayZero: string;
    box: typeof SANGRUR_BOX;
  };
  seasons: string[];
  totals: { detections: number; excludedLowConfidence: number; outsideBox: number; assignedToVillages: number; unassigned: number };
  district: { detections: number; detectionsBySeason: Record<string, number>; readyDays: ReadyDayDistribution };
  villages: VillageCurve[];
};

const MILLISECONDS_PER_DAY = 86_400_000;
const PROBABILITY_DECIMALS = 6;

/** Season year of a detection (the paddy-to-wheat window spans Sept–Dec; Jan–Jun belongs to the previous one). */
export function seasonOf(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number) as [number, number];
  return String(month >= 7 ? year : year - 1);
}

/** Days from 1 October of the detection's season to the detection date. */
export function dayOffset(isoDate: string): number {
  const season = seasonOf(isoDate);
  const dayZero = Date.parse(`${season}-${DAY_ZERO_MONTH_DAY}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - dayZero) / MILLISECONDS_PER_DAY);
}

function inBox(detection: FireDetection): boolean {
  return (
    detection.lon >= SANGRUR_BOX.west && detection.lon <= SANGRUR_BOX.east && detection.lat >= SANGRUR_BOX.south && detection.lat <= SANGRUR_BOX.north
  );
}

/**
 * Nearest village within ASSIGNMENT_RADIUS_KM, or null. A cheap latitude/longitude window skips
 * far villages before the exact distance; ties go to the smaller id so the result is stable.
 */
export function nearestVillage(detection: FireDetection, villages: VillagePoint[]): VillagePoint | null {
  const latWindow = ASSIGNMENT_RADIUS_KM / 111;
  const lonWindow = ASSIGNMENT_RADIUS_KM / (111 * Math.cos((detection.lat * Math.PI) / 180));
  let best: VillagePoint | null = null;
  let bestDistance = Infinity;
  for (const village of villages) {
    if (Math.abs(village.lat - detection.lat) > latWindow || Math.abs(village.lon - detection.lon) > lonWindow) continue;
    const distance = haversineKm(detection.lat, detection.lon, village.lat, village.lon);
    if (distance > ASSIGNMENT_RADIUS_KM) continue;
    if (distance < bestDistance || (distance === bestDistance && best !== null && village.id < best.id)) {
      best = village;
      bestDistance = distance;
    }
  }
  return best;
}

/** Shift a histogram of fire days earlier by the harvest-to-fire delay and normalise it. */
function toReadyDistribution(fireDayCounts: Map<number, number>): Map<number, number> {
  const total = [...fireDayCounts.values()].reduce((sum, count) => sum + count, 0);
  const distribution = new Map<number, number>();
  if (total === 0) return distribution;
  for (const [fireDay, count] of fireDayCounts) distribution.set(fireDay - HARVEST_TO_FIRE_DAYS, count / total);
  return distribution;
}

function blend(villageCurve: Map<number, number>, districtCurve: Map<number, number>, villageWeight: number): Map<number, number> {
  const result = new Map<number, number>();
  for (const [day, probability] of districtCurve) result.set(day, (1 - villageWeight) * probability);
  for (const [day, probability] of villageCurve) result.set(day, (result.get(day) ?? 0) + villageWeight * probability);
  return result;
}

function serialise(distribution: Map<number, number>): ReadyDayDistribution {
  const scale = 10 ** PROBABILITY_DECIMALS;
  return [...distribution.entries()]
    .map(([day, probability]): [number, number] => [day, Math.round(probability * scale) / scale])
    .filter(([, probability]) => probability > 0)
    .sort((left, right) => left[0] - right[0]);
}

function addCount(counts: Map<number, number>, day: number) {
  counts.set(day, (counts.get(day) ?? 0) + 1);
}

export function buildHarvestCurves(detections: FireDetection[], villages: VillagePoint[]): HarvestCurves {
  const sortedVillages = [...villages].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const seasons = new Set<string>();
  // Histograms: village -> season -> fire day -> count, and the district (whole box) per season.
  const villageHistograms = new Map<string, Map<string, Map<number, number>>>();
  const districtBySeason = new Map<string, Map<number, number>>();
  const totals = { detections: detections.length, excludedLowConfidence: 0, outsideBox: 0, assignedToVillages: 0, unassigned: 0 };

  for (const detection of detections) {
    if (EXCLUDED_CONFIDENCE.includes(detection.confidence)) {
      totals.excludedLowConfidence += 1;
      continue;
    }
    if (!inBox(detection)) {
      totals.outsideBox += 1;
      continue;
    }
    const season = seasonOf(detection.date);
    const fireDay = dayOffset(detection.date);
    seasons.add(season);
    if (!districtBySeason.has(season)) districtBySeason.set(season, new Map());
    addCount(districtBySeason.get(season)!, fireDay);

    const village = nearestVillage(detection, sortedVillages);
    if (!village) {
      totals.unassigned += 1;
      continue;
    }
    totals.assignedToVillages += 1;
    const bySeason = villageHistograms.get(village.id) ?? new Map<string, Map<number, number>>();
    if (!bySeason.has(season)) bySeason.set(season, new Map());
    addCount(bySeason.get(season)!, fireDay);
    villageHistograms.set(village.id, bySeason);
  }

  // Seasons are pooled: every detection is one vote for its day, whichever season it came from.
  const pool = (bySeason: Map<string, Map<number, number>>) => {
    const pooled = new Map<number, number>();
    for (const counts of bySeason.values()) for (const [day, count] of counts) pooled.set(day, (pooled.get(day) ?? 0) + count);
    return pooled;
  };
  const countBySeason = (bySeason: Map<string, Map<number, number>>) =>
    Object.fromEntries(
      [...bySeason.entries()]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([season, counts]) => [season, [...counts.values()].reduce((sum, count) => sum + count, 0)]),
    );

  const districtPooled = pool(districtBySeason);
  const districtCurve = toReadyDistribution(districtPooled);
  const districtDetections = [...districtPooled.values()].reduce((sum, count) => sum + count, 0);

  const villageCurves: VillageCurve[] = sortedVillages.map((village) => {
    const bySeason = villageHistograms.get(village.id) ?? new Map<string, Map<number, number>>();
    const pooled = pool(bySeason);
    const detectionCount = [...pooled.values()].reduce((sum, count) => sum + count, 0);
    let method: CurveMethod;
    let curve: Map<number, number>;
    if (detectionCount >= FULL_WEIGHT_DETECTIONS) {
      method = "village";
      curve = toReadyDistribution(pooled);
    } else if (detectionCount > 0) {
      method = "blended";
      curve = blend(toReadyDistribution(pooled), districtCurve, detectionCount / FULL_WEIGHT_DETECTIONS);
    } else {
      method = "district";
      curve = districtCurve;
    }
    return {
      villageId: village.id,
      name: village.name,
      method,
      detections: detectionCount,
      detectionsBySeason: countBySeason(bySeason),
      readyDays: serialise(curve),
    };
  });

  return {
    schemaVersion: 1,
    assumptions: {
      harvestToFireDays: HARVEST_TO_FIRE_DAYS,
      assignmentRadiusKm: ASSIGNMENT_RADIUS_KM,
      fullWeightDetections: FULL_WEIGHT_DETECTIONS,
      excludedConfidence: EXCLUDED_CONFIDENCE,
      dayZero: `${DAY_ZERO_MONTH_DAY} of each season (day 0 = 1 October)`,
      box: SANGRUR_BOX,
    },
    seasons: [...seasons].sort(),
    totals,
    district: { detections: districtDetections, detectionsBySeason: countBySeason(districtBySeason), readyDays: serialise(districtCurve) },
    villages: villageCurves,
  };
}

/**
 * Draws a ready day (offset from 1 October) from a distribution, restricted to [fromDay, toDay].
 * Returns null when the distribution has no mass in that range.
 */
export function sampleReadyDay(distribution: ReadyDayDistribution, random: () => number, fromDay: number, toDay: number): number | null {
  const inRange = distribution.filter(([day]) => day >= fromDay && day <= toDay);
  const total = inRange.reduce((sum, [, probability]) => sum + probability, 0);
  if (total <= 0) return null;
  let threshold = random() * total;
  for (const [day, probability] of inRange) {
    threshold -= probability;
    if (threshold < 0) return day;
  }
  return inRange.at(-1)![0];
}
