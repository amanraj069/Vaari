// GENERATED from backend/src/shared by `npm run contract:sync` in backend/. Do not edit here.
/**
 * The simulator's results file (data/sim/results.json, written by `npm run simulate`), as the API
 * serves it and the /proof page reads it. Why it exists: the page shows only numbers from this
 * file, so the file's shape is checked here; a file that does not match is refused, never patched.
 */
import { z } from "zod";

export const policyKeySchema = z.enum(["phone_queue", "nearest", "vaari"]);
export type PolicyKey = z.infer<typeof policyKeySchema>;

export const proofMetricKeySchema = z.enum([
  "fieldsLate",
  "fieldsLatePct",
  "medianWaitDays",
  "daysWithoutDate",
  "acresBurned",
  "strawBurnedTonnes",
  "pm25Kg",
  "acresAfterOptimum",
  "wheatLostKg",
  "promisesKeptPct",
  "kmDriven",
  "acresPerMachine",
  "incomePerMachineRupees",
  "worstDelayVsQueueDays",
]);
export type ProofMetricKey = z.infer<typeof proofMetricKeySchema>;

/** Median and 10th-90th percentile over all runs; null where a measure does not apply (promises for the baselines). */
export const spreadSchema = z.object({ median: z.number(), p10: z.number(), p90: z.number() });
export type Spread = z.infer<typeof spreadSchema>;

const byPolicySchema = z.object({ phone_queue: spreadSchema.nullable(), nearest: spreadSchema.nullable(), vaari: spreadSchema.nullable() });
export type ByPolicy = z.infer<typeof byPolicySchema>;

/**
 * One policy against the phone queue on the SAME seasons: the share of seasons it did better, the
 * same, or worse, and the spread of the difference (policy minus phone queue, in the measure's unit).
 */
export const pairedCellSchema = z.object({
  betterPct: z.number(),
  samePct: z.number(),
  worsePct: z.number(),
  differenceMedian: z.number(),
  differenceP10: z.number(),
  differenceP90: z.number(),
});
export type PairedCell = z.infer<typeof pairedCellSchema>;

export const pairedMetricKeySchema = z.enum(["fieldsLate", "medianWaitDays", "pm25Kg", "wheatLostKg", "kmDriven", "incomePerMachineRupees"]);
export type PairedMetricKey = z.infer<typeof pairedMetricKeySchema>;
export const totalMetricKeySchema = z.enum(["fieldsLate", "acresBurned", "strawBurnedTonnes", "pm25Kg"]);
export type TotalMetricKey = z.infer<typeof totalMetricKeySchema>;

const scenarioSchema = z.object({
  about: z.string(),
  // The district: its machine centres, the villages they serve, all their machines, and the farmers who booked.
  centres: z.number().int(),
  villages: z.number().int(),
  machines: z.number().int(),
  fieldsPerSeason: z.number().int(),
  results: z.record(proofMetricKeySchema, byPolicySchema),
  pairedWithQueue: z.record(pairedMetricKeySchema, z.object({ nearest: pairedCellSchema, vaari: pairedCellSchema })),
  // Summed over every season of the scenario.
  totals: z.record(totalMetricKeySchema, z.object({ phone_queue: z.number(), nearest: z.number(), vaari: z.number() })),
});

/** One input of the season generator, labelled as the assumptions file labels it. */
export const assumptionInputSchema = z.looseObject({
  label: z.enum(["assumed", "real range"]),
  value: z.union([z.number(), z.string()]).optional(),
  values: z.array(z.number()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  rule: z.string().optional(),
  why: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  // A second source, for a range whose two ends come from different places.
  alsoSource: z.string().optional(),
  alsoSourceUrl: z.string().optional(),
});
export type AssumptionInput = z.infer<typeof assumptionInputSchema>;

const dayPromiseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("firm"), day: z.number().int() }),
  z.object({ kind: z.literal("window"), startDay: z.number().int(), endDay: z.number().int() }),
]);

export const replaySchema = z.object({
  scenario: z.string(),
  run: z.number().int(),
  why: z.string(),
  firstDay: z.number().int(),
  lastDay: z.number().int(),
  optimumLastDay: z.number().int(),
  machines: z.number().int(),
  // The district's machine centres (each at a real village) and their fleets.
  centres: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), machines: z.number().int() })),
  // Real outlines from OpenStreetMap: rings of [lon, lat].
  boundaries: z.object({
    state: z.object({ name: z.string(), rings: z.array(z.array(z.tuple([z.number(), z.number()]))) }).loose(),
    districts: z.array(z.object({ name: z.string(), rings: z.array(z.array(z.tuple([z.number(), z.number()]))) }).loose()),
  }),
  villages: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number() })),
  rainDays: z.array(z.number().int()),
  breakdowns: z.array(z.object({ machine: z.string(), startDay: z.number().int(), days: z.number().int() })),
  fields: z.array(
    z.object({
      id: z.string(),
      villageId: z.string(),
      acres: z.number(),
      requestDay: z.number().int(),
      readyDay: z.number().int(),
      burnDeadline: z.number().int(),
      // The day the CHC sowed the field; null: never (the farmer gave up waiting and burned).
      sownDay: z.object({ phone_queue: z.number().int().nullable(), nearest: z.number().int().nullable(), vaari: z.number().int().nullable() }),
      // The day the farmer gave up and burned; null: sown by the CHC. Without a promised date a
      // farmer may give up before burnDeadline (see the daysSoonerWithoutDate input).
      burnedDay: z.object({ phone_queue: z.number().int().nullable(), nearest: z.number().int().nullable(), vaari: z.number().int().nullable() }),
      firstPromise: dayPromiseSchema.nullable(),
    }),
  ),
});
export type Replay = z.infer<typeof replaySchema>;

export const scenarioKeySchema = z.enum(["base"]);
export type ScenarioKey = z.infer<typeof scenarioKeySchema>;

export const sweepParameterSchema = z.enum(["acresPerMachine", "waitingLimitDays", "daysSoonerWithoutDate", "phoneQueueLateReturnChance"]);
export type SweepParameter = z.infer<typeof sweepParameterSchema>;

/** The base seasons replayed with one input set to each value; `base` is that input's base value (null: drawn per farmer). */
const sweepSchema = z.object({
  parameter: sweepParameterSchema,
  about: z.string(),
  base: z.number().nullable(),
  // Sweeps replay one centre (the district's first), not the whole district.
  centre: z.string(),
  points: z.array(z.object({ value: z.number(), results: z.object({ fieldsLate: byPolicySchema, fieldsLatePct: byPolicySchema }) })),
});
export type Sweep = z.infer<typeof sweepSchema>;

export const proofResultsSchema = z.object({
  schemaVersion: z.literal(4),
  simulated: z.literal(true),
  generatedBy: z.string(),
  seed: z.number().int(),
  runs: z.number().int().positive(),
  sweepRuns: z.number().int().positive(),
  // Day 0 of the simulated season (days in this file count from it).
  seasonStartDate: z.string(),
  policies: z.array(policyKeySchema),
  metrics: z.array(z.object({ key: proofMetricKeySchema, unit: z.string(), better: z.enum(["lower", "higher"]) })),
  assumptions: z.looseObject({
    inputs: z.record(z.string(), assumptionInputSchema),
    constants: z.record(
      z.string(),
      z.looseObject({ value: z.union([z.number(), z.string()]), source: z.string(), unit: z.string().optional(), sourceUrl: z.string().optional() }),
    ),
  }),
  // capacityShortfall: half the machines, the same farmers (absent from files written before it existed).
  scenarios: z.object({ base: scenarioSchema, capacityShortfall: scenarioSchema.optional() }),
  sweeps: z.array(sweepSchema).min(1),
  replay: replaySchema,
});
export type ProofResults = z.infer<typeof proofResultsSchema>;
