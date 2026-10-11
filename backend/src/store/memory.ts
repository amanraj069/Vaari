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
  type FieldPlanUpdate,
  type FieldRecord,
  type FireCheckRecord,
  type DeliveryStatus,
  type FarmerAccountRecord,
  type OtpChallengeRecord,
  type LoginTokenRecord,
  type MachineRecord,
  type OutboundNoticeRecord,
  type WhatsAppDraftRecord,
  type PlanChanges,
  type PlanRecord,
  type PromiseRecord,
  type PublishWrites,
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
  private loginTokens = new Map<string, LoginTokenRecord>();
  private inboundMessages = new Map<string, string>(); // messageId -> expiresAt
  private whatsAppDrafts = new Map<string, WhatsAppDraftRecord>();
  private outboundNotices = new Map<string, OutboundNoticeRecord>();
  private farmerAccounts = new Map<string, FarmerAccountRecord>();
  private otpChallenges = new Map<string, OtpChallengeRecord>();

  private seasonDayOffset = 0;
  async getSeasonDayOffset() {
    return this.seasonDayOffset;
  }
  async setSeasonDayOffset(offset: number) {
    this.seasonDayOffset = offset;
  }
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
  async deleteMachine(chcId: string, machineId: string) {
    this.machines.delete(`${chcId}/${machineId}`);
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
  async deleteField(chcId: string, fieldId: string) {
    this.fields.delete(`${chcId}/${fieldId}`);
  }
  async setFieldPlan(chcId: string, update: FieldPlanUpdate) {
    const field = this.fields.get(`${chcId}/${update.fieldId}`);
    if (!field || field.state === "done") return;
    const { fieldId: _fieldId, ...planned } = update;
    this.fields.set(`${chcId}/${update.fieldId}`, copy({ ...field, ...planned, soonerRequestedAt: null }));
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
  async listFieldsByPhone(phone: string) {
    return copy(
      [...this.fields.values()]
        .filter((field) => field.farmerPhone === phone)
        .sort((left, right) => byString(left.createdAt, right.createdAt)),
    );
  }
  async bumpLinkVersion(chcId: string, fieldId: string) {
    const field = this.fields.get(`${chcId}/${fieldId}`);
    if (!field) return null;
    const bumped = { ...field, linkVersion: field.linkVersion + 1 };
    this.fields.set(`${chcId}/${fieldId}`, copy(bumped));
    return copy(bumped);
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

  private plansOf(chcId: string) {
    return [...this.plans.values()]
      .filter((plan) => plan.chcId === chcId)
      .sort((left, right) => byString(left.planDate, right.planDate) || left.version - right.version);
  }
  async latestPlan(chcId: string) {
    return copy(this.plansOf(chcId).at(-1) ?? null);
  }
  async latestApprovedPlan(chcId: string) {
    return copy(this.plansOf(chcId).filter((plan) => plan.status === "approved").at(-1) ?? null);
  }
  async createPlan(plan: PlanRecord) {
    const key = `${plan.chcId}/${plan.planDate}/${plan.version}`;
    if (this.plans.has(key)) throw new StoreConflictError(`plan ${plan.planDate} v${plan.version} already exists`);
    this.plans.set(key, copy(plan));
  }
  async beginPublish(
    chcId: string,
    planDate: string,
    version: number,
    approval: { approvedBy: string; approvedAt: string; changes: PlanChanges; publish: PublishWrites },
  ) {
    const key = `${chcId}/${planDate}/${version}`;
    const plan = this.plans.get(key);
    if (!plan || plan.status !== "draft") throw new StoreConflictError("plan is not a draft at that version");
    const publishing: PlanRecord = { ...plan, status: "publishing", ...approval };
    this.plans.set(key, copy(publishing));
    return copy(publishing);
  }
  async completePublish(chcId: string, planDate: string, version: number) {
    const key = `${chcId}/${planDate}/${version}`;
    const plan = this.plans.get(key);
    if (!plan || plan.status === "draft") throw new StoreConflictError("plan is not being published");
    const approved: PlanRecord = { ...plan, status: "approved" };
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

  async putLoginToken(record: LoginTokenRecord) {
    this.loginTokens.set(record.jti, copy(record));
  }
  async useLoginToken(jti: string, usedAt: string) {
    const record = this.loginTokens.get(jti);
    if (!record || record.usedAt !== null) return null;
    const used = { ...record, usedAt };
    this.loginTokens.set(jti, copy(used));
    return copy(used);
  }

  async claimInboundMessage(messageId: string, receivedAt: string, expiresAt: string) {
    const held = this.inboundMessages.get(messageId);
    // Like DynamoDB TTL: an expired claim is as good as gone.
    if (held !== undefined && held > receivedAt) return false;
    this.inboundMessages.set(messageId, expiresAt);
    return true;
  }
  async putWhatsAppDraft(record: WhatsAppDraftRecord) {
    this.whatsAppDrafts.set(record.draftId, copy(record));
  }
  async useWhatsAppDraft(draftId: string, phone: string, at: string) {
    const draft = this.whatsAppDrafts.get(draftId);
    if (!draft || draft.phone !== phone || draft.usedAt !== null || draft.expiresAt <= at) return null;
    const used = { ...draft, usedAt: at };
    this.whatsAppDrafts.set(draftId, copy(used));
    return copy(used);
  }
  async putOutboundNotice(record: OutboundNoticeRecord) {
    this.outboundNotices.set(record.messageId, copy(record));
  }
  async setNoticeStatus(messageId: string, status: DeliveryStatus, at: string, error: string | null) {
    const notice = this.outboundNotices.get(messageId);
    if (!notice || notice.statusAt > at) return false;
    this.outboundNotices.set(messageId, copy({ ...notice, status, statusAt: at, error }));
    return true;
  }
  async getOutboundNotice(messageId: string) {
    return copy(this.outboundNotices.get(messageId) ?? null);
  }

  async getFarmerAccount(phone: string) {
    return copy(this.farmerAccounts.get(phone) ?? null);
  }
  async createFarmerAccount(record: FarmerAccountRecord) {
    const existing = this.farmerAccounts.get(record.phone);
    if (existing) return copy(existing);
    this.farmerAccounts.set(record.phone, copy(record));
    return copy(record);
  }
  async putOtpChallenge(record: OtpChallengeRecord) {
    this.otpChallenges.set(record.phone, copy(record));
  }
  async getOtpChallenge(phone: string) {
    return copy(this.otpChallenges.get(phone) ?? null);
  }
  async countOtpAttempt(phone: string, seen: number) {
    const challenge = this.otpChallenges.get(phone);
    if (!challenge || challenge.attempts !== seen) return false;
    this.otpChallenges.set(phone, { ...challenge, attempts: seen + 1 });
    return true;
  }
  async deleteOtpChallenge(phone: string, codeHash: string) {
    const challenge = this.otpChallenges.get(phone);
    if (!challenge || challenge.codeHash !== codeHash) return false;
    this.otpChallenges.delete(phone);
    return true;
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
