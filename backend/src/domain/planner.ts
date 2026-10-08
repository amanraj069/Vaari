/**
 * The planner turns stored records into an engine request, and the engine's answer back into
 * records people see. It exists so that every path that changes the plan (a new request, a
 * breakdown, an approval) goes through one place that enforces the promise rules:
 * - a new field gets its first promise as soon as the engine places it;
 * - a window narrows to a firm date only when the operator approves the plan;
 * - a promise breaks only when the engine ran in minimal-break mode, and the farmer is told at once.
 * Work on one CHC is serialised so two re-plans never interleave.
 */
import { randomUUID } from "node:crypto";
import { dateToDay, dayToDate, learnRate, type FieldPromise, type FieldRequestInput, type Pin, type SolveRequest, type SolveResponse } from "../shared";
import type { Config } from "../config";
import type { EngineClient } from "../engine/client";
import type {
  ChcRecord,
  FieldRecord,
  MachineRecord,
  PlanRecord,
  PromiseReason,
  PromiseRecord,
  ReplanCause,
  ReplanRecord,
  VaariStore,
} from "../store/types";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const PROMISE_REASON_BY_CAUSE: Record<ReplanCause, PromiseReason> = {
  breakdown: "breakdown",
  machine_back: "replan",
  rain: "rain",
  manual_move: "manual_move",
  new_request: "replan",
};

export function currentPromise(history: PromiseRecord[]): PromiseRecord | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index]!;
    if (record.state === "held") return record;
    if (record.state === "broken" || record.state === "kept") return null;
  }
  return null;
}

export class Planner {
  private readonly chcQueues = new Map<string, Promise<unknown>>();

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
  }> {
    const { chc, machines, fields } = await this.loadChc(chcId);
    const villages = await this.store.listVillages();
    const chcVillages = villages.filter((village) => chc.villageIds.includes(village.id));
    const activeFields = fields.filter((field) => field.state !== "done");
    const promiseByField = new Map<string, PromiseRecord>();
    for (const field of activeFields) {
      const held = currentPromise(await this.store.promiseHistory(field.id));
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
        const rate = learnRate(machine.logs);
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
      settings: { fairnessKDays: chc.settings.fairnessKDays, timeLimitSeconds: this.config.ENGINE_TIME_LIMIT_SECONDS },
    };
    return { request, activeFields, promiseByField };
  }

  /** Re-solve and apply. Callers must hold the CHC lock. */
  private async replanLocked(chcId: string, cause: ReplanCause, machineId: string | null): Promise<ReplanRecord> {
    const { request, activeFields, promiseByField } = await this.buildSolveRequest(chcId);
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
        await this.store.putNotification({ id: randomUUID(), farmerId: field.farmerId, fieldId: field.id, kind: "broken", at: now });
        broken.push({ fieldId: field.id, previous: held.promise, next: promiseOut.promise });
      } else if (!held && promiseOut?.promise) {
        const history = await this.store.promiseHistory(field.id);
        await this.store.putPromise({
          chcId,
          fieldId: field.id,
          version: (history.at(-1)?.version ?? 0) + 1,
          promise: promiseOut.promise,
          state: "held",
          at: now,
          reason: "first_promise",
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
    const plan: PlanRecord = {
      chcId,
      planDay: solved.planStartDay,
      version: (previousPlan?.version ?? 0) + 1,
      status: "proposed",
      createdAt: now,
      approvedAt: null,
      approvedBy: null,
      solve: solved,
      firmingFieldIds,
      executionArn: null,
    };
    await this.store.putPlan(plan);
    const replan: ReplanRecord = { chcId, at: now, cause, machineId, moved, broken };
    if (cause !== "new_request") await this.store.putReplan(replan);
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
      const saved = await this.store.getField(field.id);
      if (!saved) throw new NotFoundError("field vanished during planning");
      return saved;
    });
  }

  async approvePlan(chcId: string, version: number, approvedBy: string): Promise<PlanRecord> {
    return this.withChcLock(chcId, async () => {
      const plan = await this.store.latestPlan(chcId);
      if (!plan) throw new NotFoundError("no plan to approve");
      if (plan.version !== version) throw new ConflictError("the plan changed since you opened it; review the new plan");
      if (plan.status === "approved") return plan;
      const now = new Date().toISOString();
      for (const fieldId of plan.firmingFieldIds) {
        const held = currentPromise(await this.store.promiseHistory(fieldId));
        const day = plan.solve.fieldDays[fieldId];
        if (!held || day === undefined) continue;
        const firm: FieldPromise = { kind: "firm", day };
        await this.store.putPromise({ ...held, state: "replaced", at: now });
        await this.store.putPromise({ chcId, fieldId, version: held.version + 1, promise: firm, state: "held", at: now, reason: "narrowed" });
        const field = await this.store.getField(fieldId);
        if (field) await this.store.putNotification({ id: randomUUID(), farmerId: field.farmerId, fieldId, kind: "firmed", at: now });
      }
      const approved: PlanRecord = { ...plan, status: "approved", approvedAt: now, approvedBy, firmingFieldIds: [] };
      await this.store.putPlan(approved);
      return approved;
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
