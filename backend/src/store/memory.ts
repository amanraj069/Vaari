/**
 * In-memory store for local development and tests (no AWS account needed). Values are deep-copied
 * on the way in and out so callers cannot mutate stored state by accident, as with a real database.
 */
import type {
  ChcRecord,
  FarmerRecord,
  FieldRecord,
  MachineRecord,
  NotificationRecord,
  PlanRecord,
  PromiseRecord,
  ReplanRecord,
  UserRecord,
  VaariStore,
  VillageRecord,
} from "./types";

const copy = <Value>(value: Value): Value => structuredClone(value);

export class MemoryStore implements VaariStore {
  private villages: VillageRecord[] = [];
  private chcs = new Map<string, ChcRecord>();
  private machines = new Map<string, MachineRecord>();
  private fields = new Map<string, FieldRecord>();
  private promises = new Map<string, PromiseRecord[]>();
  private plans = new Map<string, PlanRecord>();
  private replans = new Map<string, ReplanRecord>();
  private notifications: NotificationRecord[] = [];
  private farmers = new Map<string, FarmerRecord>();
  private users = new Map<string, UserRecord>();

  async listVillages() {
    return copy(this.villages);
  }
  async putVillages(villages: VillageRecord[]) {
    this.villages = copy(villages);
  }
  async listChcs() {
    return copy([...this.chcs.values()]);
  }
  async getChc(chcId: string) {
    return copy(this.chcs.get(chcId) ?? null);
  }
  async putChc(chc: ChcRecord) {
    this.chcs.set(chc.id, copy(chc));
  }
  async listMachines(chcId: string) {
    return copy([...this.machines.values()].filter((machine) => machine.chcId === chcId));
  }
  async putMachine(machine: MachineRecord) {
    this.machines.set(`${machine.chcId}/${machine.id}`, copy(machine));
  }
  async listFields(chcId: string) {
    return copy([...this.fields.values()].filter((field) => field.chcId === chcId));
  }
  async getField(fieldId: string) {
    return copy(this.fields.get(fieldId) ?? null);
  }
  async putField(field: FieldRecord) {
    this.fields.set(field.id, copy(field));
  }
  async listFieldsByFarmer(farmerId: string) {
    return copy([...this.fields.values()].filter((field) => field.farmerId === farmerId));
  }
  async promiseHistory(fieldId: string) {
    return copy(this.promises.get(fieldId) ?? []);
  }
  async putPromise(record: PromiseRecord) {
    const history = this.promises.get(record.fieldId) ?? [];
    const existing = history.findIndex((item) => item.version === record.version);
    if (existing >= 0) history[existing] = copy(record);
    else history.push(copy(record));
    history.sort((left, right) => left.version - right.version);
    this.promises.set(record.fieldId, history);
  }
  async latestPlan(chcId: string) {
    return copy(this.plans.get(chcId) ?? null);
  }
  async putPlan(plan: PlanRecord) {
    this.plans.set(plan.chcId, copy(plan));
  }
  async lastReplan(chcId: string) {
    return copy(this.replans.get(chcId) ?? null);
  }
  async putReplan(record: ReplanRecord) {
    this.replans.set(record.chcId, copy(record));
  }
  async listNotifications(farmerId: string) {
    return copy(this.notifications.filter((notification) => notification.farmerId === farmerId));
  }
  async putNotification(record: NotificationRecord) {
    this.notifications.push(copy(record));
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
}
