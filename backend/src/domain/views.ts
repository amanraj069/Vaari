/**
 * Builds what each page shows from stored records and plans. Pages get answers, not raw data: the
 * farmer's date, where their turn stands and why in one sentence; the operator's published lanes,
 * the draft waiting for approval and exactly what approving it would change. Risk is computed here
 * in one place so the board, the plan, the queue and the farmer page agree.
 */
import {
  learnRate,
  minuteToClock,
  type AttentionItem,
  type FarmerField,
  type FarmerHome,
  type FieldPromise,
  type Lane,
  type Locale,
  type MachineView,
  type OperatorBoard,
  type OperatorPlan,
  type PlanChangesView,
  type PlanSummary,
  type PromiseView,
  type QueueItem,
  type Risk,
  type SlotReasonCode,
  type SolveResponse,
} from "../shared";
import { slotReasonText } from "../explain/slot-reasons";
import type { ChcRecord, FieldRecord, MachineRecord, PlanChanges, PlanRecord, PromiseRecord, VaariStore, VillageRecord } from "../store/types";
import { countChanges, currentPromise, promiseStatus } from "./promises";
import { groupPromises, logsByMachine, onTrack, type Planner } from "./planner";

const HORIZON_DAYS = 10;

export function promiseView(planner: Planner, promise: FieldPromise | null): PromiseView | null {
  if (!promise) return null;
  return promise.kind === "firm"
    ? { kind: "firm", date: planner.dayToIso(promise.day) }
    : { kind: "window", startDate: planner.dayToIso(promise.startDay), endDate: planner.dayToIso(promise.endDay) };
}

/** Risk of a field on the day a plan gives it: after its last waiting day, or within a day of it. */
export function riskOnDay(field: FieldRecord, day: number): { risk: Risk; slackDays: number } {
  const slackDays = field.readyDay + field.waitingLimitDays - day;
  return { risk: slackDays < 0 ? "at_risk" : slackDays <= 1 ? "tight" : "safe", slackDays };
}

/** Risk of a field in the published plan (unplanned fields whose last day falls inside the horizon are at risk). */
export function riskOf(field: FieldRecord, today: number): { risk: Risk; slackDays: number | null } {
  if (field.plannedDay !== null) return riskOnDay(field, field.plannedDay);
  const burnDeadline = field.readyDay + field.waitingLimitDays;
  return { risk: burnDeadline < today + 1 + HORIZON_DAYS ? "at_risk" : "unplanned", slackDays: burnDeadline - today };
}

function machineView(planner: Planner, machine: MachineRecord, planDay: number, logs: { acres: number; hours: number }[]): MachineView {
  const rate = learnRate(logs);
  return {
    id: machine.id,
    name: machine.name,
    kind: machine.kind,
    status: machine.downDays.includes(planDay) ? "down" : "working",
    downDates: machine.downDays.filter((day) => day >= planDay).map((day) => planner.dayToIso(day)),
    promiseAcresPerDay: Math.round(rate.promiseAcresPerHour * machine.hoursPerDay * 10) / 10,
    planAcresPerDay: Math.round(rate.planAcresPerHour * machine.hoursPerDay * 10) / 10,
    logsCount: rate.observations,
  };
}

function villageNames(planner: Planner): Map<string, VillageRecord> {
  return new Map(planner.villages().map((village) => [village.id, village]));
}

/** Everything the CHC's pages need, loaded once per request. */
async function loadChcState(planner: Planner, store: VaariStore, chcId: string) {
  const [{ chc, machines, fields }, promiseRecords, workLogs] = await Promise.all([
    planner.loadChc(chcId),
    store.listPromises(chcId),
    store.listWorkLogs(chcId),
  ]);
  const historyByField = groupPromises(promiseRecords);
  const heldByField = new Map<string, PromiseRecord | null>(fields.map((field) => [field.id, currentPromise(historyByField.get(field.id) ?? [])]));
  return { chc, machines, fields, promiseRecords, historyByField, heldByField, machineLogs: logsByMachine(workLogs) };
}
type ChcState = Awaited<ReturnType<typeof loadChcState>>;

/** One lane per machine for the plan's first day (tomorrow), stops in route order. */
function lanesFor(planner: Planner, state: ChcState, solve: SolveResponse | null, planDay: number): Lane[] {
  const villages = villageNames(planner);
  const fieldsById = new Map(state.fields.map((field) => [field.id, field]));
  return state.machines.map((machine) => {
    const route = solve?.routes.find((item) => item.machineId === machine.id && item.day === planDay);
    return {
      machine: machineView(planner, machine, planDay, state.machineLogs.get(machine.id) ?? []),
      down: machine.downDays.includes(planDay),
      stops: (route?.stops ?? []).map((stop) => {
        const field = fieldsById.get(stop.fieldId);
        return {
          fieldId: stop.fieldId,
          risk: field ? riskOnDay(field, planDay).risk : "safe",
          token: field?.token ?? 0,
          farmerName: field?.farmerName ?? "",
          villageName: villages.get(stop.villageId)?.name ?? stop.villageId,
          acres: stop.acres,
          part: stop.part,
          parts: stop.parts,
          start: minuteToClock(stop.arriveMinute),
          end: minuteToClock(stop.endMinute),
          travelMinutesBefore: stop.travelMinutesBefore,
          stretch: stop.stretch,
          promise: promiseView(planner, state.heldByField.get(stop.fieldId)?.promise ?? null),
        };
      }),
      endTime: route ? minuteToClock(route.endMinute) : null,
      capacityEndTime: minuteToClock(route?.capacityMinute ?? 8 * 60 + machine.hoursPerDay * 60),
      travelKm: route?.travelKm ?? 0,
    };
  });
}

function planSummary(planner: Planner, plan: PlanRecord, machines: MachineRecord[]): PlanSummary {
  return {
    version: plan.version,
    status: plan.status,
    planDate: plan.planDate,
    createdAt: plan.createdAt,
    approvedAt: plan.approvedAt,
    approvedBy: plan.approvedBy,
    cause: plan.cause,
    causeMachineName: machines.find((machine) => machine.id === plan.causeMachineId)?.name ?? null,
  };
}

function solverView(solve: SolveResponse) {
  return {
    status: solve.solver.status,
    mode: solve.solver.mode,
    wallSeconds: solve.solver.wallSeconds,
    maxDelayVsQueueDays: solve.metrics.maxDelayVsQueueDays,
    fieldsBeyondFairnessK: solve.metrics.fieldsBeyondFairnessK,
    breaksProvenMinimal: solve.solver.breaksProvenMinimal ?? null,
  };
}

function changesView(planner: Planner, changes: PlanChanges, fields: FieldRecord[]): PlanChangesView {
  const villages = villageNames(planner);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const ref = (fieldId: string) => {
    const field = fieldsById.get(fieldId);
    return {
      fieldId,
      token: field?.token ?? 0,
      farmerName: field?.farmerName ?? "",
      villageName: field ? (villages.get(field.villageId)?.name ?? field.villageId) : "",
    };
  };
  const view = (promise: FieldPromise) => promiseView(planner, promise)!;
  return {
    promised: changes.promised.map((item) => ({ ...ref(item.fieldId), promise: view(item.promise) })),
    firmed: changes.firmed.map((item) => ({ ...ref(item.fieldId), date: planner.dayToIso(item.day) })),
    moved: changes.moved.map((item) => ({
      ...ref(item.fieldId),
      fromDate: item.fromDay === null ? null : planner.dayToIso(item.fromDay),
      toDate: item.toDay === null ? null : planner.dayToIso(item.toDay),
    })),
    broken: changes.broken.map((item) => ({ ...ref(item.fieldId), previous: view(item.previous), next: promiseView(planner, item.next) })),
    rePromised: changes.rePromised.map((item) => ({ ...ref(item.fieldId), previous: view(item.previous), next: view(item.next) })),
    unplaced: changes.unplaced.map(ref),
  };
}

/** Requested fields (no promise yet) that the given plan does not cover: booked after it was made. */
function uncoveredRequests(state: ChcState, plan: PlanRecord | null): number {
  return state.fields.filter((field) => {
    if (field.state === "done" || state.heldByField.get(field.id)) return false;
    if (!plan) return true;
    return !(field.id in plan.solve.fieldDays) && !plan.solve.unservedFieldIds.includes(field.id);
  }).length;
}

/** Farmers who said "I cannot wait longer" and wait for the next published plan, earliest request first. */
function attentionItems(planner: Planner, state: ChcState): AttentionItem[] {
  const villages = villageNames(planner);
  return state.fields
    .filter((field) => field.state !== "done" && field.soonerRequestedAt !== null)
    .sort((left, right) => (left.soonerRequestedAt! < right.soonerRequestedAt! ? -1 : 1))
    .map((field) => ({
      fieldId: field.id,
      token: field.token,
      farmerName: field.farmerName,
      villageName: villages.get(field.villageId)?.name ?? field.villageId,
      burnDeadlineDate: planner.dayToIso(field.readyDay + field.waitingLimitDays),
      requestedAt: field.soonerRequestedAt!,
      promise: promiseView(planner, state.heldByField.get(field.id)?.promise ?? null),
    }));
}

export async function buildQueue(planner: Planner, store: VaariStore, chcId: string): Promise<QueueItem[]> {
  await planner.finishPendingPublish(chcId);
  const state = await loadChcState(planner, store, chcId);
  return queueItems(planner, state.fields.filter((field) => field.state !== "done"), state.heldByField);
}

function queueItems(planner: Planner, fields: FieldRecord[], heldByField: Map<string, PromiseRecord | null>): QueueItem[] {
  const villages = villageNames(planner);
  const today = planner.today();
  const items = fields.map((field) => {
    const { risk, slackDays } = riskOf(field, today);
    return {
      fieldId: field.id,
      token: field.token,
      farmerName: field.farmerName,
      villageName: villages.get(field.villageId)?.name ?? field.villageId,
      acres: field.acres,
      readyDate: planner.dayToIso(field.readyDay),
      burnDeadlineDate: planner.dayToIso(field.readyDay + field.waitingLimitDays),
      plannedDate: field.plannedDay === null ? null : planner.dayToIso(field.plannedDay),
      promise: promiseView(planner, heldByField.get(field.id)?.promise ?? null),
      slackDays,
      risk,
    };
  });
  // Least slack first: the fuse that burns down soonest is at the top.
  items.sort((left, right) => (left.slackDays ?? 99) - (right.slackDays ?? 99) || left.token - right.token);
  return items;
}

/** /operator: what the machines follow (the published plan), and what is waiting for a decision. */
export async function buildBoard(planner: Planner, store: VaariStore, chcId: string): Promise<OperatorBoard> {
  await planner.finishPendingPublish(chcId);
  const state = await loadChcState(planner, store, chcId);
  const [published, latest] = await Promise.all([planner.publishedPlan(chcId), planner.latestPlan(chcId)]);
  const draft = latest && latest.status === "draft" ? latest : null;
  const planDay = published?.planDay ?? planner.today() + 1;
  const lanes = lanesFor(planner, state, published?.solve ?? null, planDay);
  const active = state.fields.filter((field) => field.state !== "done");
  const queue = queueItems(planner, active, state.heldByField);
  const promised = active.filter((field) => state.heldByField.get(field.id)?.promise);
  // A promise planned on a machine that is now in the workshop that day is not on track, even
  // before the re-plan is approved.
  const downOnPlannedDay = (field: FieldRecord) =>
    field.plannedDay !== null && Boolean(state.machines.find((machine) => machine.id === field.plannedMachineId)?.downDays.includes(field.plannedDay));
  return {
    chc: { id: state.chc.id, name: state.chc.name },
    today: planner.dayToIso(planner.today()),
    planDate: published ? published.planDate : null,
    published: published ? planSummary(planner, published, state.machines) : null,
    draft: draft
      ? { ...planSummary(planner, draft, state.machines), changeCount: countChanges(draft.changes), brokenCount: draft.changes.broken.length }
      : null,
    newRequests: uncoveredRequests(state, latest),
    attention: attentionItems(planner, state),
    counts: {
      machinesWorking: lanes.filter((lane) => !lane.down).length,
      machinesTotal: lanes.length,
      promisesOpen: promised.length,
      promisesOnTrack: promised.filter((field) => onTrack(state.heldByField.get(field.id)!.promise!, field.plannedDay) && !downOnPlannedDay(field)).length,
      burnRisk: queue.filter((item) => item.risk === "at_risk").length,
      requested: active.length - promised.length,
      brokenThisSeason: state.promiseRecords.filter((record) => record.state === "broken").length,
    },
    lanes,
    atRisk: queue.filter((item) => item.risk === "at_risk" || item.risk === "tight"),
    solver: published ? solverView(published.solve) : null,
  };
}

/** /operator/plan: the newest plan (a draft to review, or the published one), and how to change it. */
export async function buildPlanView(planner: Planner, store: VaariStore, chcId: string): Promise<OperatorPlan> {
  await planner.finishPendingPublish(chcId);
  const state = await loadChcState(planner, store, chcId);
  const plan = await planner.latestPlan(chcId);
  const planDays = planner.planDays();
  const fieldsById = new Map(state.fields.map((field) => [field.id, field]));
  const machineName = new Map(state.machines.map((machine) => [machine.id, machine.name]));
  return {
    chc: { id: state.chc.id, name: state.chc.name },
    today: planner.dayToIso(planner.today()),
    plan: plan ? planSummary(planner, plan, state.machines) : null,
    changes: plan ? changesView(planner, plan.changes, state.fields) : null,
    pins: (plan?.pins ?? []).map((pin) => ({
      fieldId: pin.fieldId,
      token: fieldsById.get(pin.fieldId)?.token ?? 0,
      farmerName: fieldsById.get(pin.fieldId)?.farmerName ?? "",
      machineName: machineName.get(pin.machineId) ?? pin.machineId,
      date: planner.dayToIso(pin.day),
    })),
    lanes: lanesFor(planner, state, plan?.solve ?? null, plan?.planDay ?? planDays[0]!),
    newRequests: uncoveredRequests(state, plan),
    attention: attentionItems(planner, state),
    moveOptions: {
      machines: state.machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        downDates: machine.downDays.filter((day) => planDays.includes(day)).map((day) => planner.dayToIso(day)),
      })),
      dates: planDays.map((day) => planner.dayToIso(day)),
      rainDates: state.chc.rainDays.filter((day) => planDays.includes(day)).map((day) => planner.dayToIso(day)),
    },
    solver: plan ? solverView(plan.solve) : null,
  };
}

/**
 * The farmer's notice is read from the promise history (no separate notifications table):
 * the latest record narrowed a window -> "firmed"; a held promise that replaced a broken one ->
 * "broken" (the date moved, with the reason in the history).
 */
export function noticeFromHistory(history: PromiseRecord[]): FarmerField["notice"] {
  const latest = history.at(-1);
  if (!latest) return null;
  if (latest.state === "held" && latest.reason === "narrowed") return { kind: "firmed", at: latest.at };
  const previous = history.at(-2);
  if (latest.state === "held" && previous?.state === "broken") return { kind: "broken", at: latest.at };
  if (latest.state === "broken") return { kind: "broken", at: latest.at };
  return null;
}

/** What a farmer-facing view of one CHC needs, loaded once for any number of fields. */
export type FarmerFieldContext = {
  chc: ChcRecord;
  allFields: FieldRecord[];
  machines: MachineRecord[];
  published: PlanRecord | null;
  locale: Locale;
};

export async function farmerFieldContext(planner: Planner, store: VaariStore, chcId: string, locale: Locale): Promise<FarmerFieldContext> {
  // A farmer never reads a half-published plan: finish an interrupted publish first.
  await planner.finishPendingPublish(chcId);
  const [{ chc, machines, fields }, published] = await Promise.all([planner.loadChc(chcId), planner.publishedPlan(chcId)]);
  return { chc, allFields: fields, machines, published, locale };
}

export function buildFarmerField(planner: Planner, context: FarmerFieldContext, field: FieldRecord, history: PromiseRecord[]): FarmerField {
  const villages = villageNames(planner);
  const villageName = villages.get(field.villageId)?.name ?? field.villageId;
  const held = currentPromise(history);
  const status = promiseStatus(history);
  const promise = held?.promise ?? null;
  const promised = status === "window" || status === "firm";
  const fieldsAhead =
    field.plannedDay === null || !promised
      ? null
      : context.allFields.filter((other) => other.state !== "done" && other.plannedDay !== null && other.plannedDay < field.plannedDay!).length;

  // For a firm date: which machine comes, and which stop of its day this field is (route order,
  // leaving out stretch stops, which are only "if time allows").
  let visit: FarmerField["visit"] = null;
  if (status === "firm" && field.plannedDay !== null && context.published) {
    const route = context.published.solve.routes.find(
      (item) => item.day === field.plannedDay && item.stops.some((stop) => stop.fieldId === field.id && !stop.stretch),
    );
    if (route) {
      const coreStops = route.stops.filter((stop) => !stop.stretch);
      visit = {
        machineName: context.machines.find((machine) => machine.id === route.machineId)?.name ?? route.machineId,
        stop: coreStops.findIndex((stop) => stop.fieldId === field.id) + 1,
        stops: coreStops.length,
      };
    }
  }

  let code: SlotReasonCode;
  const previous = history.at(-2);
  if (status === "kept") code = "kept";
  else if (status === "broken") code = "broken_no_date";
  else if (status === "requested") code = context.published?.solve.unservedFieldIds.includes(field.id) ? "unplaced" : "requested";
  else if (previous?.state === "broken" && history.at(-1)?.state === "held") code = "moved";
  else if (status === "firm") code = visit ? "firm_route" : "firm";
  else code = "window";
  const reasonText = slotReasonText(
    code,
    {
      chcName: context.chc.name,
      date: promise?.kind === "firm" ? planner.dayToIso(promise.day) : undefined,
      startDate: promise?.kind === "window" ? planner.dayToIso(promise.startDay) : undefined,
      endDate: promise?.kind === "window" ? planner.dayToIso(promise.endDay) : undefined,
      machineName: visit?.machineName,
      villageName,
      stop: visit?.stop,
      stops: visit?.stops,
      movedBecause: held?.reason,
    },
    context.locale,
  );

  return {
    id: field.id,
    token: field.token,
    farmerName: field.farmerName,
    villageId: field.villageId,
    villageName,
    acres: field.acres,
    readyDate: planner.dayToIso(field.readyDay),
    waitingLimitDays: field.waitingLimitDays,
    burnDeadlineDate: planner.dayToIso(field.readyDay + field.waitingLimitDays),
    state: field.state,
    status,
    promise: promiseView(planner, promise),
    plannedDate: field.plannedDay === null ? null : planner.dayToIso(field.plannedDay),
    fieldsAhead,
    queuePosition: fieldsAhead === null ? null : fieldsAhead + 1,
    visit,
    reason: { code, text: reasonText },
    soonerRequested: field.soonerRequestedAt !== null,
    history: history.map((record) => ({
      version: record.version,
      promise: promiseView(planner, record.promise),
      state: record.state,
      at: record.at,
      reason: record.reason,
    })),
    notice: noticeFromHistory(history),
  };
}

/** One field as its farmer (or the facilitator who booked it, or a slot link) sees it. */
export async function buildOneFarmerField(planner: Planner, store: VaariStore, field: FieldRecord, locale: Locale): Promise<FarmerField> {
  const [context, history] = await Promise.all([farmerFieldContext(planner, store, field.chcId, locale), store.promiseHistory(field.chcId, field.id)]);
  return buildFarmerField(planner, context, field, history);
}

/**
 * /farmer behind a phone session: the given fields (all booked with one phone, found through
 * phone-index and each already allowed by Cedar), newest first, each with its machine centre. The
 * phone itself is not in the answer: the farmer knows it, and the page never needs it.
 */
export async function buildFarmerPhoneHome(planner: Planner, store: VaariStore, fields: FieldRecord[], locale: Locale): Promise<FarmerHome> {
  const contexts = new Map<string, { context: FarmerFieldContext; historyByField: Map<string, PromiseRecord[]> }>();
  for (const chcId of new Set(fields.map((field) => field.chcId))) {
    const [context, promiseRecords] = await Promise.all([farmerFieldContext(planner, store, chcId, locale), store.listPromises(chcId)]);
    contexts.set(chcId, { context, historyByField: groupPromises(promiseRecords) });
  }
  const newestFirst = [...fields].sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  return {
    today: planner.dayToIso(planner.today()),
    farmerName: newestFirst[0]?.farmerName ?? "",
    fields: newestFirst.map((field) => {
      const { context, historyByField } = contexts.get(field.chcId)!;
      return {
        ...buildFarmerField(planner, context, field, historyByField.get(field.id) ?? []),
        chcId: field.chcId,
        chcName: context.chc.name,
        operatorPhone: context.chc.operatorPhone,
      };
    }),
  };
}

/** Fields a facilitator booked (any CHC), as queue rows: who, where, when, how risky. */
export async function buildBookedFields(planner: Planner, store: VaariStore, fields: FieldRecord[]): Promise<QueueItem[]> {
  const heldByField = new Map<string, PromiseRecord | null>();
  for (const chcId of new Set(fields.map((field) => field.chcId))) {
    await planner.finishPendingPublish(chcId);
    const historyByField = groupPromises(await store.listPromises(chcId));
    for (const field of fields.filter((item) => item.chcId === chcId)) heldByField.set(field.id, currentPromise(historyByField.get(field.id) ?? []));
  }
  // Keep the booking order (oldest first); the page sorts as it needs.
  const byId = new Map(queueItems(planner, fields, heldByField).map((item) => [item.fieldId, item]));
  return fields.map((field) => byId.get(field.id)!);
}
