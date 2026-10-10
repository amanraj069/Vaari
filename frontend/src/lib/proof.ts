/**
 * Pure helpers for the /proof page. Every number the page shows comes from the simulator's
 * results file; these only derive pictures from it (a field's state on a day, map positions,
 * which policy did best on a measure) and format values.
 */
import type { PolicyKey, ProofMetricKey, ProofResults, Replay, Spread } from "@/shared";

export const POLICY_ORDER: PolicyKey[] = ["phone_queue", "nearest", "vaari"];
export const POLICY_COLOUR: Record<PolicyKey, string> = {
  phone_queue: "var(--color-policy-queue)",
  nearest: "var(--color-policy-nearest)",
  vaari: "var(--color-policy-vaari)",
};

/**
 * How one farmer's season ended under a policy: sown by the last day of the wheat sowing optimum,
 * sown after it, or burned (the farmer waited too long). "unresolved" only if the file has neither
 * a sowing nor a burning day for the field, which the simulator never writes.
 */
export type Outcome = "onTime" | "late" | "burned" | "unresolved";
type ReplayField = Replay["fields"][number];

export function outcomeOf(field: ReplayField, policy: PolicyKey, optimumLastDay: number): Outcome {
  const sown = field.sownDay[policy];
  if (sown !== null) return sown <= optimumLastDay ? "onTime" : "late";
  return field.burnedDay[policy] !== null ? "burned" : "unresolved";
}

export function countOutcomes(replay: Replay, policy: PolicyKey): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { onTime: 0, late: 0, burned: 0, unresolved: 0 };
  for (const field of replay.fields) counts[outcomeOf(field, policy, replay.optimumLastDay)] += 1;
  return counts;
}

export function dayToIso(seasonStartDate: string, day: number): string {
  return new Date(Date.parse(`${seasonStartDate}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
}

type Ring = [number, number][];

/**
 * The replay map: the real district outline (OpenStreetMap) fitted into a width x height box, with
 * longitude scaled by cos(latitude) so distances look right. Every farmer's field sits in a small
 * sunflower spiral around its real village; machine centres at their villages. Also a small inset:
 * the whole state, with the district filled, so a visitor sees where it is. Paths are SVG strings.
 */
export function districtLayout(replay: Replay, width: number, height: number, padding: number, spacing: number, inset: { x: number; y: number; size: number }) {
  const districtRings = replay.boundaries.districts.flatMap((district) => district.rings as Ring[]);
  const points = districtRings.flat();
  const meanLat = points.reduce((sum, [, lat]) => sum + lat, 0) / Math.max(points.length, 1);
  const squeeze = Math.cos((meanLat * Math.PI) / 180);
  const fit = (rings: Ring[], box: { x: number; y: number; width: number; height: number }) => {
    const all = rings.flat();
    const xs = all.map(([lon]) => lon * squeeze);
    const ys = all.map(([, lat]) => lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(box.width / Math.max(maxX - minX, 1e-9), box.height / Math.max(maxY - minY, 1e-9));
    const offsetX = box.x + (box.width - (maxX - minX) * scale) / 2;
    const offsetY = box.y + (box.height - (maxY - minY) * scale) / 2;
    return (lon: number, lat: number) => ({ x: offsetX + (lon * squeeze - minX) * scale, y: offsetY + (maxY - lat) * scale });
  };
  const project = fit(districtRings, { x: padding, y: padding, width: width - 2 * padding, height: height - 2 * padding });
  const path = (rings: Ring[], to: (lon: number, lat: number) => { x: number; y: number }) =>
    rings.map((ring) => `M${ring.map(([lon, lat]) => { const point = to(lon, lat); return `${point.x.toFixed(1)},${point.y.toFixed(1)}`; }).join("L")}Z`).join("");

  const stateRings = replay.boundaries.state.rings as Ring[];
  const toInset = fit(stateRings, { x: inset.x, y: inset.y, width: inset.size, height: inset.size });

  // A district's label sits at the mean of its outline's points.
  const districts = replay.boundaries.districts.map((district) => {
    const ring = (district.rings as Ring[]).flat();
    const centre = project(ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length, ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length);
    return { name: district.name, path: path(district.rings as Ring[], project), label: centre };
  });

  const villageById = new Map(replay.villages.map((village) => [village.id, village]));
  const indexInVillage = new Map<string, number>();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const fields = replay.fields.map((field) => {
    const village = villageById.get(field.villageId)!;
    const centre = project(village.lon, village.lat);
    const index = indexInVillage.get(field.villageId) ?? 0;
    indexInVillage.set(field.villageId, index + 1);
    const radius = spacing * Math.sqrt(index + 0.5);
    return { field, x: centre.x + radius * Math.cos(index * golden), y: centre.y + radius * Math.sin(index * golden) };
  });

  return {
    districts,
    statePath: path(stateRings, project),
    centres: replay.centres.map((centre) => ({ ...centre, ...project(centre.lon, centre.lat) })),
    fields,
    inset: { statePath: path(stateRings, toInset), districtPath: path(districtRings, toInset) },
  };
}

/**
 * The policy with the best median on a measure, or null when there is no single best (a tie, or
 * the measure applies to one policy only). Never for the worst delay compared with the phone
 * queue: the queue is 0 there by definition, so "best" among the others would read as "fairest".
 */
export function bestPolicy(results: ProofResults, metric: ProofMetricKey, cells: Record<PolicyKey, Spread | null>): PolicyKey | null {
  if (metric === "worstDelayVsQueueDays") return null;
  const better = results.metrics.find((item) => item.key === metric)?.better ?? "lower";
  const candidates = POLICY_ORDER.filter((policy) => cells[policy] !== null);
  if (candidates.length < 2) return null;
  const sorted = [...candidates].sort((left, right) => (cells[left]!.median - cells[right]!.median) * (better === "lower" ? 1 : -1));
  return cells[sorted[0]!]!.median === cells[sorted[1]!]!.median ? null : sorted[0]!;
}

export type Rank = "best" | "second" | "worst";

/**
 * Each policy's place on a measure, by its median: best, second or worst (ties share a place).
 * Promises: making none (no date for the farmer) is worst. None at all when the measure has no
 * fair ranking: all three are equal, or it is the worst delay against the phone queue (0 by
 * definition there).
 */
export function rankPolicies(results: ProofResults, metric: ProofMetricKey, cells: Record<PolicyKey, Spread | null>): Record<PolicyKey, Rank | null> {
  const none: Record<PolicyKey, Rank | null> = { phone_queue: null, nearest: null, vaari: null };
  if (metric === "worstDelayVsQueueDays") return none;
  // Promises: a policy that makes none gives the farmer no date at all, the worst outcome; one that
  // makes them is best (there is nothing to rank it against).
  if (metric === "promisesKeptPct") {
    const makes = POLICY_ORDER.filter((policy) => cells[policy] !== null);
    if (makes.length === 0 || makes.length === POLICY_ORDER.length) return none;
    return Object.fromEntries(POLICY_ORDER.map((policy) => [policy, cells[policy] === null ? "worst" : "best"])) as Record<PolicyKey, Rank>;
  }
  if (POLICY_ORDER.some((policy) => cells[policy] === null)) return none;
  const lowerIsBetter = (results.metrics.find((item) => item.key === metric)?.better ?? "lower") === "lower";
  const values = [...new Set(POLICY_ORDER.map((policy) => cells[policy]!.median))].sort((left, right) => (lowerIsBetter ? left - right : right - left));
  if (values.length < 2) return none;
  const place = (value: number): Rank => (value === values[0] ? "best" : value === values.at(-1) ? "worst" : "second");
  return { phone_queue: place(cells.phone_queue!.median), nearest: place(cells.nearest!.median), vaari: place(cells.vaari!.median) };
}

const DECIMALS: Record<string, number> = { fields: 1, percent: 1, acres: 1, tonnes: 1, kg: 0, km: 0, rupees: 0, days: 1 };

/** Numbers in Indian grouping (2,56,508), with as many decimals as the unit needs and no more. */
export function formatNumber(value: number, unit: string): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: DECIMALS[unit] ?? 1 }).format(value);
}

/**
 * How much less (positive) or more (negative) a policy's total is than the phone queue's, in percent
 * of the queue's, summed over every season; null when the queue's total is 0 (no baseline).
 */
export function reductionVsQueue(totals: Record<PolicyKey, number>, policy: PolicyKey): number | null {
  const queue = totals.phone_queue;
  if (queue <= 0) return null;
  return Math.round((100 * (queue - totals[policy])) / queue);
}

/** A sweep value as the page shows it: shares (0-1) as percentages, everything else as written. */
export function sweepValueLabel(parameter: string, value: number): string {
  return parameter.endsWith("Chance") ? `${Math.round(value * 100)}%` : String(value);
}

// Short names for the sources the results file cites, in the order they are tested (a citation that
// names several works, such as "IPCC ... as used by Bhadauriya ...", takes the first match).
const SOURCE_SHORT: [RegExp, string][] = [
  [/NASA FIRMS/, "NASA FIRMS"],
  [/OpenStreetMap/, "OpenStreetMap"],
  [/CEEW operator interviews/, "CEEW interviews · district office"],
  [/CEEW, Custom Hiring Centres/, "CEEW CHC study, 2025"],
  [/CEEW CHC publication and annexure/, "CEEW CHC study and annexure"],
  [/CEEW CHC publication/, "CEEW CHC study, 2025"],
  [/CEEW, Why paddy stubble burning/, "CEEW farmer study, 2024"],
  [/PAU Package of Practices/, "PAU Package of Practices"],
  [/Pollution Control Board/, "Punjab PCB to the NGT, 2023"],
  [/IPCC 2006/, "IPCC 2006 guidelines"],
  [/Gadde et al\./, "Gadde et al., 2009"],
  [/Shyamsundar et al\./, "Shyamsundar et al., 2019"],
];

/**
 * A citation as short names a reader recognises at a glance ("CEEW CHC study, 2025"), one per work
 * (parts separated by ";"). Unknown citations fall back to their first phrase and year. The full
 * citation stays available to the page (tooltip, screen readers).
 */
export function shortSource(source: string): string[] {
  // A ";" can also sit inside one citation's own wording, so only a part naming a known work counts
  // as a further source; anything else belongs to the first.
  const parts = source.split(";").map((part) => part.trim()).filter(Boolean);
  const known = (part: string) => SOURCE_SHORT.find(([pattern]) => pattern.test(part))?.[1];
  const first = parts[0] ?? source;
  const year = first.match(/\b(19|20)\d{2}\b/)?.[0];
  const head = first.split(/[,:(]/)[0]!.trim();
  const names = [known(first) ?? (year && !head.includes(year) ? `${head}, ${year}` : head)];
  for (const part of parts.slice(1)) {
    const name = known(part);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
