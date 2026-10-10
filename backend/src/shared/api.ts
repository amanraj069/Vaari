/**
 * What the API sends to the web app. Why it exists: pages validate responses with these schemas,
 * so the UI never renders a shape it did not expect. Dates are ISO strings; the web formats them.
 */
import { z } from "zod";
import { reasonCodeSchema } from "./engine";

/**
 * Signed-in roles (Cognito group or the /welcome profile). Farmers are not a role: they have no
 * account; a farmer is identified by phone number and reaches their fields through a slot link or
 * a one-time login link sent on WhatsApp (backend/src/auth/farmer-session.ts).
 */
export const roleSchema = z.enum(["facilitator", "operator", "officer"]);
export type Role = z.infer<typeof roleSchema>;

/** The one-click demo personas. The farmer persona gets a phone session, not an account. */
export const demoPersonaSchema = z.enum(["farmer", "facilitator", "operator", "officer"]);
export type DemoPersona = z.infer<typeof demoPersonaSchema>;

export const localeSchema = z.enum(["en", "pa", "hi"]);
export type Locale = z.infer<typeof localeSchema>;

export const meSchema = z.object({
  userId: z.string(),
  name: z.string(),
  // null until a new Google user picks a role on /welcome.
  role: roleSchema.nullable(),
  chcId: z.string().nullable(),
  // The machine centre's name, for the dashboard's sidebar (null for officers and new users).
  chcName: z.string().nullable().default(null),
  language: localeSchema,
  demo: z.boolean(),
  needsOnboarding: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

// Roles a new user may ask for on /welcome; operator is granted only to the Cognito "operator" group (the API checks).
export const selfServiceRoleSchema = z.enum(["operator"]);

/**
 * A farmer's phone number in E.164 (+<country code><number>), or null if it is not one. Indian
 * mobile numbers may be typed the usual ways (98xxxxxxxx, 098xxxxxxxx, 9198xxxxxxxx, +91 98xxx xxxxx).
 */
export function toE164(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, "");
  let candidate = compact;
  if (/^0?[6-9]\d{9}$/.test(compact)) candidate = `+91${compact.slice(-10)}`;
  else if (/^91[6-9]\d{9}$/.test(compact)) candidate = `+${compact}`;
  else if (/^00[1-9]\d+$/.test(compact)) candidate = `+${compact.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) return null;
  // An Indian mobile number is +91 and ten digits starting 6-9.
  if (candidate.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(candidate)) return null;
  return candidate;
}

export const phoneSchema = z
  .string()
  .max(32)
  .transform((value, context) => {
    const e164 = toE164(value);
    if (!e164) {
      context.addIssue({ code: "custom", message: "not a valid phone number" });
      return z.NEVER;
    }
    return e164;
  });

export const onboardingInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: selfServiceRoleSchema,
  chcId: z.string().min(1),
  language: localeSchema,
});
export type OnboardingInput = z.infer<typeof onboardingInputSchema>;

export const chcOptionSchema = z.object({ id: z.string(), name: z.string(), villageCount: z.number().int(), machineCount: z.number().int() });
export type ChcOption = z.infer<typeof chcOptionSchema>;

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

/**
 * Where a farmer's turn stands: requested (no date yet) -> window -> firm (within two days) ->
 * kept | broken. A broken promise is replaced by a new one at once (backend/src/domain/promises.ts).
 */
export const promiseStatusSchema = z.enum(["requested", "window", "firm", "kept", "broken"]);
export type PromiseStatus = z.infer<typeof promiseStatusSchema>;

/** The one plain sentence under the date on a slot page (phrased by backend templates, en/pa/hi). */
export const slotReasonCodeSchema = z.enum(["requested", "unplaced", "window", "firm_route", "firm", "moved", "kept", "broken_no_date"]);
export type SlotReasonCode = z.infer<typeof slotReasonCodeSchema>;

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
  status: promiseStatusSchema,
  promise: promiseViewSchema.nullable(),
  plannedDate: z.string().nullable(),
  fieldsAhead: z.number().int().nullable(),
  // 1 = next in line. Null until a published plan places the field.
  queuePosition: z.number().int().nullable(),
  // For a firm date: which machine comes, and which stop of its day this field is.
  visit: z.object({ machineName: z.string(), stop: z.number().int(), stops: z.number().int() }).nullable(),
  reason: z.object({ code: slotReasonCodeSchema, text: z.string() }),
  // The farmer said "I cannot wait longer"; the operator's next plan decides the new date.
  soonerRequested: z.boolean(),
  history: z.array(promiseHistoryItemSchema),
  notice: z
    .object({ kind: z.enum(["broken", "firmed", "moved_earlier"]), at: z.string() })
    .nullable(),
});
export type FarmerField = z.infer<typeof farmerFieldSchema>;

/** One field on /farmer, with the machine centre that serves it (one phone may book with several). */
export const farmerHomeFieldSchema = farmerFieldSchema.extend({
  chcId: z.string(),
  chcName: z.string(),
  operatorPhone: z.string(),
});
export type FarmerHomeField = z.infer<typeof farmerHomeFieldSchema>;

/** /farmer behind a phone session: every field booked with that phone, newest first, read-only. */
export const farmerHomeSchema = z.object({
  today: z.string(),
  // False until the phone has an account or a booking: the page then asks for the name first.
  registered: z.boolean(),
  farmerName: z.string(),
  fields: z.array(farmerHomeFieldSchema),
});
export type FarmerHome = z.infer<typeof farmerHomeSchema>;

/** GET /farmer/me: who a phone session belongs to, for the dashboard frame (no phone number in it). */
export const farmerMeSchema = z.object({
  // Null until the farmer gives a name (a code sign-in with no account and no booking yet).
  name: z.string().nullable(),
  registered: z.boolean(),
});
export type FarmerMe = z.infer<typeof farmerMeSchema>;

export const villageOptionSchema = z.object({ id: z.string(), name: z.string(), namePa: z.string().nullable() });
export type VillageOption = z.infer<typeof villageOptionSchema>;

// --- Farmer sign-in with a one-time code ----------------------------------------------------

/** A one-time code: six digits. */
export const otpCodeSchema = z.string().regex(/^\d{6}$/, "six digits");

/**
 * Ask for a code: the phone alone, known or new. A new farmer gives their name and consent after
 * the code proves the phone (farmerAccountInputSchema), so nobody chooses "register" or "log in".
 */
export const farmerOtpRequestSchema = z.object({ phone: phoneSchema, language: localeSchema });
export type FarmerOtpRequest = z.input<typeof farmerOtpRequestSchema>;

export const farmerOtpSentSchema = z.object({
  channel: z.enum(["whatsapp", "demo"]),
  expiresInSeconds: z.number().int(),
  resendInSeconds: z.number().int(),
  // A demo farmer's phone only (channel "demo"): the code itself, shown on screen as a demo.
  demoCode: otpCodeSchema.nullable(),
});
export type FarmerOtpSent = z.infer<typeof farmerOtpSentSchema>;

export const farmerOtpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema });
export type FarmerOtpVerify = z.input<typeof farmerOtpVerifySchema>;

/**
 * A phone session, as the web stores it (httpOnly cookie); never shown to the browser. `registered`
 * is false for a phone Vaari has never seen: the web then asks for the name and consent.
 */
export const farmerSessionSchema = z.object({ sessionToken: z.string(), expiresIn: z.number().int(), registered: z.boolean() });

/** A new farmer, after their code: the name the operator sees and their own consent to messages. */
export const farmerAccountInputSchema = z.object({ name: z.string().trim().min(1).max(80), consent: z.boolean(), language: localeSchema });
export type FarmerAccountInput = z.infer<typeof farmerAccountInputSchema>;

/** Where a farmer can book themselves: every village a machine centre serves, with that centre. */
export const farmerVillageOptionSchema = villageOptionSchema.extend({ chcId: z.string(), chcName: z.string() });
export type FarmerVillageOption = z.infer<typeof farmerVillageOptionSchema>;

export const farmerBookingOptionsSchema = z.object({ today: z.string(), villages: z.array(farmerVillageOptionSchema) });
export type FarmerBookingOptions = z.infer<typeof farmerBookingOptionsSchema>;

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
  // Against this plan's day: at_risk = after the farmer's last waiting day, tight = within a day of it.
  risk: riskSchema,
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

export const planCauseSchema = z.enum(["generate", "breakdown", "machine_back", "rain", "manual_move", "farmer_update"]);
export type PlanCause = z.infer<typeof planCauseSchema>;

/**
 * A plan version: a draft until the operator approves it, which publishes it to farmers.
 * "publishing" lasts only while approval writes the promises (or until the next request finishes
 * a publish that a crash interrupted).
 */
export const planSummarySchema = z.object({
  version: z.number().int(),
  status: z.enum(["draft", "publishing", "approved"]),
  planDate: z.string(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  cause: planCauseSchema,
  causeMachineName: z.string().nullable(),
});
export type PlanSummary = z.infer<typeof planSummarySchema>;

const fieldRefSchema = z.object({ fieldId: z.string(), token: z.number().int(), farmerName: z.string(), villageName: z.string() });

/** A farmer said "I cannot wait longer" from their slot link: the operator should look at this field. */
export const attentionItemSchema = fieldRefSchema.extend({
  burnDeadlineDate: z.string(),
  requestedAt: z.string(),
  // The farmer's held promise, unchanged until the operator publishes a plan.
  promise: promiseViewSchema.nullable(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

/** What approving a draft does (or what approving it did), field by field. */
export const planChangesViewSchema = z.object({
  promised: z.array(fieldRefSchema.extend({ promise: promiseViewSchema })),
  firmed: z.array(fieldRefSchema.extend({ date: z.string() })),
  moved: z.array(fieldRefSchema.extend({ fromDate: z.string().nullable(), toDate: z.string().nullable() })),
  broken: z.array(fieldRefSchema.extend({ previous: promiseViewSchema, next: promiseViewSchema.nullable() })),
  rePromised: z.array(fieldRefSchema.extend({ previous: promiseViewSchema, next: promiseViewSchema })),
  unplaced: z.array(fieldRefSchema),
});
export type PlanChangesView = z.infer<typeof planChangesViewSchema>;

export const solverViewSchema = z.object({
  status: z.enum(["optimal", "feasible", "fallback"]),
  mode: z.enum(["normal", "minimal_break"]),
  wallSeconds: z.number(),
  maxDelayVsQueueDays: z.number().int(),
  fieldsBeyondFairnessK: z.number().int(),
  // When promises break: true if the planner proved no plan could break fewer.
  breaksProvenMinimal: z.boolean().nullable(),
});

/**
 * One day of a plan, for the calendar and the workload grid: how many fields and acres it sows,
 * how full each machine's day is (minutes used of the minutes it can work), rain and workshop days.
 */
export const planDaySchema = z.object({
  date: z.string(),
  rain: z.boolean(),
  fields: z.number().int(),
  acres: z.number(),
  // Fields sown this day on or after the farmer's last waiting day (burn risk).
  atRisk: z.number().int(),
  machines: z.array(
    z.object({
      machineId: z.string(),
      name: z.string(),
      down: z.boolean(),
      fields: z.number().int(),
      acres: z.number(),
      busyMinutes: z.number().int(),
      capacityMinutes: z.number().int(),
    }),
  ),
});
export type PlanDay = z.infer<typeof planDaySchema>;

/** /operator: the published plan the machines follow, plus anything waiting for a decision. */
export const operatorBoardSchema = z.object({
  chc: z.object({ id: z.string(), name: z.string() }),
  today: z.string(),
  planDate: z.string().nullable(),
  published: planSummarySchema.nullable(),
  // A draft newer than the published plan, waiting on /operator/plan.
  draft: planSummarySchema.extend({ changeCount: z.number().int(), brokenCount: z.number().int() }).nullable(),
  // Requested fields that no plan covers yet (booked after the latest plan was made).
  newRequests: z.number().int(),
  // Farmers who said "I cannot wait longer" and are waiting for the operator's next published plan.
  attention: z.array(attentionItemSchema),
  counts: z.object({
    machinesWorking: z.number().int(),
    machinesTotal: z.number().int(),
    promisesOpen: z.number().int(),
    promisesOnTrack: z.number().int(),
    burnRisk: z.number().int(),
    requested: z.number().int(),
    brokenThisSeason: z.number().int(),
  }),
  // Every open field by risk, for the risk chart.
  riskCounts: z.object({ safe: z.number().int(), tight: z.number().int(), at_risk: z.number().int(), unplanned: z.number().int() }),
  // The published plan's days (empty before the first plan) and the day the lanes show (?date=).
  days: z.array(planDaySchema),
  selectedDate: z.string(),
  lanes: z.array(laneSchema),
  atRisk: z.array(queueItemSchema),
  solver: solverViewSchema.nullable(),
});
export type OperatorBoard = z.infer<typeof operatorBoardSchema>;

/** /operator/plan: the newest plan (usually a draft), what approving it does, and how to change it. */
export const operatorPlanSchema = z.object({
  chc: z.object({ id: z.string(), name: z.string() }),
  today: z.string(),
  plan: planSummarySchema.nullable(),
  changes: planChangesViewSchema.nullable(),
  pins: z.array(z.object({ fieldId: z.string(), token: z.number().int(), farmerName: z.string(), machineName: z.string(), date: z.string() })),
  // The plan's days for the calendar, and the day the lanes show (?date=; the plan's first day by default).
  days: z.array(planDaySchema),
  selectedDate: z.string(),
  lanes: z.array(laneSchema),
  newRequests: z.number().int(),
  attention: z.array(attentionItemSchema),
  moveOptions: z.object({
    machines: z.array(z.object({ id: z.string(), name: z.string(), downDates: z.array(z.string()) })),
    dates: z.array(z.string()),
    rainDates: z.array(z.string()),
  }),
  solver: solverViewSchema.nullable(),
});
export type OperatorPlan = z.infer<typeof operatorPlanSchema>;

/** The operator moves a field to a machine and day; the engine re-plans everything else around it. */
export const moveInputSchema = z.object({
  fieldId: z.string().min(1),
  machineId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type MoveInput = z.infer<typeof moveInputSchema>;

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

/**
 * GET /officer/overview: the district as an agriculture officer sees it. Aggregates only: counts
 * per machine centre and per village, never a farmer's name, phone or field. Every number is
 * counted from stored records (simulated demo data), the same way the operator's board counts them.
 */
const officerCountsSchema = z.object({
  machinesWorking: z.number().int(),
  machinesTotal: z.number().int(),
  fieldsActive: z.number().int(),
  acresActive: z.number(),
  fieldsSown: z.number().int(),
  promisesOpen: z.number().int(),
  promisesOnTrack: z.number().int(),
  promisesKept: z.number().int(),
  promisesBroken: z.number().int(),
  burnRisk: z.number().int(),
  tight: z.number().int(),
  waitingForDate: z.number().int(),
});
export type OfficerCounts = z.infer<typeof officerCountsSchema>;

export const officerCentreSchema = officerCountsSchema.extend({
  id: z.string(),
  name: z.string(),
  villageCount: z.number().int(),
  lat: z.number(),
  lon: z.number(),
  // The published plan's first day; null before the first plan is approved.
  planDate: z.string().nullable(),
  // A newer plan is waiting for the operator's approval.
  draftWaiting: z.boolean(),
  // Worst delay of any field against first-come-first-served in the published plan.
  maxDelayVsQueueDays: z.number().int().nullable(),
});
export type OfficerCentre = z.infer<typeof officerCentreSchema>;

export const officerVillageSchema = z.object({
  id: z.string(),
  name: z.string(),
  centreId: z.string(),
  lat: z.number(),
  lon: z.number(),
  fieldsActive: z.number().int(),
  acresActive: z.number(),
  fieldsSown: z.number().int(),
  burnRisk: z.number().int(),
  tight: z.number().int(),
});
export type OfficerVillage = z.infer<typeof officerVillageSchema>;

export const officerOverviewSchema = z.object({
  today: z.string(),
  optimumLastDate: z.string(),
  totals: officerCountsSchema.extend({ centres: z.number().int(), villages: z.number().int() }),
  centres: z.array(officerCentreSchema),
  // Villages with at least one booked field, most fields at burn risk first.
  villages: z.array(officerVillageSchema),
  // Fields and acres each published plan puts on each of the next days, all centres together.
  sowingAhead: z.array(z.object({ date: z.string(), fields: z.number().int(), acres: z.number() })),
  // Real district outlines (OpenStreetMap, data/boundaries.json): rings of [lon, lat].
  districts: z.array(z.object({ name: z.string(), rings: z.array(z.array(z.tuple([z.number(), z.number()]))) })),
});
export type OfficerOverview = z.infer<typeof officerOverviewSchema>;

/**
 * POST /fields. A facilitator books for a farmer (who has no account): the farmer's name, their
 * phone number (stored as E.164; it identifies the farmer across seasons and is never shown on a
 * slot, officer or public page) and the farmer's consent to be contacted on it, which the
 * facilitator records. The answer carries the farmer's slot link.
 */
export const bookingInputSchema = fieldRequestInputSchema.extend({
  farmerName: z.string().trim().min(1).max(80),
  farmerPhone: phoneSchema,
  // Must be true: the API answers 400 CONSENT_REQUIRED otherwise.
  consent: z.boolean(),
});
/** What the web sends (the phone as typed). */
export type BookingInput = z.input<typeof bookingInputSchema>;
/** What the API works with (the phone in E.164). */
export type BookingRequest = z.output<typeof bookingInputSchema>;

export const slotLinkSchema = z.object({ token: z.string(), path: z.string() });
export type SlotLink = z.infer<typeof slotLinkSchema>;

export const bookingSchema = z.object({ field: farmerFieldSchema, slot: slotLinkSchema });
export type Booking = z.infer<typeof bookingSchema>;

/** "I cannot wait longer": a farmer shortens how long they can wait after harvest. */
export const waitingLimitInputSchema = z.object({ waitingLimitDays: z.number().int().min(1).max(30) });
