/**
 * In-memory store (REPO=memory) for unit tests and quick local runs. It mirrors the DynamoDB
 * store's semantics, including ordering and the conditional writes, so tests written against one
 * hold for the other (test/store-contract.ts runs the same suite on both). Values are deep-copied
 * in and out so callers cannot mutate stored state by accident.
 */
import {
  StoreConflictError,
  type ChcRecord,
  type FarmerRecord,
  type FieldRecord,
  type FireCheckRecord,
  type MachineRecord,
  type PlanRecord,
  type PromiseRecord,
  type UserRecord,
  type VaariStore,
  type WorkLogRecord,
} from "./types";

const copy = <Value>(value: Value): Value => structuredClone(value);
const byString = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export class MemoryStore implements VaariStore {
  private chcs = new Map<string, ChcRecord>();
  private machines = new Map<string, MachineRecord>(); // chcId/machineId
  private fields = new Map<string, FieldRecord>(); // chcId/fieldId
  private promises = new Map<string, PromiseRecord>(); // chcId/fieldId/version
  private plans = new Map<string, PlanRecord>(); // chcId/planDate/version
  private workLogs = new Map<string, WorkLogRecord>();
  private fireChecks = new Map<string, FireCheckRecord>();
  private farmers = new Map<string, FarmerRecord>();
  private users = new Map<string, UserRecord>();

  async listChcs() {
    return copy([...this.chcs.values()].sort((left, right) => byString(left.id, right.id)));
  }
  async getChc(chcId: string) {
    return copy(this.chcs.get(chcId) ?? null);
  }
  async putChc(chc: ChcRecord) {
    this.chcs.set(chc.id, copy(chc));
  }

  async listMachines(chcId: string) {
    return copy([...this.machines.values()].filter((machine) => machine.chcId === chcId).sort((left, right) => byString(left.id, right.id)));
  }
  async putMachine(machine: MachineRecord) {
    this.machines.set(`${machine.chcId}/${machine.id}`, copy(machine));
  }

  async listFields(chcId: string) {
    return copy([...this.fields.values()].filter((field) => field.chcId === chcId).sort((left, right) => byString(left.id, right.id)));
  }
  async getField(chcId: string, fieldId: string) {
    return copy(this.fields.get(`${chcId}/${fieldId}`) ?? null);
  }
  async putField(field: FieldRecord) {
    this.fields.set(`${field.chcId}/${field.id}`, copy(field));
  }
  async listFieldsByFarmer(chcId: string, farmerId: string) {
    return (await this.listFields(chcId)).filter((field) => field.farmerId === farmerId);
  }
  async listFieldsBookedBy(userId: string) {
    return copy(
      [...this.fields.values()]
        .filter((field) => field.bookedBy === userId)
        .sort((left, right) => byString(left.createdAt, right.createdAt)),
    );
  }

  async listPromises(chcId: string) {
    return copy(
      [...this.promises.values()]
        .filter((record) => record.chcId === chcId)
        .sort((left, right) => byString(left.fieldId, right.fieldId) || left.version - right.version),
    );
  }
  async promiseHistory(chcId: string, fieldId: string) {
    return (await this.listPromises(chcId)).filter((record) => record.fieldId === fieldId);
  }
  async putPromise(record: PromiseRecord) {
    this.promises.set(`${record.chcId}/${record.fieldId}/${record.version}`, copy(record));
  }

  async latestPlan(chcId: string) {
    const plans = [...this.plans.values()]
      .filter((plan) => plan.chcId === chcId)
      .sort((left, right) => byString(left.planDate, right.planDate) || left.version - right.version);
    return copy(plans.at(-1) ?? null);
  }
  async createPlan(plan: PlanRecord) {
    const key = `${plan.chcId}/${plan.planDate}/${plan.version}`;
    if (this.plans.has(key)) throw new StoreConflictError(`plan ${plan.planDate} v${plan.version} already exists`);
    this.plans.set(key, copy(plan));
  }
  async approvePlan(chcId: string, planDate: string, version: number, approvedBy: string, approvedAt: string) {
    const key = `${chcId}/${planDate}/${version}`;
    const plan = this.plans.get(key);
    if (!plan || plan.status !== "proposed") throw new StoreConflictError("plan is not a proposed plan at that version");
    const approved: PlanRecord = { ...plan, status: "approved", approvedAt, approvedBy, firmingFieldIds: [] };
    this.plans.set(key, copy(approved));
    return copy(approved);
  }

  async listWorkLogs(chcId: string) {
    return copy([...this.workLogs.values()].filter((log) => log.chcId === chcId).sort((left, right) => byString(left.date, right.date)));
  }
  async putWorkLog(log: WorkLogRecord) {
    this.workLogs.set(`${log.chcId}/${log.date}#${log.machineId}#${log.fieldId}`, copy(log));
  }

  async listFireChecks(fieldId: string) {
    return copy([...this.fireChecks.values()].filter((check) => check.fieldId === fieldId).sort((left, right) => byString(left.checkDate, right.checkDate)));
  }
  async putFireCheck(check: FireCheckRecord) {
    this.fireChecks.set(`${check.fieldId}/${check.checkDate}`, copy(check));
  }

  async getFarmer(farmerId: string) {
    return copy(this.farmers.get(farmerId) ?? null);
  }
  async putFarmer(farmer: FarmerRecord) {
    this.farmers.set(farmer.id, copy(farmer));
  }

  async getUser(userId: string) {
    return copy(this.users.get(userId) ?? null);
  }
  async putUser(user: UserRecord) {
    this.users.set(user.userId, copy(user));
  }
  async listUsersByChc(chcId: string) {
    return copy([...this.users.values()].filter((user) => user.chcId === chcId).sort((left, right) => byString(left.role, right.role)));
  }

  async clearChcData(chcId: string) {
    for (const map of [this.machines, this.fields, this.plans, this.workLogs] as Map<string, { chcId: string }>[]) {
      for (const [key, value] of map) if (value.chcId === chcId) map.delete(key);
    }
    for (const [key, value] of this.promises) if (value.chcId === chcId) this.promises.delete(key);
  }
}
