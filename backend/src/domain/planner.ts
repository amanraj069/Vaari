/**
 * The planner turns stored records into an engine request, and a plan into promises people see.
 * It exists so that every path that changes a farmer's date goes through one place with one rule:
 *
 *   Every engine run makes a DRAFT plan. Only the operator's approval publishes it, and publishing
 *   is the only thing that writes promises.
 *
 * - A booking is a request: it is stored at once (no engine run) and waits for the next plan.
 * - Generate, move a field, a breakdown, a machine back, or a farmer's "I cannot wait longer" each
 *   make a new draft, with the list of what approving it would change (domain/promises.ts).
 * - Approving publishes: requested fields get their first promise (firm if the day is within two
 *   days, else a window), windows inside two days become firm, and a promise breaks only when the
 *   engine ran in minimal-break mode. Every change passes the promise state machine.
 * Work on one CHC is serialised in-process; across processes, plan versions are create-only and
 * approval is a conditional write on (draft, version), so two writers cannot both win.
 */
import { randomUUID } from "node:crypto";
import {
  dateToDay,
  dayToDate,
  learnRate,
  type BookingInput,
  type FieldPromise,
  type Pin,
  type SolveRequest,
} from "../shared";
import type { Config } from "../config";
import type { EngineClient } from "../engine/client";
import { loadVillages } from "../demo/seed";
import {
  StoreConflictError,
  type ChcRecord,
  type FieldRecord,
  type MachineRecord,
  type PlanCause,
  type PlanChanges,
  type PlanRecord,
  type FieldPlanUpdate,
  type PromiseReason,
  type PromiseRecord,
  type PublishWrites,
  type VaariStore,
  type VillageRecord,
  type WorkLogRecord,
} from "../store/types";
import { currentPromise, lastDay, nextStatus, planChanges, promiseStatus } from "./promises";

export { currentPromise } from "./promises";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
/** The operator asked for a move the rules cannot allow (machine down, rain, field not ready yet). */
export class ImpossibleMoveError extends Error {}

const HORIZON_DAYS = 10;

// Why a promise changed, as the farmer's history shows it.
const PROMISE_REASON_BY_CAUSE: Record<PlanCause, PromiseReason> = {
  generate: "replan",
  breakdown: "breakdown",
  machine_back: "replan",
  rain: "rain",
  manual_move: "manual_move",
  farmer_update: "replan",
};

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

  isoToDay(isoDate: string): number {
    return dateToDay(this.config.SEASON_START_DATE, isoDate);
  }

  /** The days a plan covers: tomorrow and the nine after it. */
  planDays(): number[] {
    const tomorrow = this.today() + 1;
    return Array.from({ length: HORIZON_DAYS }, (_, offset) => tomorrow + offset);
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

  /**
   * The engine request for this CHC. Held promises are hard constraints, except for a farmer who
   * asked for sooner: their promise is left out so the engine can find an earlier day, unless
   * `keepPromiseOf` names them (the earlier day could not be found; see generateLocked).
   */
  async buildSolveRequest(
    chcId: string,
    pins: Pin[] = [],
    keepPromiseOf: ReadonlySet<string> = new Set(),
  ): Promise<{ request: SolveRequest; activeFields: FieldRecord[]; heldByField: Map<string, PromiseRecord | null> }> {
    const { chc, machines, fields } = await this.loadChc(chcId);
    const [promiseRecords, workLogs] = await Promise.all([this.store.listPromises(chcId), this.store.listWorkLogs(chcId)]);
    const historyByField = groupPromises(promiseRecords);
    const machineLogs = logsByMachine(workLogs);
    const chcVillages = this.villages().filter((village) => chc.villageIds.includes(village.id));
    const activeFields = fields.filter((field) => field.state !== "done");
    const heldByField = new Map<string, PromiseRecord | null>();
    for (const field of activeFields) heldByField.set(field.id, currentPromise(historyByField.get(field.id) ?? []));
    const request: SolveRequest = {
      seasonStartDate: this.config.SEASON_START_DATE,
      today: this.today(),
      horizonDays: HORIZON_DAYS,
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
      fields: activeFields.map((field) => {
        const held = heldByField.get(field.id)?.promise ?? null;
        const released = field.soonerRequestedAt !== null && !keepPromiseOf.has(field.id);
        return {
          id: field.id,
          villageId: field.villageId,
          acres: field.acres,
          readyDay: field.readyDay,
          waitingLimitDays: field.waitingLimitDays,
          requestOrder: field.requestOrder,
          promise: released ? null : held,
          previousDay: field.plannedDay,
        };
      }),
      rainDays: chc.rainDays,
      pins,
      settings: {
        fairnessKDays: chc.settings.fairnessKDays,
        timeLimitSeconds: this.config.ENGINE_TIME_LIMIT_SECONDS,
        method: this.config.ENGINE_METHOD,
        searchSeed: this.config.ENGINE_SEARCH_SEED,
      },
    };
    return { request, activeFields, heldByField };
  }

  /** Solve and store a new draft. Callers must hold the CHC lock. */
  private async generateLocked(chcId: string, cause: PlanCause, causeMachineId: string | null, pins: Pin[]): Promise<PlanRecord> {
    let { request, activeFields, heldByField } = await this.buildSolveRequest(chcId, pins);
    let solve = await this.engine.solve(request);

    // A farmer who asked for sooner must never end up later. If the engine could not place them
    // inside their old promise, solve again with that promise kept as a hard constraint.
    const promiseOut = new Map(solve.promises.map((item) => [item.fieldId, item.promise]));
    const keepPromiseOf = new Set(
      activeFields
        .filter((field) => {
          const held = heldByField.get(field.id)?.promise;
          if (!field.soonerRequestedAt || !held) return false;
          const offered = promiseOut.get(field.id) ?? null;
          return offered === null || lastDay(offered) > lastDay(held);
        })
        .map((field) => field.id),
    );
    if (keepPromiseOf.size > 0) {
      ({ request, activeFields, heldByField } = await this.buildSolveRequest(chcId, pins, keepPromiseOf));
      solve = await this.engine.solve(request);
    }

    const latest = await this.store.latestPlan(chcId);
    const plan: PlanRecord = {
      chcId,
      planDay: solve.planStartDay,
      planDate: this.dayToIso(solve.planStartDay),
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      solve,
      cause,
      causeMachineId,
      pins,
      changes: planChanges(activeFields, heldByField, solve),
      publish: null,
      executionArn: null,
    };
    try {
      await this.store.createPlan(plan);
    } catch (error) {
      if (error instanceof StoreConflictError) throw new ConflictError("another plan was made at the same moment; reload the plan");
      throw error;
    }
    return plan;
  }

  /** The operator asks for tomorrow's plan: a fresh draft with no manual moves. */
  generatePlan(chcId: string, cause: PlanCause = "generate", causeMachineId: string | null = null): Promise<PlanRecord> {
    return this.withChcWork(chcId, () => this.generateLocked(chcId, cause, causeMachineId, []));
  }

  /**
   * The operator moves one field to a machine and day. The move is a hard constraint (a pin) and
   * the engine re-plans everyone else around it; earlier moves in the same draft stay.
   */
  async moveField(chcId: string, fieldId: string, machineId: string, day: number): Promise<PlanRecord> {
    return this.withChcWork(chcId, async () => {
      const { machines, fields } = await this.loadChc(chcId);
      const field = fields.find((item) => item.id === fieldId);
      if (!field || field.state === "done") throw new NotFoundError("field not found or already sown");
      const machine = machines.find((item) => item.id === machineId);
      if (!machine) throw new NotFoundError(`machine ${machineId} not found`);
      if (!this.planDays().includes(day)) throw new ImpossibleMoveError("that day is outside the plan");
      if (day < field.readyDay) throw new ImpossibleMoveError("the field is not ready by that day");
      if (machine.downDays.includes(day)) throw new ImpossibleMoveError("the machine is in the workshop that day");
      const chc = await this.store.getChc(chcId);
      if (chc?.rainDays.includes(day)) throw new ImpossibleMoveError("no sowing that day because of rain");
      const latest = await this.store.latestPlan(chcId);
      const earlierPins = latest?.status === "draft" ? latest.pins.filter((pin) => pin.fieldId !== fieldId) : [];
      return this.generateLocked(chcId, "manual_move", null, [...earlierPins, { fieldId, machineId, day }]);
    });
  }

  /**
   * Publishes exactly the draft the operator was looking at, crash-safely:
   *   1. decide every write (promise records with their versions and timestamps, field updates)
   *      and check each promise change against the state machine; nothing is written yet;
   *   2. draft -> publishing, saving that list (a conditional write: one approval ever starts);
   *   3. apply the list (every write is safe to repeat);
   *   4. publishing -> approved.
   * If the process dies after step 2, the next request for this CHC repeats step 3 and 4
   * (finishPublishingLocked), so a publish always completes and never writes anything twice.
   */
  async approvePlan(chcId: string, version: number, approvedBy: string): Promise<{ plan: PlanRecord; changes: PlanChanges }> {
    return this.withChcWork(chcId, async () => {
      const plan = await this.store.latestPlan(chcId);
      if (!plan) throw new NotFoundError("no plan to approve");
      if (plan.version !== version) throw new ConflictError("the plan changed since you opened it; review the new plan");
      if (plan.status !== "draft") throw new ConflictError("this plan is already published");
      const { changes, publish } = await this.decidePublishWrites(plan);
      let publishing: PlanRecord;
      try {
        publishing = await this.store.beginPublish(chcId, plan.planDate, version, { approvedBy, approvedAt: new Date().toISOString(), changes, publish });
      } catch (error) {
        if (error instanceof StoreConflictError) throw new ConflictError("this plan was already published or replaced");
        throw error;
      }
      return { plan: await this.applyPublish(publishing), changes };
    });
  }

  /** Steps 3 and 4 of approval. Every write is safe to repeat, so this may run more than once. */
  private async applyPublish(plan: PlanRecord): Promise<PlanRecord> {
    if (!plan.publish) throw new Error(`plan ${plan.version} is publishing without its writes`);
    for (const record of plan.publish.promises) await this.store.putPromise(record);
    for (const update of plan.publish.fields) await this.store.setFieldPlan(plan.chcId, update);
    return this.store.completePublish(plan.chcId, plan.planDate, plan.version);
  }

  /** Finishes a publish that a crash interrupted. Callers hold the CHC lock. */
  private async finishPublishingLocked(chcId: string): Promise<void> {
    const latest = await this.store.latestPlan(chcId);
    if (latest?.status === "publishing") await this.applyPublish(latest);
  }

  /** For reads: make sure no half-finished publish is showing before answering. */
  finishPendingPublish(chcId: string): Promise<void> {
    return this.withChcLock(chcId, () => this.finishPublishingLocked(chcId));
  }

  /** Every change to a CHC runs under its lock, after finishing any interrupted publish. */
  private withChcWork<Result>(chcId: string, work: () => Promise<Result>): Promise<Result> {
    return this.withChcLock(chcId, async () => {
      await this.finishPublishingLocked(chcId);
      return work();
    });
  }

  /**
   * Step 1 of approval: the promise changes of a plan, recomputed against the promises held now
   * (a field may have been sown since the draft was made), turned into the exact records to write.
   * Every change passes the state machine here, before anything is written, so a refused change
   * leaves the store untouched. New records come before the old ones are marked replaced or
   * broken, so a reader in the middle of a publish sees the old date or the new one, never none.
   */
  private async decidePublishWrites(plan: PlanRecord): Promise<{ changes: PlanChanges; publish: PublishWrites }> {
    const chcId = plan.chcId;
    const now = new Date().toISOString();
    const fields = (await this.store.listFields(chcId)).filter((field) => field.state !== "done");
    const historyByField = groupPromises(await this.store.listPromises(chcId));
    const heldByField = new Map(fields.map((field) => [field.id, currentPromise(historyByField.get(field.id) ?? [])]));
    const changes = planChanges(fields, heldByField, plan.solve);
    const nextVersion = (fieldId: string) => (historyByField.get(fieldId)?.at(-1)?.version ?? 0) + 1;
    const causeReason = PROMISE_REASON_BY_CAUSE[plan.cause];
    const promises: PromiseRecord[] = [];

    for (const item of changes.promised) {
      const history = historyByField.get(item.fieldId) ?? [];
      const status = promiseStatus(history);
      // A field whose earlier promise broke without a new date is re-promised; otherwise it is new.
      nextStatus(status, status === "broken" ? "re_promise" : "publish", item.promise);
      promises.push({
        chcId,
        fieldId: item.fieldId,
        version: nextVersion(item.fieldId),
        promise: item.promise,
        state: "held",
        at: now,
        reason: history.length === 0 ? "first_promise" : causeReason,
      });
    }
    for (const item of changes.firmed) {
      const held = heldByField.get(item.fieldId)!;
      nextStatus(promiseStatus(historyByField.get(item.fieldId) ?? []), "narrow");
      promises.push({ chcId, fieldId: item.fieldId, version: held.version + 1, promise: { kind: "firm", day: item.day }, state: "held", at: now, reason: "narrowed" });
      promises.push({ ...held, state: "replaced", at: now });
    }
    for (const item of changes.broken) {
      const held = heldByField.get(item.fieldId)!;
      nextStatus(promiseStatus(historyByField.get(item.fieldId) ?? []), "break");
      if (item.next) {
        nextStatus("broken", "re_promise", item.next);
        promises.push({ chcId, fieldId: item.fieldId, version: held.version + 1, promise: item.next, state: "held", at: now, reason: causeReason });
      }
      promises.push({ ...held, state: "broken", at: now });
    }
    for (const item of changes.rePromised) {
      const held = heldByField.get(item.fieldId)!;
      nextStatus(promiseStatus(historyByField.get(item.fieldId) ?? []), "sooner", item.next);
      promises.push({ chcId, fieldId: item.fieldId, version: held.version + 1, promise: item.next, state: "held", at: now, reason: "replan" });
      promises.push({ ...held, state: "replaced", at: now });
    }

    // Fields the plan covers move to their planned day and machine; their "sooner" request is answered.
    const lastMachineByField = new Map<string, string>();
    for (const assignment of plan.solve.assignments) {
      if (assignment.part === assignment.parts) lastMachineByField.set(assignment.fieldId, assignment.machineId);
    }
    const unserved = new Set(plan.solve.unservedFieldIds);
    const promisedNow = new Set([
      ...changes.promised.map((item) => item.fieldId),
      ...changes.broken.filter((item) => item.next).map((item) => item.fieldId),
    ]);
    const lostPromise = new Set(changes.broken.filter((item) => !item.next).map((item) => item.fieldId));
    const fieldUpdates: FieldPlanUpdate[] = fields
      .filter((field) => field.id in plan.solve.fieldDays || unserved.has(field.id))
      .map((field) => ({
        fieldId: field.id,
        plannedDay: plan.solve.fieldDays[field.id] ?? null,
        plannedMachineId: lastMachineByField.get(field.id) ?? null,
        state: promisedNow.has(field.id) || (heldByField.get(field.id) !== null && !lostPromise.has(field.id)) ? "promised" : "waiting",
      }));
    return { changes, publish: { promises, fields: fieldUpdates } };
  }

  /** The demo season starts as if the operator published a plan last evening. */
  async publishInitialPlan(chcId: string, approvedBy: string): Promise<void> {
    const draft = await this.generatePlan(chcId);
    await this.approvePlan(chcId, draft.version, approvedBy);
  }

  /** A booking is stored at once as a request; it gets a date when the operator publishes a plan. */
  async requestField(chcId: string, farmer: { farmerId: string; farmerName: string; bookedBy: string | null }, input: BookingInput): Promise<FieldRecord> {
    return this.withChcWork(chcId, async () => {
      const { chc, fields } = await this.loadChc(chcId);
      if (!chc.villageIds.includes(input.villageId)) throw new NotFoundError("village is not served by this CHC");
      const field: FieldRecord = {
        chcId,
        id: `f-${randomUUID().slice(0, 8)}`,
        token: fields.reduce((highest, item) => Math.max(highest, item.token), 0) + 1,
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
        villageId: input.villageId,
        acres: input.acres,
        readyDay: this.isoToDay(input.readyDate),
        waitingLimitDays: input.waitingLimitDays,
        requestOrder: fields.reduce((highest, item) => Math.max(highest, item.requestOrder), -1) + 1,
        createdAt: new Date().toISOString(),
        state: "waiting",
        plannedDay: null,
        plannedMachineId: null,
        bookedBy: farmer.bookedBy,
        soonerRequestedAt: null,
      };
      await this.store.putField(field);
      return field;
    });
  }

  /**
   * "I cannot wait longer": the farmer's last waiting day moves earlier and a new draft is made in
   * which their promise is released, so the engine can look for an earlier day. The farmer keeps
   * the current promise until the operator publishes; publishing gives them the new date only if
   * it is no later. Only shortening is allowed from a slot link; a longer wait would quietly lower
   * the field's priority without anyone deciding that.
   */
  async shortenWaitingLimit(chcId: string, fieldId: string, waitingLimitDays: number): Promise<FieldRecord> {
    return this.withChcWork(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      if (field.state === "done") throw new ConflictError("this field has already been sown");
      if (waitingLimitDays >= field.waitingLimitDays) throw new ConflictError("the new waiting limit must be shorter than the current one");
      const updated: FieldRecord = { ...field, waitingLimitDays, soonerRequestedAt: new Date().toISOString() };
      await this.store.putField(updated);
      await this.generateLocked(chcId, "farmer_update", null, []);
      return updated;
    });
  }

  async setMachineDown(chcId: string, machineId: string, downDayCount: number): Promise<PlanRecord> {
    return this.withChcWork(chcId, async () => {
      const machine = (await this.store.listMachines(chcId)).find((item) => item.id === machineId);
      if (!machine) throw new NotFoundError(`machine ${machineId} not found`);
      const tomorrow = this.today() + 1;
      const downDays = new Set(machine.downDays);
      for (let offset = 0; offset < downDayCount; offset += 1) downDays.add(tomorrow + offset);
      await this.store.putMachine({ ...machine, downDays: [...downDays].sort((left, right) => left - right) });
      // Manual moves were for the old situation; the new draft starts clean.
      return this.generateLocked(chcId, "breakdown", machineId, []);
    });
  }

  async setMachineBack(chcId: string, machineId: string): Promise<PlanRecord> {
    return this.withChcWork(chcId, async () => {
      const machine = (await this.store.listMachines(chcId)).find((item) => item.id === machineId);
      if (!machine) throw new NotFoundError(`machine ${machineId} not found`);
      const today = this.today();
      await this.store.putMachine({ ...machine, downDays: machine.downDays.filter((day) => day <= today) });
      return this.generateLocked(chcId, "machine_back", machineId, []);
    });
  }

  /**
   * The machine has sown a field (on the demo clock's today). Sown by the promised day keeps the
   * promise; later breaks it. A field without a promise cannot be marked sown here.
   */
  async markSown(chcId: string, fieldId: string): Promise<FieldRecord> {
    return this.withChcWork(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      const history = await this.store.promiseHistory(chcId, fieldId);
      const held = currentPromise(history);
      const sownDay = this.today();
      const onTime = held?.promise ? sownDay <= lastDay(held.promise) : false;
      const status = nextStatus(promiseStatus(history), onTime ? "sow_on_time" : "sow_late");
      if (held) await this.store.putPromise({ ...held, state: status === "kept" ? "kept" : "broken", at: new Date().toISOString() });
      const sown: FieldRecord = { ...field, state: "done", plannedDay: sownDay, soonerRequestedAt: null };
      await this.store.putField(sown);
      return sown;
    });
  }

  latestPlan(chcId: string): Promise<PlanRecord | null> {
    return this.store.latestPlan(chcId);
  }

  publishedPlan(chcId: string): Promise<PlanRecord | null> {
    return this.store.latestApprovedPlan(chcId);
  }
}

/** True when the promise is met by the planned day (on or before a firm day, inside a window). */
export function onTrack(promise: FieldPromise, plannedDay: number | null): boolean {
  if (plannedDay === null) return false;
  return promise.kind === "firm" ? plannedDay <= promise.day : plannedDay >= promise.startDay && plannedDay <= promise.endDay;
}
