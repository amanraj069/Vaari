/**
 * Records and the storage interface. The shapes follow the single-table DynamoDB design in
 * CLAUDE.md section 8 (everything keyed by CHC), so the in-memory store used for local development
 * and tests and the DynamoDB store are interchangeable behind `VaariStore`.
 */
import type { FieldPromise, Role, Locale, SolveResponse } from "../shared";

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

export type WorkLogRecord = { day: number; acres: number; hours: number };

export type MachineRecord = {
  chcId: string;
  id: string;
  name: string;
  kind: "super_seeder" | "happy_seeder";
  hoursPerDay: number;
  downDays: number[];
  logs: WorkLogRecord[];
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

export type PlanRecord = {
  chcId: string;
  planDay: number;
  version: number;
  status: "proposed" | "approved";
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  solve: SolveResponse;
  // Windows that become firm dates when the operator approves this plan.
  firmingFieldIds: string[];
  executionArn: string | null;
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

export type NotificationRecord = {
  id: string;
  farmerId: string;
  fieldId: string;
  kind: "broken" | "firmed" | "moved_earlier";
  at: string;
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

export type VillageRecord = { id: string; name: string; namePa: string | null; lat: number; lon: number };

export interface VaariStore {
  listVillages(): Promise<VillageRecord[]>;
  putVillages(villages: VillageRecord[]): Promise<void>;
  listChcs(): Promise<ChcRecord[]>;
  getChc(chcId: string): Promise<ChcRecord | null>;
  putChc(chc: ChcRecord): Promise<void>;
  listMachines(chcId: string): Promise<MachineRecord[]>;
  putMachine(machine: MachineRecord): Promise<void>;
  listFields(chcId: string): Promise<FieldRecord[]>;
  getField(fieldId: string): Promise<FieldRecord | null>;
  putField(field: FieldRecord): Promise<void>;
  listFieldsByFarmer(farmerId: string): Promise<FieldRecord[]>;
  promiseHistory(fieldId: string): Promise<PromiseRecord[]>;
  putPromise(record: PromiseRecord): Promise<void>;
  latestPlan(chcId: string): Promise<PlanRecord | null>;
  putPlan(plan: PlanRecord): Promise<void>;
  lastReplan(chcId: string): Promise<ReplanRecord | null>;
  putReplan(record: ReplanRecord): Promise<void>;
  listNotifications(farmerId: string): Promise<NotificationRecord[]>;
  putNotification(record: NotificationRecord): Promise<void>;
  getFarmer(farmerId: string): Promise<FarmerRecord | null>;
  putFarmer(farmer: FarmerRecord): Promise<void>;
  getUser(userId: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  putUser(user: UserRecord): Promise<void>;
}
