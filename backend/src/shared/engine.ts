/**
 * The engine contract in Zod, mirroring backend/engine/vaari_engine/contract.py field for field.
 * Why it exists: the API validates everything it sends to and receives from the Python engine,
 * so a contract drift fails loudly in tests (see the golden fixtures) instead of in the demo.
 */
import { z } from "zod";

export const villageSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
});

export const machineRateSchema = z.object({
  promiseAcresPerHour: z.number().positive(),
  planAcresPerHour: z.number().positive(),
});

export const engineMachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  hoursPerDay: z.number().positive().max(16),
  rate: machineRateSchema,
  downDays: z.array(z.number().int()).default([]),
});

export const firmPromiseSchema = z.object({ kind: z.literal("firm"), day: z.number().int() });
export const windowPromiseSchema = z.object({
  kind: z.literal("window"),
  startDay: z.number().int(),
  endDay: z.number().int(),
});
export const promiseSchema = z.discriminatedUnion("kind", [firmPromiseSchema, windowPromiseSchema]);

export const engineFieldSchema = z.object({
  id: z.string(),
  villageId: z.string(),
  acres: z.number().positive().max(100),
  readyDay: z.number().int(),
  waitingLimitDays: z.number().int().min(0).max(30),
  requestOrder: z.number().int(),
  promise: promiseSchema.nullable().optional(),
  previousDay: z.number().int().nullable().optional(),
});

export const pinSchema = z.object({
  fieldId: z.string(),
  machineId: z.string(),
  day: z.number().int(),
});

export const engineSettingsSchema = z.object({
  fairnessKDays: z.number().int().optional(),
  firmWithinDays: z.number().int().optional(),
  windowHalfWidthDays: z.number().int().optional(),
  roadFactor: z.number().optional(),
  roadSpeedKmh: z.number().optional(),
  setupMinutesPerField: z.number().int().optional(),
  dayStartMinute: z.number().int().optional(),
  timeLimitSeconds: z.number().optional(),
  wheatLossKgPerAcrePerWeek: z.number().optional(),
  // "cpsat" is the reference planner; "search" is the fast one (earliest burn deadline + local search).
  method: z.enum(["cpsat", "search"]).optional(),
  searchSeed: z.number().int().optional(),
});

/**
 * Road travel computed outside the engine (the Amazon Location route matrix, fetched by the API).
 * Row and column i belong to pointIds[i]; "base" is the CHC. Without it the engine uses straight-line
 * distance times the assumed road factor.
 */
export const travelMatrixSchema = z.object({
  source: z.string(),
  pointIds: z.array(z.string()),
  km: z.array(z.array(z.number().nonnegative())),
  minutes: z.array(z.array(z.number().int().nonnegative())),
});

export const solveRequestSchema = z.object({
  seasonStartDate: z.string(),
  today: z.number().int(),
  horizonDays: z.number().int().min(1).max(14).default(10),
  optimumLastDay: z.number().int().nullable().optional(),
  base: z.object({ lat: z.number(), lon: z.number() }),
  villages: z.array(villageSchema),
  machines: z.array(engineMachineSchema),
  fields: z.array(engineFieldSchema),
  rainDays: z.array(z.number().int()).default([]),
  pins: z.array(pinSchema).default([]),
  settings: engineSettingsSchema.default({}),
  travelMatrix: travelMatrixSchema.nullable().optional(),
});

export const explainRequestSchema = solveRequestSchema.extend({
  fieldId: z.string(),
  currentDay: z.number().int(),
});

export const stopSchema = z.object({
  fieldId: z.string(),
  villageId: z.string(),
  part: z.number().int(),
  parts: z.number().int(),
  acres: z.number(),
  arriveMinute: z.number().int(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  travelMinutesBefore: z.number().int(),
  stretch: z.boolean(),
});

export const routeSchema = z.object({
  machineId: z.string(),
  day: z.number().int(),
  stops: z.array(stopSchema),
  travelKm: z.number(),
  endMinute: z.number().int(),
  capacityMinute: z.number().int(),
});

export const assignmentSchema = z.object({
  fieldId: z.string(),
  machineId: z.string(),
  day: z.number().int(),
  part: z.number().int(),
  parts: z.number().int(),
});

export const promiseOutSchema = z.object({
  fieldId: z.string(),
  promise: promiseSchema.nullable(),
  previous: promiseSchema.nullable(),
  changed: z.boolean(),
  broken: z.boolean(),
});

export const metricsSchema = z.object({
  fieldsTotal: z.number().int(),
  fieldsPlanned: z.number().int(),
  fieldsUnserved: z.number().int(),
  fieldsPastBurnDeadline: z.number().int(),
  promisesHeld: z.number().int(),
  promisesBroken: z.number().int(),
  wheatLossKg: z.number(),
  travelKm: z.number(),
  maxDelayVsQueueDays: z.number().int(),
  fieldsBeyondFairnessK: z.number().int(),
});

/** The plan's lexicographic objective, most important first; the same measure for both planners. */
export const objectiveSchema = z.object({
  brokenPromises: z.number().int(),
  lateFields: z.number().int(),
  unservedFields: z.number().int(),
  wheatLossKg: z.number(),
  travelKm: z.number(),
  fairnessSlackDays: z.number().int(),
  waitingAcreDays: z.number(),
});

export const solveResponseSchema = z.object({
  planStartDay: z.number().int(),
  fieldDays: z.record(z.string(), z.number().int()),
  unservedFieldIds: z.array(z.string()),
  assignments: z.array(assignmentSchema),
  routes: z.array(routeSchema),
  promises: z.array(promiseOutSchema),
  queueDays: z.record(z.string(), z.number().int().nullable()),
  metrics: metricsSchema,
  // Optional: plans stored before the search planner existed do not carry these.
  objective: objectiveSchema.optional(),
  solver: z.object({
    status: z.enum(["optimal", "feasible", "fallback"]),
    mode: z.enum(["normal", "minimal_break"]),
    method: z.enum(["cpsat", "search"]).optional(),
    travelSource: z.string().optional(),
    // When promises break: true if CP-SAT proved that no plan could break fewer.
    breaksProvenMinimal: z.boolean().nullable().optional(),
    wallSeconds: z.number(),
    burnPassObjective: z.number().int().nullable(),
    costPassObjective: z.number().int().nullable(),
  }),
});

export const reasonCodeSchema = z.enum([
  "EARLIEST_PLAN_DAY",
  "FIELD_NOT_READY",
  "RAIN",
  "MACHINE_DOWN",
  "DAYS_FULL",
  "PROMISES_HELD",
  "EARLIER_DEADLINES_AHEAD",
  "ROUTE_GROUPING",
  "BEFORE_BURN_DEADLINE",
]);

export const reasonSchema = z.object({
  code: reasonCodeSchema,
  days: z.array(z.number().int()),
  machineIds: z.array(z.string()),
  count: z.number().int().nullable(),
});

export const explainResponseSchema = z.object({
  fieldId: z.string(),
  currentDay: z.number().int(),
  earlierPossible: z.boolean(),
  reasons: z.array(reasonSchema),
});

export type Village = z.infer<typeof villageSchema>;
export type EngineMachine = z.infer<typeof engineMachineSchema>;
export type FieldPromise = z.infer<typeof promiseSchema>;
export type EngineField = z.infer<typeof engineFieldSchema>;
export type Pin = z.infer<typeof pinSchema>;
export type TravelMatrix = z.infer<typeof travelMatrixSchema>;
export type Objective = z.infer<typeof objectiveSchema>;
export type SolveRequest = z.input<typeof solveRequestSchema>;
export type ExplainRequest = z.input<typeof explainRequestSchema>;
export type Stop = z.infer<typeof stopSchema>;
export type Route = z.infer<typeof routeSchema>;
export type SolveResponse = z.infer<typeof solveResponseSchema>;
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export type Reason = z.infer<typeof reasonSchema>;
export type ExplainResponse = z.infer<typeof explainResponseSchema>;
