/**
 * The planner turns stored records into an engine request, and a plan into promises people see.
 * It exists so that every path that changes a farmer's date goes through one place with one rule:
 *
 *   Every engine run makes a DRAFT plan. Only the operator's approval publishes it, and publishing
 *   is the only thing that writes promises.
 *
 * - A booking is a request: it is stored at once (no engine run) and waits for the next plan.
 * - Generate, move a field, a breakdown, a machine back, or a farmer's "I cannot wait longer" each
 *   make a new draft, with the list of what approving it would change (domain/promises.ts). A
 *   farmer's update keeps the operator's manual moves in the draft; it never starts it over.
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
import { EngineError, type EngineClient } from "../engine/client";
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
import { machineOff, offDays } from "./machines";

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
  machine_added: "replan",
  day_closed: "replan",
  rain_day: "rain",
  machine_removed: "replan",
  loan_in: "replan",
  loan_out: "replan",
  loan_ended: "replan",
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

  // Days the season has moved past DATE_TODAY (the operator closes a day, then starts the next).
  // Cached so today() stays synchronous; refreshClock reads the store before each request.
  private dayOffset = 0;

  /** Today is DATE_TODAY (simulated, labelled so in the UI) plus the days the season has moved on. */
  today(): number {
    return dateToDay(this.config.SEASON_START_DATE, this.config.DATE_TODAY) + this.dayOffset;
  }

  async refreshClock(): Promise<void> {
    this.dayOffset = await this.store.getSeasonDayOffset();
  }

  /** Moves the site's today one day on, for everyone (never past the season's end). */
  async advanceDay(): Promise<number> {
    await this.refreshClock();
    const lastDay = dateToDay(this.config.SEASON_START_DATE, this.config.SEASON_END_DATE);
    if (this.today() >= lastDay) throw new ConflictError("the season has ended");
    this.dayOffset += 1;
    await this.store.setSeasonDayOffset(this.dayOffset);
    return this.today();
  }

  /** Back to DATE_TODAY (a demo reset). */
  async resetClock(): Promise<void> {
    this.dayOffset = 0;
    await this.store.setSeasonDayOffset(0);
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
          // In the workshop, lent away, or (borrowed) outside the loan: the engine sees one list.
          downDays: offDays(machine, this.today(), this.today() + HORIZON_DAYS),
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
      if (machineOff(machine, day)) throw new ImpossibleMoveError("the machine is not at this centre that day (on loan)");
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

  /**
   * A booking is stored at once as a request; it gets a date when the operator publishes a plan.
   * The farmer's phone (E.164) and the consent the facilitator recorded are stored on the field.
   */
  async requestField(
    chcId: string,
    farmer: { farmerId: string; farmerName: string; bookedBy: string | null; farmerPhone: string | null; consentAt: string | null; consentBy: string | null },
    input: Pick<BookingInput, "villageId" | "acres" | "readyDate" | "waitingLimitDays">,
  ): Promise<FieldRecord> {
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
        farmerPhone: farmer.farmerPhone,
        consentAt: farmer.consentAt,
        consentBy: farmer.consentBy,
        linkVersion: 1,
        soonerRequestedAt: null,
      };
      await this.store.putField(field);
      return field;
    });
  }

  /** A helper reissues a field's slot link: the version goes up and every older link stops working (401). */
  async reissueLink(chcId: string, fieldId: string): Promise<FieldRecord> {
    const field = await this.store.bumpLinkVersion(chcId, fieldId);
    if (!field) throw new NotFoundError("field not found");
    return field;
  }

  /**
   * "I cannot wait longer": the farmer's last waiting day moves earlier and the field is marked for
   * the operator's attention (soonerRequestedAt; the board and plan list it until a plan covering it
   * is published). The current draft is re-planned with the operator's manual moves kept as they
   * are, the farmer's promise released so the engine can look for an earlier day; if those moves
   * can no longer all hold, the operator's draft is left untouched and only the mark is added. The
   * farmer keeps the current promise until the operator publishes; publishing gives them the new
   * date only if it is no later. Only shortening is allowed from a slot link; a longer wait would
   * quietly lower the field's priority without anyone deciding that.
   */
  async shortenWaitingLimit(chcId: string, fieldId: string, waitingLimitDays: number): Promise<FieldRecord> {
    return this.withChcWork(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      if (field.state === "done") throw new ConflictError("this field has already been sown");
      if (waitingLimitDays >= field.waitingLimitDays) throw new ConflictError("the new waiting limit must be shorter than the current one");
      const updated: FieldRecord = { ...field, waitingLimitDays, soonerRequestedAt: new Date().toISOString() };
      await this.store.putField(updated);
      const latest = await this.store.latestPlan(chcId);
      const operatorMoves = latest?.status === "draft" ? latest.pins : [];
      try {
        await this.generateLocked(chcId, "farmer_update", null, operatorMoves);
      } catch (error) {
        if (!(error instanceof EngineError && error.code === "IMPOSSIBLE_PIN")) throw error;
      }
      return updated;
    });
  }

  /**
   * The farmer's harvest moved (the combine came early or late). The old promise was for a field
   * that was not ready then, so it ends as "replaced" (the farmer changed it; the centre did not
   * break it), and the field waits for a date from the next plan; a draft is made at once.
   */
  async changeHarvest(chcId: string, fieldId: string, readyDay: number): Promise<FieldRecord> {
    return this.withChcWork(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      if (field.state === "done") throw new ConflictError("this field has already been sown");
      const lastSeasonDay = dateToDay(this.config.SEASON_START_DATE, this.config.SEASON_END_DATE);
      if (readyDay < this.today() - 14 || readyDay > lastSeasonDay) throw new ConflictError("the harvest day must be in this season");
      if (readyDay === field.readyDay) return field;
      await this.releasePromiseLocked(field);
      const updated: FieldRecord = { ...field, readyDay, state: "waiting", plannedDay: null, plannedMachineId: null, soonerRequestedAt: null };
      await this.store.putField(updated);
      await this.generateLocked(chcId, "farmer_update", null, []);
      return updated;
    });
  }

  /** The farmer no longer needs the machine: the booking goes, its promise ends, and the next plan has the room. */
  async cancelBooking(chcId: string, fieldId: string): Promise<void> {
    return this.withChcWork(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      if (field.state === "done") throw new ConflictError("this field has already been sown");
      await this.releasePromiseLocked(field);
      await this.store.deleteField(chcId, fieldId);
      await this.generateLocked(chcId, "farmer_update", null, []);
    });
  }

  private async releasePromiseLocked(field: FieldRecord): Promise<void> {
    const held = currentPromise(await this.store.promiseHistory(field.chcId, field.id));
    if (held) await this.store.putPromise({ ...held, state: "replaced", at: new Date().toISOString() });
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
   * The operator expects rain on a day of the plan (or the forecast cleared): no field is sown on
   * a rain day. Promises stay hard; if rain makes one impossible, the draft says which would break.
   */
  async setRainDay(chcId: string, day: number, rain: boolean): Promise<PlanRecord> {
    return this.withChcWork(chcId, async () => {
      if (!this.planDays().includes(day)) throw new ConflictError("rain can be marked only on the plan's days");
      const chc = await this.store.getChc(chcId);
      if (!chc) throw new NotFoundError(`CHC ${chcId} not found`);
      const rainDays = new Set(chc.rainDays);
      if (rain) rainDays.add(day);
      else rainDays.delete(day);
      await this.store.putChc({ ...chc, rainDays: [...rainDays].sort((left, right) => left - right) });
      return this.generateLocked(chcId, "rain_day", null, []);
    });
  }

  /**
   * The operator adds a machine to the centre (bought or rented in). It works from tomorrow; the
   * new draft gives it fields, and nothing a farmer sees changes until the operator approves.
   */
  async addMachine(chcId: string, input: { name: string; kind: MachineRecord["kind"] }): Promise<{ machine: MachineRecord; plan: PlanRecord }> {
    return this.withChcWork(chcId, async () => {
      const machine: MachineRecord = { chcId, id: `m-${randomUUID().slice(0, 8)}`, name: input.name, kind: input.kind, hoursPerDay: 8, downDays: [] };
      await this.store.putMachine(machine);
      return { machine, plan: await this.generateLocked(chcId, "machine_added", machine.id, []) };
    });
  }

  /**
   * The operator takes one of the centre's own machines out (sold, or a rental returned). A machine
   * on loan cannot be removed here (the officer ends the loan), and a centre keeps at least one.
   * Promises stay hard: if the rest cannot keep them, the draft says which would break.
   */
  async removeMachine(chcId: string, machineId: string): Promise<PlanRecord> {
    return this.withChcWork(chcId, async () => {
      const machines = await this.store.listMachines(chcId);
      const machine = machines.find((item) => item.id === machineId);
      if (!machine) throw new NotFoundError(`machine ${machineId} not found`);
      if (machine.loan) throw new ConflictError("this machine is on loan; the district officer ends the loan");
      if (machines.filter((item) => !item.loan).length <= 1) throw new ConflictError("a centre keeps at least one machine of its own");
      await this.store.deleteMachine(chcId, machineId);
      return this.generateLocked(chcId, "machine_removed", null, []);
    });
  }

  /**
   * The district officer lends one machine from a centre to another, from tomorrow for the days
   * they chose (at most the plan's ten). The lender's machine is the one that works on every one of those days and
   * has the fewest fields planned in them. Both centres get a new draft at once; promises stay hard
   * at both, and each operator approves their own draft.
   */
  async arrangeLoan(fromChcId: string, toChcId: string, arrangedBy: string, days: number = HORIZON_DAYS): Promise<{ loanId: string; lenderPlan: PlanRecord; borrowerPlan: PlanRecord }> {
    if (fromChcId === toChcId) throw new ConflictError("a centre cannot lend to itself");
    // From tomorrow (the machine travels today) for the days the officer chose, within the plan.
    const [startDay, endDay] = [this.today() + 1, this.today() + Math.min(HORIZON_DAYS, Math.max(1, days))];
    const arrangedAt = new Date().toISOString();
    let loanId = "";
    let lent: MachineRecord | null = null;
    const lenderPlan = await this.withChcWork(fromChcId, async () => {
      const [machines, fields] = await Promise.all([this.store.listMachines(fromChcId), this.store.listFields(fromChcId)]);
      const plannedInLoan = (machine: MachineRecord) =>
        fields.filter((field) => field.plannedMachineId === machine.id && field.plannedDay !== null && field.plannedDay >= startDay && field.plannedDay <= endDay).length;
      const free = machines
        .filter((machine) => !machine.loan && !machine.downDays.some((day) => day >= startDay && day <= endDay))
        .sort((left, right) => plannedInLoan(left) - plannedInLoan(right) || left.id.localeCompare(right.id));
      if (machines.filter((machine) => !machine.loan).length <= 1 || free.length === 0) throw new ConflictError("this centre has no machine it can lend for those days");
      lent = free[0]!;
      loanId = `${fromChcId}~${lent.id}`;
      await this.store.putMachine({ ...lent, loan: { loanId, direction: "out", otherChcId: toChcId, lenderMachineId: lent.id, startDay, endDay, arrangedBy, arrangedAt } });
      return this.generateLocked(fromChcId, "loan_out", lent.id, []);
    });
    const borrowerPlan = await this.withChcWork(toChcId, async () => {
      const borrowed: MachineRecord = {
        chcId: toChcId,
        id: borrowedMachineId(fromChcId, lent!.id),
        name: lent!.name,
        kind: lent!.kind,
        hoursPerDay: lent!.hoursPerDay,
        downDays: [],
        loan: { loanId, direction: "in", otherChcId: fromChcId, lenderMachineId: lent!.id, startDay, endDay, arrangedBy, arrangedAt },
      };
      await this.store.putMachine(borrowed);
      return this.generateLocked(toChcId, "loan_in", borrowed.id, []);
    });
    return { loanId, lenderPlan, borrowerPlan };
  }

  /** The district officer ends a loan: the machine goes home, and both centres get a new draft. */
  async endLoan(loanId: string): Promise<{ fromChcId: string; toChcId: string; lenderPlan: PlanRecord; borrowerPlan: PlanRecord }> {
    const [fromChcId, machineId] = loanId.split("~");
    if (!fromChcId || !machineId) throw new NotFoundError("loan not found");
    const lender = (await this.store.listMachines(fromChcId)).find((machine) => machine.id === machineId);
    if (!lender?.loan || lender.loan.direction !== "out") throw new NotFoundError("loan not found");
    const toChcId = lender.loan.otherChcId;
    const lenderPlan = await this.withChcWork(fromChcId, async () => {
      const { loan: _ended, ...home } = lender;
      await this.store.putMachine(home);
      return this.generateLocked(fromChcId, "loan_ended", machineId, []);
    });
    const borrowerPlan = await this.withChcWork(toChcId, async () => {
      await this.store.deleteMachine(toChcId, borrowedMachineId(fromChcId, machineId));
      return this.generateLocked(toChcId, "loan_ended", null, []);
    });
    return { fromChcId, toChcId, lenderPlan, borrowerPlan };
  }

  /**
   * The machine has sown a field (on the demo clock's today). Sown by the promised day keeps the
   * promise; later breaks it. A field without a promise cannot be marked sown here.
   */
  async markSown(chcId: string, fieldId: string): Promise<FieldRecord> {
    return this.withChcWork(chcId, async () => {
      const field = await this.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      return this.sowLocked(field, this.today());
    });
  }

  /** A field sown on a day: its promise is kept (by the promised day) or broken (later). Callers hold the lock. */
  private async sowLocked(field: FieldRecord, sownDay: number): Promise<FieldRecord> {
    const history = await this.store.promiseHistory(field.chcId, field.id);
    const held = currentPromise(history);
    const onTime = held?.promise ? sownDay <= lastDay(held.promise) : false;
    const status = nextStatus(promiseStatus(history), onTime ? "sow_on_time" : "sow_late");
    if (held) await this.store.putPromise({ ...held, state: status === "kept" ? "kept" : "broken", at: new Date().toISOString() });
    const sown: FieldRecord = { ...field, state: "done", plannedDay: sownDay, soonerRequestedAt: null };
    await this.store.putField(sown);
    return sown;
  }

  /**
   * Today's work at a centre: the fields the approved plan put on today, each with its machine and
   * planned hours (from the route), and whether today has been recorded yet.
   */
  async todaysWork(chcId: string): Promise<{ closed: boolean; stops: { field: FieldRecord; machineId: string; minutes: number }[] }> {
    const today = this.today();
    const [chc, fields, published] = await Promise.all([this.store.getChc(chcId), this.store.listFields(chcId), this.publishedPlan(chcId)]);
    const byId = new Map(fields.map((field) => [field.id, field]));
    const stops: { field: FieldRecord; machineId: string; minutes: number }[] = [];
    for (const route of published?.solve.routes ?? []) {
      if (route.day !== today) continue;
      for (const stop of route.stops) {
        const field = byId.get(stop.fieldId);
        // Sown already (recorded), moved off today by a later plan, or a "stretch" stop: not today's work.
        if (!field || stop.stretch || field.state === "done" || field.plannedDay !== today) continue;
        const existing = stops.find((item) => item.field.id === field.id && item.machineId === route.machineId);
        if (existing) existing.minutes += stop.endMinute - stop.startMinute;
        else stops.push({ field, machineId: route.machineId, minutes: stop.endMinute - stop.startMinute });
      }
    }
    return { closed: (chc?.closedDay ?? -1) >= today, stops };
  }

  /**
   * The operator records the day: each of today's fields sown or not. A sown field's promise is
   * kept or broken, and a work log (its acres, the planned hours) teaches the machine's speed. A
   * field not sown stays for the next plan. Then a draft for tomorrow, to check and approve.
   */
  async recordDay(chcId: string, outcomes: { fieldId: string; sown: boolean }[]): Promise<PlanRecord> {
    return this.withChcWork(chcId, async () => {
      const today = this.today();
      const work = await this.todaysWork(chcId);
      const sownIds = new Set(outcomes.filter((outcome) => outcome.sown).map((outcome) => outcome.fieldId));
      const date = this.dayToIso(today);
      const loggedAt = new Date().toISOString();
      const sown = new Set<string>();
      for (const stop of work.stops) {
        if (!sownIds.has(stop.field.id)) continue;
        await this.store.putWorkLog({ chcId, date, machineId: stop.machineId, fieldId: stop.field.id, acres: stop.field.acres * (stop.minutes / Math.max(1, work.stops.filter((item) => item.field.id === stop.field.id).reduce((sum, item) => sum + item.minutes, 0))), hours: stop.minutes / 60, loggedAt });
        if (!sown.has(stop.field.id)) {
          await this.sowLocked(stop.field, today);
          sown.add(stop.field.id);
        }
      }
      const chc = await this.store.getChc(chcId);
      if (chc) await this.store.putChc({ ...chc, closedDay: today });
      return this.generateLocked(chcId, "day_closed", null, []);
    });
  }

  latestPlan(chcId: string): Promise<PlanRecord | null> {
    return this.store.latestPlan(chcId);
  }

  publishedPlan(chcId: string): Promise<PlanRecord | null> {
    return this.store.latestApprovedPlan(chcId);
  }
}

/** The borrowing centre's id for a lent machine: one per lending centre and machine. */
export function borrowedMachineId(fromChcId: string, machineId: string): string {
  return `loan-${fromChcId}-${machineId}`;
}

/** True when the promise is met by the planned day (on or before a firm day, inside a window). */
export function onTrack(promise: FieldPromise, plannedDay: number | null): boolean {
  if (plannedDay === null) return false;
  return promise.kind === "firm" ? plannedDay <= promise.day : plannedDay >= promise.startDay && plannedDay <= promise.endDay;
}
