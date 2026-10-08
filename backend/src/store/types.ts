/**
 * Records and the storage interface. Two implementations sit behind `VaariStore`: DynamoDB (one
 * table per entity, see docs/DECISIONS.md) and an in-memory store for tests and quick local runs,
 * chosen by REPO=dynamo|memory. Every method takes the keys its table needs (usually chcId), so
 * each read is a GetItem or a single-partition Query, never a table scan on a hot path.
 */
import type { FieldPromise, Locale, Role, SolveResponse } from "../shared";

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

export type ReplanCause = "breakdown" | "machine_back" | "rain" | "manual_move" | "new_request";

export type ReplanRecord = {
  chcId: string;
  at: string;
  cause: ReplanCause;
  machineId: string | null;
  moved: { fieldId: string; fromDay: number | null; toDay: number | null }[];
  broken: { fieldId: string; previous: FieldPromise | null; next: FieldPromise | null }[];
};

export type PlanRecord = {
  chcId: string;
  planDay: number;
  planDate: string; // ISO date of planDay; part of the plans table sort key
  version: number;
  status: "proposed" | "approved";
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  solve: SolveResponse;
  // Windows that become firm dates when the operator approves this plan.
  firmingFieldIds: string[];
  executionArn: string | null;
  // The most recent breakdown/rain/manual re-plan, carried forward so the board can show it.
  lastReplan: ReplanRecord | null;
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

/** Thrown when a conditional write loses: e.g. approving a plan that is no longer proposed. */
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
  listFieldsByFarmer(chcId: string, farmerId: string): Promise<FieldRecord[]>;
  /** Fields a facilitator booked, oldest first (booked-by-index). */
  listFieldsBookedBy(userId: string): Promise<FieldRecord[]>;

  /** Every promise record in a CHC, ordered by field then version. */
  listPromises(chcId: string): Promise<PromiseRecord[]>;
  /** One field's promise history, oldest version first. */
  promiseHistory(chcId: string, fieldId: string): Promise<PromiseRecord[]>;
  putPromise(record: PromiseRecord): Promise<void>;

  latestPlan(chcId: string): Promise<PlanRecord | null>;
  /** Creates a plan version; fails with StoreConflictError if that version already exists. */
  createPlan(plan: PlanRecord): Promise<void>;
  /**
   * Approves exactly this plan version, only if it is still proposed (conditional write).
   * Approving the same version twice throws StoreConflictError.
   */
  approvePlan(chcId: string, planDate: string, version: number, approvedBy: string, approvedAt: string): Promise<PlanRecord>;

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
