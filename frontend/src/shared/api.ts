// GENERATED from backend/src/shared by `npm run contract:sync` in backend/. Do not edit here.
/**
 * What the API sends to the web app. Why it exists: pages validate responses with these schemas,
 * so the UI never renders a shape it did not expect. Dates are ISO strings; the web formats them.
 */
import { z } from "zod";
import { reasonCodeSchema } from "./engine";

export const roleSchema = z.enum(["farmer", "facilitator", "operator", "officer"]);
export type Role = z.infer<typeof roleSchema>;

export const localeSchema = z.enum(["en", "pa", "hi"]);
export type Locale = z.infer<typeof localeSchema>;

export const meSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: roleSchema,
  chcId: z.string().nullable(),
  farmerId: z.string().nullable(),
  language: localeSchema,
  demo: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

export const promiseViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("firm"), date: z.string() }),
  z.object({ kind: z.literal("window"), startDate: z.string(), endDate: z.string() }),
]);
export type PromiseView = z.infer<typeof promiseViewSchema>;

export const promiseHistoryItemSchema = z.object({
  version: z.number().int(),
  promise: promiseViewSchema.nullable(),
  state: z.enum(["held", "kept", "broken", "replaced"]),
  at: z.string(),
  reason: z.enum(["first_promise", "narrowed", "breakdown", "rain", "manual_move", "replan", "kept"]),
});
export type PromiseHistoryItem = z.infer<typeof promiseHistoryItemSchema>;

export const fieldStateSchema = z.enum(["waiting", "promised", "done"]);

export const farmerFieldSchema = z.object({
  id: z.string(),
  token: z.number().int(),
  farmerName: z.string(),
  villageId: z.string(),
  villageName: z.string(),
  acres: z.number(),
  readyDate: z.string(),
  waitingLimitDays: z.number().int(),
  burnDeadlineDate: z.string(),
  state: fieldStateSchema,
  promise: promiseViewSchema.nullable(),
  plannedDate: z.string().nullable(),
  fieldsAhead: z.number().int().nullable(),
  history: z.array(promiseHistoryItemSchema),
  notice: z
    .object({ kind: z.enum(["broken", "firmed", "moved_earlier"]), at: z.string() })
    .nullable(),
});
export type FarmerField = z.infer<typeof farmerFieldSchema>;

export const farmerHomeSchema = z.object({
  today: z.string(),
  farmerName: z.string(),
  chcName: z.string(),
  operatorPhone: z.string(),
  fields: z.array(farmerFieldSchema),
});
export type FarmerHome = z.infer<typeof farmerHomeSchema>;

export const villageOptionSchema = z.object({ id: z.string(), name: z.string(), namePa: z.string().nullable() });
export type VillageOption = z.infer<typeof villageOptionSchema>;

export const fieldRequestInputSchema = z.object({
  villageId: z.string().min(1),
  acres: z.number().positive().max(50),
  readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  waitingLimitDays: z.number().int().min(1).max(15),
});
export type FieldRequestInput = z.infer<typeof fieldRequestInputSchema>;

export const riskSchema = z.enum(["safe", "tight", "at_risk", "unplanned"]);
export type Risk = z.infer<typeof riskSchema>;

export const queueItemSchema = z.object({
  fieldId: z.string(),
  token: z.number().int(),
  farmerName: z.string(),
  villageName: z.string(),
  acres: z.number(),
  readyDate: z.string(),
  burnDeadlineDate: z.string(),
  plannedDate: z.string().nullable(),
  promise: promiseViewSchema.nullable(),
  slackDays: z.number().int().nullable(),
  risk: riskSchema,
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const laneStopSchema = z.object({
  fieldId: z.string(),
  token: z.number().int(),
  farmerName: z.string(),
  villageName: z.string(),
  acres: z.number(),
  part: z.number().int(),
  parts: z.number().int(),
  start: z.string(),
  end: z.string(),
  travelMinutesBefore: z.number().int(),
  stretch: z.boolean(),
  promise: promiseViewSchema.nullable(),
});
export type LaneStop = z.infer<typeof laneStopSchema>;

export const machineViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["super_seeder", "happy_seeder"]),
  status: z.enum(["working", "down"]),
  downDates: z.array(z.string()),
  promiseAcresPerDay: z.number(),
  planAcresPerDay: z.number(),
  logsCount: z.number().int(),
});
export type MachineView = z.infer<typeof machineViewSchema>;

export const laneSchema = z.object({
  machine: machineViewSchema,
  down: z.boolean(),
  stops: z.array(laneStopSchema),
  endTime: z.string().nullable(),
  capacityEndTime: z.string(),
  travelKm: z.number(),
});
export type Lane = z.infer<typeof laneSchema>;

export const replanSummarySchema = z.object({
  at: z.string(),
  cause: z.enum(["breakdown", "machine_back", "rain", "manual_move", "new_request"]),
  machineName: z.string().nullable(),
  moved: z.array(
    z.object({
      fieldId: z.string(),
      token: z.number().int(),
      farmerName: z.string(),
      fromDate: z.string().nullable(),
      toDate: z.string().nullable(),
    }),
  ),
  broken: z.array(
    z.object({
      fieldId: z.string(),
      token: z.number().int(),
      farmerName: z.string(),
      previous: promiseViewSchema.nullable(),
      next: promiseViewSchema.nullable(),
    }),
  ),
});
export type ReplanSummary = z.infer<typeof replanSummarySchema>;

export const operatorBoardSchema = z.object({
  chc: z.object({ id: z.string(), name: z.string() }),
  today: z.string(),
  planDate: z.string(),
  plan: z.object({
    status: z.enum(["proposed", "approved"]),
    version: z.number().int(),
    approvedAt: z.string().nullable(),
    approvedBy: z.string().nullable(),
    firmingCount: z.number().int(),
  }),
  counts: z.object({
    machinesWorking: z.number().int(),
    machinesTotal: z.number().int(),
    promisesOpen: z.number().int(),
    promisesOnTrack: z.number().int(),
    burnRisk: z.number().int(),
    unplanned: z.number().int(),
    brokenThisSeason: z.number().int(),
  }),
  lanes: z.array(laneSchema),
  atRisk: z.array(queueItemSchema),
  lastReplan: replanSummarySchema.nullable(),
  solver: z.object({
    status: z.enum(["optimal", "feasible", "fallback"]),
    mode: z.enum(["normal", "minimal_break"]),
    wallSeconds: z.number(),
    maxDelayVsQueueDays: z.number().int(),
    fieldsBeyondFairnessK: z.number().int(),
  }),
});
export type OperatorBoard = z.infer<typeof operatorBoardSchema>;

export const whySchema = z.object({
  fieldId: z.string(),
  plannedDate: z.string().nullable(),
  earlierPossible: z.boolean(),
  reasons: z.array(
    z.object({
      code: reasonCodeSchema,
      dates: z.array(z.string()),
      machineNames: z.array(z.string()),
      count: z.number().int().nullable(),
      text: z.string(),
    }),
  ),
  source: z.enum(["template", "model"]),
});
export type Why = z.infer<typeof whySchema>;

export const publicSummarySchema = z.object({
  today: z.string(),
  seasonStartDate: z.string(),
  optimumLastDate: z.string(),
  chcCount: z.number().int(),
  machineCount: z.number().int(),
  fieldCount: z.number().int(),
  villageCount: z.number().int(),
});
export type PublicSummary = z.infer<typeof publicSummarySchema>;
