/**
 * Builds what each page shows from stored records and the latest plan. Pages get answers, not raw
 * data: the farmer's date and how many fields are ahead, the operator's lanes and who is at risk.
 * Risk is computed here in one place so the board, the queue and the farmer page agree.
 */
import {
  learnRate,
  minuteToClock,
  type FarmerField,
  type FarmerHome,
  type FieldPromise,
  type Lane,
  type MachineView,
  type OperatorBoard,
  type PromiseView,
  type QueueItem,
  type ReplanSummary,
  type Risk,
} from "../shared";
import type { FieldRecord, MachineRecord, NotificationRecord, PromiseRecord, VaariStore } from "../store/types";
import { currentPromise, type Planner } from "./planner";

const HORIZON_DAYS = 10;

export function promiseView(planner: Planner, promise: FieldPromise | null): PromiseView | null {
  if (!promise) return null;
  return promise.kind === "firm"
    ? { kind: "firm", date: planner.dayToIso(promise.day) }
    : { kind: "window", startDate: planner.dayToIso(promise.startDay), endDate: planner.dayToIso(promise.endDay) };
}

export function riskOf(field: FieldRecord, today: number): { risk: Risk; slackDays: number | null } {
  const burnDeadline = field.readyDay + field.waitingLimitDays;
  const horizonEnd = today + 1 + HORIZON_DAYS;
  if (field.plannedDay === null) {
    return { risk: burnDeadline < horizonEnd ? "at_risk" : "unplanned", slackDays: burnDeadline - today };
  }
  const slackDays = burnDeadline - field.plannedDay;
  if (slackDays < 0) return { risk: "at_risk", slackDays };
  if (slackDays <= 1) return { risk: "tight", slackDays };
  return { risk: "safe", slackDays };
}

function machineView(planner: Planner, machine: MachineRecord, planDay: number): MachineView {
  const rate = learnRate(machine.logs);
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

export async function buildQueue(planner: Planner, store: VaariStore, chcId: string): Promise<QueueItem[]> {
  const { fields } = await planner.loadChc(chcId);
  const villages = new Map((await store.listVillages()).map((village) => [village.id, village]));
  const today = planner.today();
  const items: QueueItem[] = [];
  for (const field of fields.filter((item) => item.state !== "done")) {
    const held = currentPromise(await store.promiseHistory(field.id));
    const { risk, slackDays } = riskOf(field, today);
    items.push({
      fieldId: field.id,
      token: field.token,
      farmerName: field.farmerName,
      villageName: villages.get(field.villageId)?.name ?? field.villageId,
      acres: field.acres,
      readyDate: planner.dayToIso(field.readyDay),
      burnDeadlineDate: planner.dayToIso(field.readyDay + field.waitingLimitDays),
      plannedDate: field.plannedDay === null ? null : planner.dayToIso(field.plannedDay),
      promise: promiseView(planner, held?.promise ?? null),
      slackDays,
      risk,
    });
  }
  // Least slack first: the fuse that burns down soonest is at the top.
  items.sort((left, right) => (left.slackDays ?? 99) - (right.slackDays ?? 99) || left.token - right.token);
  return items;
}

export async function buildBoard(planner: Planner, store: VaariStore, chcId: string): Promise<OperatorBoard> {
  const { plan, solve } = await planner.latestSolve(chcId);
  const { chc, machines, fields } = await planner.loadChc(chcId);
  const villages = new Map((await store.listVillages()).map((village) => [village.id, village]));
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const planDay = solve.planStartDay;
  const promiseByField = new Map<string, PromiseRecord | null>();
  let brokenThisSeason = 0;
  for (const field of fields) {
    const history = await store.promiseHistory(field.id);
    promiseByField.set(field.id, currentPromise(history));
    brokenThisSeason += history.filter((record) => record.state === "broken").length;
  }

  const lanes: Lane[] = machines.map((machine) => {
    const route = solve.routes.find((item) => item.machineId === machine.id && item.day === planDay);
    const down = machine.downDays.includes(planDay);
    return {
      machine: machineView(planner, machine, planDay),
      down,
      stops: (route?.stops ?? []).map((stop) => {
        const field = fieldsById.get(stop.fieldId);
        return {
          fieldId: stop.fieldId,
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
          promise: promiseView(planner, promiseByField.get(stop.fieldId)?.promise ?? null),
        };
      }),
      endTime: route ? minuteToClock(route.endMinute) : null,
      capacityEndTime: minuteToClock(route?.capacityMinute ?? 8 * 60 + machine.hoursPerDay * 60),
      travelKm: route?.travelKm ?? 0,
    };
  });

  const queue = await buildQueue(planner, store, chcId);
  const activeFields = fields.filter((field) => field.state !== "done");
  const promisesOpen = activeFields.filter((field) => promiseByField.get(field.id)).length;
  const promisesOnTrack = activeFields.filter((field) => {
    const promise = promiseByField.get(field.id)?.promise;
    if (!promise || field.plannedDay === null) return false;
    return promise.kind === "firm"
      ? field.plannedDay <= promise.day
      : field.plannedDay >= promise.startDay && field.plannedDay <= promise.endDay;
  }).length;

  const lastReplan = await store.lastReplan(chcId);
  let lastReplanView: ReplanSummary | null = null;
  if (lastReplan) {
    const machineName = machines.find((machine) => machine.id === lastReplan.machineId)?.name ?? null;
    lastReplanView = {
      at: lastReplan.at,
      cause: lastReplan.cause,
      machineName,
      moved: lastReplan.moved.map((item) => ({
        fieldId: item.fieldId,
        token: fieldsById.get(item.fieldId)?.token ?? 0,
        farmerName: fieldsById.get(item.fieldId)?.farmerName ?? "",
        fromDate: item.fromDay === null ? null : planner.dayToIso(item.fromDay),
        toDate: item.toDay === null ? null : planner.dayToIso(item.toDay),
      })),
      broken: lastReplan.broken.map((item) => ({
        fieldId: item.fieldId,
        token: fieldsById.get(item.fieldId)?.token ?? 0,
        farmerName: fieldsById.get(item.fieldId)?.farmerName ?? "",
        previous: promiseView(planner, item.previous),
        next: promiseView(planner, item.next),
      })),
    };
  }

  return {
    chc: { id: chc.id, name: chc.name },
    today: planner.dayToIso(planner.today()),
    planDate: planner.dayToIso(planDay),
    plan: {
      status: plan.status,
      version: plan.version,
      approvedAt: plan.approvedAt,
      approvedBy: plan.approvedBy,
      firmingCount: plan.firmingFieldIds.length,
    },
    counts: {
      machinesWorking: lanes.filter((lane) => !lane.down).length,
      machinesTotal: lanes.length,
      promisesOpen,
      promisesOnTrack,
      burnRisk: queue.filter((item) => item.risk === "at_risk").length,
      unplanned: activeFields.filter((field) => field.plannedDay === null).length,
      brokenThisSeason,
    },
    lanes,
    atRisk: queue.filter((item) => item.risk === "at_risk" || item.risk === "tight"),
    lastReplan: lastReplanView,
    solver: {
      status: solve.solver.status,
      mode: solve.solver.mode,
      wallSeconds: solve.solver.wallSeconds,
      maxDelayVsQueueDays: solve.metrics.maxDelayVsQueueDays,
      fieldsBeyondFairnessK: solve.metrics.fieldsBeyondFairnessK,
    },
  };
}

export async function buildFarmerField(
  planner: Planner,
  store: VaariStore,
  field: FieldRecord,
  allFields: FieldRecord[],
  notifications: NotificationRecord[],
): Promise<FarmerField> {
  const villages = new Map((await store.listVillages()).map((village) => [village.id, village]));
  const history = await store.promiseHistory(field.id);
  const held = currentPromise(history);
  const fieldsAhead =
    field.plannedDay === null
      ? null
      : allFields.filter((other) => other.state !== "done" && other.plannedDay !== null && other.plannedDay < field.plannedDay!).length;
  const latestNotice = notifications
    .filter((notification) => notification.fieldId === field.id)
    .sort((left, right) => right.at.localeCompare(left.at))[0];
  return {
    id: field.id,
    token: field.token,
    farmerName: field.farmerName,
    villageId: field.villageId,
    villageName: villages.get(field.villageId)?.name ?? field.villageId,
    acres: field.acres,
    readyDate: planner.dayToIso(field.readyDay),
    waitingLimitDays: field.waitingLimitDays,
    burnDeadlineDate: planner.dayToIso(field.readyDay + field.waitingLimitDays),
    state: field.state,
    promise: promiseView(planner, held?.promise ?? null),
    plannedDate: field.plannedDay === null ? null : planner.dayToIso(field.plannedDay),
    fieldsAhead,
    history: history.map((record) => ({
      version: record.version,
      promise: promiseView(planner, record.promise),
      state: record.state,
      at: record.at,
      reason: record.reason,
    })),
    notice: latestNotice ? { kind: latestNotice.kind, at: latestNotice.at } : null,
  };
}

export async function buildFarmerHome(planner: Planner, store: VaariStore, farmerId: string, chcId: string): Promise<FarmerHome> {
  const farmer = await store.getFarmer(farmerId);
  const chc = await store.getChc(chcId);
  const myFields = (await store.listFieldsByFarmer(farmerId)).sort((left, right) => left.requestOrder - right.requestOrder);
  const allFields = await store.listFields(chcId);
  const notifications = await store.listNotifications(farmerId);
  const fields: FarmerField[] = [];
  for (const field of myFields) fields.push(await buildFarmerField(planner, store, field, allFields, notifications));
  return {
    today: planner.dayToIso(planner.today()),
    farmerName: farmer?.name ?? "",
    chcName: chc?.name ?? "",
    operatorPhone: chc?.operatorPhone ?? "",
    fields,
  };
}
