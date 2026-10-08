/**
 * Records and the storage interface. Two implementations sit behind `VaariStore`: DynamoDB (one
 * table per entity, see docs/DECISIONS.md) and an in-memory store for tests and quick local runs,
 * chosen by REPO=dynamo|memory. Every method takes the keys its table needs (usually chcId), so
 * each read is a GetItem or a single-partition Query, never a table scan on a hot path.
 */
import type { FieldPromise, Locale, Pin, Role, SolveResponse } from "../shared";

export type ChcRecord = {
  id: string;
  name: string;
  baseVillageId: string;
  base: { lat: number; lon: number };
  villageIds: string[];
  operatorPhone: string;
  settings: { fairnessKDays: number };
  rainDays: number[];
};

export type MachineRecord = {
  chcId: string;
  id: string;
  name: string;
  kind: "super_seeder" | "happy_seeder";
  hoursPerDay: number;
  downDays: number[];
};

/** One machine's work on one field on one day. Machine speed is learned from these. */
export type WorkLogRecord = {
  chcId: string;
  date: string; // ISO calendar day
  machineId: string;
  fieldId: string;
  acres: number;
  hours: number;
  loggedAt: string;
};

export type FieldRecord = {
  chcId: string;
  id: string;
  token: number;
  farmerId: string;
  farmerName: string;
  villageId: string;
  acres: number;
  readyDay: number;
  waitingLimitDays: number;
  requestOrder: number;
  createdAt: string;
  state: "waiting" | "promised" | "done";
  plannedDay: number | null;
  plannedMachineId: string | null;
  // The facilitator (user id) who booked this field for a farmer, if any.
  bookedBy: string | null;
  // Set when the farmer says "I cannot wait longer": the next published plan may give them an
  // earlier promise (never a later one). Cleared when a plan covering the field is published.
  soonerRequestedAt: string | null;
};

export type PromiseReason = "first_promise" | "narrowed" | "breakdown" | "rain" | "manual_move" | "replan" | "kept";

export type PromiseRecord = {
  chcId: string;
  fieldId: string;
  version: number;
  promise: FieldPromise | null;
  state: "held" | "kept" | "broken" | "replaced";
  at: string;
  reason: PromiseReason;
};

/**
 * Why a draft plan was made. generate: the operator asked for tomorrow's plan; manual_move: the
 * operator moved a field; farmer_update: a farmer shortened their waiting limit from a slot link.
 */
export type PlanCause = "generate" | "breakdown" | "machine_back" | "rain" | "manual_move" | "farmer_update";

/** What publishing a plan does to promises (computed by domain/promises.ts `planChanges`). */
export type PlanChanges = {
  /** Requested fields that get their first promise. */
  promised: { fieldId: string; promise: FieldPromise }[];
  /** Windows that become a firm date (the day is within two days). */
  firmed: { fieldId: string; day: number }[];
  /** Fields that keep their promise but move to another day inside it. */
  moved: { fieldId: string; fromDay: number | null; toDay: number | null }[];
  /** Promises that cannot hold; the farmer gets the new date at once. */
  broken: { fieldId: string; previous: FieldPromise; next: FieldPromise | null }[];
  /** Farmers who asked for sooner and get an earlier (never later) promise. */
  rePromised: { fieldId: string; previous: FieldPromise; next: FieldPromise }[];
  /** Requested fields this plan could not place inside the horizon. */
  unplaced: string[];
};

/**
 * Plans are drafts until the operator approves one. Approving moves the plan to "publishing" with
 * the exact list of writes saved on it, the writes are applied (each safe to repeat), and only
 * then is it "approved". A plan left in "publishing" by a crash is finished by the next request.
 */
export type PlanStatus = "draft" | "publishing" | "approved";

/** A field's place in a published plan: the only field attributes publishing changes. */
export type FieldPlanUpdate = {
  fieldId: string;
  plannedDay: number | null;
  plannedMachineId: string | null;
  state: "waiting" | "promised";
};

/**
 * Every write a publish makes, fully decided before the first one (versions and timestamps
 * included), so applying the list twice writes the same records and never a duplicate.
 */
export type PublishWrites = {
  promises: PromiseRecord[];
  fields: FieldPlanUpdate[];
};

export type PlanRecord = {
  chcId: string;
  planDay: number;
  planDate: string; // ISO date of planDay; part of the plans table sort key
  version: number;
  status: PlanStatus;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  solve: SolveResponse;
  cause: PlanCause;
  causeMachineId: string | null;
  // The operator's manual moves in this draft (hard constraints for the engine).
  pins: Pin[];
  // What approving this plan does: computed when the draft was made, recomputed at approval.
  changes: PlanChanges;
  // Set when approval starts: the writes that publish this plan (null for drafts).
  publish: PublishWrites | null;
  executionArn: string | null;
};

/** After-visit satellite check: was fire seen near the field after the machine sowed it? */
export type FireCheckRecord = {
  fieldId: string;
  checkDate: string; // ISO
  chcId: string;
  result: "no_fire_seen" | "fire_seen" | "no_data";
  detections: number;
  source: string;
};

export type FarmerRecord = { id: string; name: string; phone: string; language: Locale; facilitatorId: string | null };

export type UserRecord = {
  userId: string;
  name: string;
  role: Role;
  chcId: string | null;
  farmerId: string | null;
  language: Locale;
};

/** Thrown when a conditional write loses: e.g. approving a plan that is no longer a draft. */
export class StoreConflictError extends Error {}

export interface VaariStore {
  listChcs(): Promise<ChcRecord[]>;
  getChc(chcId: string): Promise<ChcRecord | null>;
  putChc(chc: ChcRecord): Promise<void>;

  listMachines(chcId: string): Promise<MachineRecord[]>;
  putMachine(machine: MachineRecord): Promise<void>;

  listFields(chcId: string): Promise<FieldRecord[]>;
  getField(chcId: string, fieldId: string): Promise<FieldRecord | null>;
  putField(field: FieldRecord): Promise<void>;
  /**
   * Publishing's field write: sets the planned day, machine and state and clears a "sooner"
   * request. Safe to repeat. Skips a field that no longer exists or has been sown since.
   */
  setFieldPlan(chcId: string, update: FieldPlanUpdate): Promise<void>;
  listFieldsByFarmer(chcId: string, farmerId: string): Promise<FieldRecord[]>;
  /** Fields a facilitator booked, oldest first (booked-by-index). */
  listFieldsBookedBy(userId: string): Promise<FieldRecord[]>;

  /** Every promise record in a CHC, ordered by field then version. */
  listPromises(chcId: string): Promise<PromiseRecord[]>;
  /** One field's promise history, oldest version first. */
  promiseHistory(chcId: string, fieldId: string): Promise<PromiseRecord[]>;
  putPromise(record: PromiseRecord): Promise<void>;

  /** The newest plan, draft or approved. */
  latestPlan(chcId: string): Promise<PlanRecord | null>;
  /** The newest approved (published) plan: what farmers' promises and the machines follow. */
  latestApprovedPlan(chcId: string): Promise<PlanRecord | null>;
  /** Creates a plan version; fails with StoreConflictError if that version already exists. */
  createPlan(plan: PlanRecord): Promise<void>;
  /**
   * Step 1 of approval: draft -> publishing for exactly this version (conditional write), saving
   * who approved, the final changes and the writes. A second call for the same version throws
   * StoreConflictError, so only one approval ever starts.
   */
  beginPublish(
    chcId: string,
    planDate: string,
    version: number,
    approval: { approvedBy: string; approvedAt: string; changes: PlanChanges; publish: PublishWrites },
  ): Promise<PlanRecord>;
  /**
   * Last step: publishing -> approved. Safe to repeat: if the plan is already approved it is
   * returned as it is. Throws StoreConflictError if the plan is a draft or missing.
   */
  completePublish(chcId: string, planDate: string, version: number): Promise<PlanRecord>;

  listWorkLogs(chcId: string): Promise<WorkLogRecord[]>;
  putWorkLog(log: WorkLogRecord): Promise<void>;

  listFireChecks(fieldId: string): Promise<FireCheckRecord[]>;
  putFireCheck(check: FireCheckRecord): Promise<void>;

  getFarmer(farmerId: string): Promise<FarmerRecord | null>;
  putFarmer(farmer: FarmerRecord): Promise<void>;

  getUser(userId: string): Promise<UserRecord | null>;
  putUser(user: UserRecord): Promise<void>;
  /** Users attached to a CHC, ordered by role (chc-index). */
  listUsersByChc(chcId: string): Promise<UserRecord[]>;

  /** Demo reset: deletes a CHC's machines, fields, promises, plans and work logs. Users and farmers stay. */
  clearChcData(chcId: string): Promise<void>;
}

export type VillageRecord = { id: string; name: string; namePa: string | null; lat: number; lon: number };
