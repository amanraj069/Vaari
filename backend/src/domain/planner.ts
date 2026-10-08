/**
 * The planner turns stored records into an engine request, and the engine's answer back into
 * records people see. It exists so that every path that changes the plan (a new request, a
 * breakdown, an approval) goes through one place that enforces the promise rules:
 * - a new field gets its first promise as soon as the engine places it;
 * - a window narrows to a firm date only when the operator approves the plan;
 * - a promise breaks only when the engine ran in minimal-break mode, and the farmer sees it at once
 *   (the farmer page derives that notice from the promise history).
 * Work on one CHC is serialised in-process; across processes, plan versions are create-only and
 * approval is a conditional write, so two writers cannot both win.
 */
import { randomUUID } from "node:crypto";
import { dateToDay, dayToDate, learnRate, type FieldPromise, type FieldRequestInput, type Pin, type SolveRequest, type SolveResponse } from "../shared";
import type { Config } from "../config";
import type { EngineClient } from "../engine/client";
import { loadVillages } from "../demo/seed";
import {
  StoreConflictError,
  type ChcRecord,
  type FieldRecord,
  type MachineRecord,
  type PlanRecord,
  type PromiseReason,
  type PromiseRecord,
  type ReplanCause,
  type ReplanRecord,
  type VaariStore,
  type VillageRecord,
  type WorkLogRecord,
} from "../store/types";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const PROMISE_REASON_BY_CAUSE: Record<ReplanCause, PromiseReason> = {
  breakdown: "breakdown",
  machine_back: "replan",
  rain: "rain",
  manual_move: "manual_move",
  new_request: "replan",
  farmer_update: "replan",
};

export function currentPromise(history: PromiseRecord[]): PromiseRecord | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index]!;
    if (record.state === "held") return record;
    if (record.state === "broken" || record.state === "kept") return null;
  }
  return null;
}

/** Promise records of a CHC grouped by field, each history oldest version first. */
export function groupPromises(records: PromiseRecord[]): Map<string, PromiseRecord[]> {
  const byField = new Map<string, PromiseRecord[]>();
  for (const record of records) {
    const history = byField.get(record.fieldId) ?? [];
    history.push(record);
    byField.set(record.fieldId, history);
  }
  for (const history of byField.values()) history.sort((left, right) => left.version - right.version);
  return byField;
}

/** Work logs grouped by machine, in the shape the rate learner takes. */
export function logsByMachine(logs: WorkLogRecord[]): Map<string, { acres: number; hours: number }[]> {
  const byMachine = new Map<string, { acres: number; hours: number }[]>();
  for (const log of logs) {
    const list = byMachine.get(log.machineId) ?? [];
    list.push({ acres: log.acres, hours: log.hours });
    byMachine.set(log.machineId, list);
  }
  return byMachine;
}

export class Planner {
  private readonly chcQueues = new Map<string, Promise<unknown>>();
  private villageCache: VillageRecord[] | null = null;

  constructor(
    private readonly store: VaariStore,
    private readonly engine: EngineClient,
    private readonly config: Config,
  ) {}

  /** The demo runs on a simulated season clock (DEMO_TODAY), labelled as such in the UI. */
  today(): number {
    return dateToDay(this.config.SEASON_START_DATE, this.config.DEMO_TODAY);
  }

  dayToIso(day: number): string {
    return dayToDate(this.config.SEASON_START_DATE, day);
  }

  /** Village points are static reference data (OpenStreetMap, data/villages.json), not a table. */
  villages(): VillageRecord[] {
    this.villageCache ??= loadVillages(this.config);
    return this.villageCache;
  }

  private withChcLock<Result>(chcId: string, work: () => Promise<Result>): Promise<Result> {
    const previous = this.chcQueues.get(chcId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.chcQueues.set(chcId, next);
    return next;
  }

  async loadChc(chcId: string): Promise<{ chc: ChcRecord; machines: MachineRecord[]; fields: FieldRecord[] }> {
    const chc = await this.store.getChc(chcId);
    if (!chc) throw new NotFoundError(`CHC ${chcId} not found`);
    const [machines, fields] = await Promise.all([this.store.listMachines(chcId), this.store.listFields(chcId)]);
    machines.sort((left, right) => left.id.localeCompare(right.id));
    fields.sort((left, right) => left.requestOrder - right.requestOrder);
    return { chc, machines, fields };
  }

  async buildSolveRequest(chcId: string, pins: Pin[] = []): Promise<{
    request: SolveRequest;
    activeFields: FieldRecord[];
    promiseByField: Map<string, PromiseRecord>;
    historyByField: Map<string, PromiseRecord[]>;
  }> {
    const { chc, machines, fields } = await this.loadChc(chcId);
    const [promiseRecords, workLogs] = await Promise.all([this.store.listPromises(chcId), this.store.listWorkLogs(chcId)]);
    const historyByField = groupPromises(promiseRecords);
    const machineLogs = logsByMachine(workLogs);
    const chcVillages = this.villages().filter((village) => chc.villageIds.includes(village.id));
    const activeFields = fields.filter((field) => field.state !== "done");
    const promiseByField = new Map<string, PromiseRecord>();
    for (const field of activeFields) {
      const held = currentPromise(historyByField.get(field.id) ?? []);
      if (held) promiseByField.set(field.id, held);
    }
    const request: SolveRequest = {
      seasonStartDate: this.config.SEASON_START_DATE,
      today: this.today(),
      horizonDays: 10,
      optimumLastDay: dateToDay(this.config.SEASON_START_DATE, this.config.OPTIMUM_LAST_DATE),
      base: chc.base,
      villages: chcVillages.map(({ id, name, lat, lon }) => ({ id, name, lat, lon })),
      machines: machines.map((machine) => {
        const rate = learnRate(machineLogs.get(machine.id) ?? []);
        return {
          id: machine.id,
          name: machine.name,
          hoursPerDay: machine.hoursPerDay,
          rate: { promiseAcresPerHour: rate.promiseAcresPerHour, planAcresPerHour: rate.planAcresPerHour },
          downDays: machine.downDays,
        };
      }),
      fields: activeFields.map((field) => ({
        id: field.id,
        villageId: field.villageId,
        acres: field.acres,
        readyDay: field.readyDay,
        waitingLimitDays: field.waitingLimitDays,
        requestOrder: field.requestOrder,
        promise: promiseByField.get(field.id)?.promise ?? null,
        previousDay: field.plannedDay,
      })),
      rainDays: chc.rainDays,
      pins,
      settings: {
        fairnessKDays: chc.settings.fairnessKDays,
        timeLimitSeconds: this.config.ENGINE_TIME_LIMIT_SECONDS,
        method: this.config.ENGINE_METHOD,
        searchSeed: this.config.ENGINE_SEARCH_SEED,
      },
    };
    return { request, activeFields, promiseByField, historyByField };
  }

  /** Re-solve and apply. Callers must hold the CHC lock. */
  private async replanLocked(chcId: string, cause: ReplanCause, machineId: string | null): Promise<ReplanRecord> {
    const { request, activeFields, promiseByField, historyByField } = await this.buildSolveRequest(chcId);
    const solved = await this.engine.solve(request);
    const now = new Date().toISOString();
    const promiseOutByField = new Map(solved.promises.map((item) => [item.fieldId, item]));
    const lastMachineByField = new Map<string, string>();
    for (const assignment of solved.assignments) {
      if (assignment.part === assignment.parts) lastMachineByField.set(assignment.fieldId, assignment.machineId);
    }

    const moved: ReplanRecord["moved"] = [];
    const broken: ReplanRecord["broken"] = [];
    for (const field of activeFields) {
      const newDay = solved.fieldDays[field.id] ?? null;
      if (field.plannedDay !== null && field.plannedDay !== newDay) {
        moved.push({ fieldId: field.id, fromDay: field.plannedDay, toDay: newDay });
      }
      const promiseOut = promiseOutByField.get(field.id);
      const held = promiseByField.get(field.id) ?? null;
      let holdsPromise = held !== null;

      if (promiseOut?.broken && held) {
        await this.store.putPromise({ ...held, state: "broken", at: now });
        holdsPromise = false;
        if (promiseOut.promise) {
          await this.store.putPromise({
            chcId,
            fieldId: field.id,
            version: held.version + 1,
            promise: promiseOut.promise,
            state: "held",
            at: now,
            reason: PROMISE_REASON_BY_CAUSE[cause],
          });
          holdsPromise = true;
        }
        broken.push({ fieldId: field.id, previous: held.promise, next: promiseOut.promise });
      } else if (!held && promiseOut?.promise) {
        const history = historyByField.get(field.id) ?? [];
        await this.store.putPromise({
          chcId,
          fieldId: field.id,
          version: (history.at(-1)?.version ?? 0) + 1,
          promise: promiseOut.promise,
          state: "held",
          at: now,
          // A field that held a promise before (released by "I cannot wait longer") gets a re-plan, not a first promise.
          reason: history.length > 0 ? PROMISE_REASON_BY_CAUSE[cause] : "first_promise",
        });
        holdsPromise = true;
      }

      await this.store.putField({
        ...field,
        plannedDay: newDay,
        plannedMachineId: lastMachineByField.get(field.id) ?? null,
        state: holdsPromise ? "promised" : "waiting",
      });
    }

    // Windows that the engine would now narrow to a firm date wait for the operator's approval.
    const firmingFieldIds = solved.promises
      .filter((item) => item.changed && !item.broken && item.previous?.kind === "window" && item.promise?.kind === "firm")
      .map((item) => item.fieldId);
    const previousPlan = await this.store.latestPlan(chcId);
    const replan: ReplanRecord = { chcId, at: now, cause, machineId, moved, broken };
    const plan: PlanRecord = {
      chcId,
      planDay: solved.planStartDay,
      planDate: this.dayToIso(solved.planStartDay),
      version: (previousPlan?.version ?? 0) + 1,
      status: "proposed",
      createdAt: now,
      approvedAt: null,
      approvedBy: null,
      solve: solved,
      firmingFieldIds,
      executionArn: null,
      // A new booking is not news on the board; keep showing the last breakdown or rain re-plan.
      lastReplan: cause === "new_request" ? (previousPlan?.lastReplan ?? null) : replan,
    };
    try {
      await this.store.createPlan(plan);
    } catch (error) {
      if (error instanceof StoreConflictError) throw new ConflictError("another re-plan finished first; reload the plan");
      throw error;
    }
    return replan;
  }

  replan(chcId: string, cause: ReplanCause, machineId: string | null = null): Promise<ReplanRecord> {
    return this.withChcLock(chcId, () => this.replanLocked(chcId, cause, machineId));
  }

  async requestField(
    chcId: string,
    farmer: { farmerId: string; farmerName: string; bookedBy: string | null },
    input: FieldRequestInput,
  ): Promise<FieldRecord> {
    return this.withChcLock(chcId, async () => {
      const { chc, fields } = await this.loadChc(chcId);
      if (!chc.villageIds.includes(input.villageId)) throw new NotFoundError("village is not served by this CHC");
      const nextOrder = fields.reduce((highest, field) => Math.max(highest, field.requestOrder), -1) + 1;
      const field: FieldRecord = {
        chcId,
        id: `f-${randomUUID().slice(0, 8)}`,
        token: fields.reduce((highest, item) => Math.max(highest, item.token), 0) + 1,
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
        villageId: input.villageId,
        acres: input.acres,
        readyDay: dateToDay(this.config.SEASON_START_DATE, input.readyDate),
        waitingLimitDays: input.waitingLimitDays,
        requestOrder: nextOrder,
        createdAt: new Date().toISOString(),
        state: "waiting",
        plannedDay: null,
        plannedMachineId: null,
        bookedBy: farmer.bookedBy,
      };
      await this.store.putField(field);
      await this.replanLocked(chcId, "new_request", null);
      const saved = await this.store.getField(chcId, field.id);
      if (!saved) throw new NotFoundError("field vanished during planning");
      return saved;
    });
  }

  /**
   * Approves exactly the plan version the operator was looking at. The store's conditional write
   * makes this happen once: a second approval of the same version (another tab, a retry, a second
   * API task) fails with a conflict instead of firming promises twice.
   */
  async approvePlan(chcId: string, version: number, approvedBy: string): Promise<PlanRecord> {
    return this.withChcLock(chcId, async () => {
      const plan = await this.store.latestPlan(chcId);
      if (!plan) throw new NotFoundError("no plan to approve");
      if (plan.version !== version) throw new ConflictError("the plan changed since you opened it; review the new plan");
      if (plan.status === "approved") throw new ConflictError("this plan is already approved");
      const now = new Date().toISOString();
      let approved: PlanRecord;
      try {
        approved = await this.store.approvePlan(chcId, plan.planDate, version, approvedBy, now);
      } catch (error) {
        if (error instanceof StoreConflictError) throw new ConflictError("this plan was already approved or replaced");
        throw error;
      }
      // Only the winner of the conditional write firms the windows.
      const historyByField = groupPromises(await this.store.listPromises(chcId));
      for (const fieldId of plan.firmingFieldIds) {
        const held = currentPromise(historyByField.get(fieldId) ?? []);
        const day = plan.solve.fieldDays[fieldId];
        if (!held || day === undefined) continue;
        const firm: FieldPromise = { kind: "firm", day };
        await this.store.putPromise({ ...held, state: "replaced", at: now });
        await this.store.putPromise({ chcId, fieldId, version: held.version + 1, promise: firm, state: "held", at: now, reason: "narrowed" });
      }
      return approved;
    });
  }

  /**
   * "I cannot wait longer": the farmer's last waiting day moves earlier and the plan is redone.
   * Every other farmer's promise stays a hard constraint, but this farmer's own promise is released
   * for the solve: kept as a hard constraint, it pinned the field inside the old dates and the new
   * last day was silently ignored (the old window still "held"). If the solver cannot do at least as
   * well as the old promise, the old promise is restored, so asking for sooner never makes it later.
   * Only shortening is allowed from a slot link; a longer wait would quietly lower the field's
   * priority without anyone deciding that.
   */
  async shortenWaitingLimit(chcId: string, fieldId: string, waitingLimitDays: number): Promise<FieldRecord> {
    return this.withChcLock(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      if (field.state === "done") throw new ConflictError("this field has already been sown");
      if (waitingLimitDays >= field.waitingLimitDays) throw new ConflictError("the new waiting limit must be shorter than the current one");
      const heldBefore = currentPromise(groupPromises(await this.store.listPromises(chcId)).get(fieldId) ?? []);
      await this.store.putField({ ...field, waitingLimitDays });
      if (heldBefore) await this.store.putPromise({ ...heldBefore, state: "replaced", at: new Date().toISOString() });
      await this.replanLocked(chcId, "farmer_update", null);

      if (heldBefore) {
        const heldAfter = currentPromise(groupPromises(await this.store.listPromises(chcId)).get(fieldId) ?? []);
        // No promise at all counts as worse than any date.
        const latestDay = (promise: FieldPromise | null) => (promise === null ? Number.POSITIVE_INFINITY : promise.kind === "firm" ? promise.day : promise.endDay);
        if (!heldAfter || latestDay(heldAfter.promise) > latestDay(heldBefore.promise)) {
          const now = new Date().toISOString();
          if (heldAfter) await this.store.putPromise({ ...heldAfter, state: "replaced", at: now });
          await this.store.putPromise({ ...heldBefore, version: (heldAfter?.version ?? heldBefore.version) + 1, state: "held", at: now });
          await this.replanLocked(chcId, "farmer_update", null);
        }
      }
      const saved = await this.store.getField(chcId, fieldId);
      if (!saved) throw new NotFoundError("field vanished during planning");
      return saved;
    });
  }

  async setMachineDown(chcId: string, machineId: string, downDayCount: number): Promise<ReplanRecord> {
    return this.withChcLock(chcId, async () => {
      const machine = (await this.store.listMachines(chcId)).find((item) => item.id === machineId);
      if (!machine) throw new NotFoundError(`machine ${machineId} not found`);
      const tomorrow = this.today() + 1;
      const downDays = new Set(machine.downDays);
      for (let offset = 0; offset < downDayCount; offset += 1) downDays.add(tomorrow + offset);
      await this.store.putMachine({ ...machine, downDays: [...downDays].sort((left, right) => left - right) });
      return this.replanLocked(chcId, "breakdown", machineId);
    });
  }

  async setMachineBack(chcId: string, machineId: string): Promise<ReplanRecord> {
    return this.withChcLock(chcId, async () => {
      const machine = (await this.store.listMachines(chcId)).find((item) => item.id === machineId);
      if (!machine) throw new NotFoundError(`machine ${machineId} not found`);
      const today = this.today();
      await this.store.putMachine({ ...machine, downDays: machine.downDays.filter((day) => day <= today) });
      return this.replanLocked(chcId, "machine_back", machineId);
    });
  }

  async latestSolve(chcId: string): Promise<{ plan: PlanRecord; solve: SolveResponse }> {
    let plan = await this.store.latestPlan(chcId);
    if (!plan) {
      await this.replan(chcId, "new_request");
      plan = await this.store.latestPlan(chcId);
    }
    if (!plan) throw new NotFoundError("no plan");
    return { plan, solve: plan.solve };
  }
}
