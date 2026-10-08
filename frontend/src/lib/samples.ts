/**
 * Sample records for the /design page and component tests only. They follow the API's shapes;
 * nothing here is shown as real data.
 */
import type { FarmerField, QueueItem } from "@/shared";

export const SAMPLE_TODAY = "2026-10-31";

const base: FarmerField = {
  id: "sample-field",
  token: 18,
  farmerName: "Jaswinder Singh",
  villageId: "v1",
  villageName: "Balian",
  acres: 6,
  readyDate: "2026-10-30",
  waitingLimitDays: 5,
  burnDeadlineDate: "2026-11-04",
  state: "promised",
  status: "firm",
  promise: { kind: "firm", date: "2026-11-01" },
  plannedDate: "2026-11-01",
  fieldsAhead: 3,
  queuePosition: 4,
  visit: { machineName: "Super Seeder 2", stop: 2, stops: 3 },
  reason: { code: "firm_route", text: "Super Seeder 2 comes to Balian on Sunday, 1 November. Your field is stop 2 of 3 that day." },
  soonerRequested: false,
  history: [],
  notice: null,
};

const windowReason = { code: "window" as const, text: "Your turn is between Tuesday, 3 November and Wednesday, 4 November. Vaari fixes the exact day two days before, when that day's routes are set." };

export const SAMPLE_FIELDS = {
  firm: base,
  // A window never runs past the farmer's last day (4 Nov here); the engine caps it there.
  window: { ...base, status: "window", promise: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" }, plannedDate: "2026-11-04", fieldsAhead: 12, queuePosition: 13, visit: null, reason: windowReason } as FarmerField,
  // Booked, waiting for the operator's next published plan: no date, no place in the queue yet.
  requested: {
    ...base, state: "waiting", status: "requested", promise: null, plannedDate: null, fieldsAhead: null, queuePosition: null, visit: null,
    reason: { code: "requested", text: "Your request is with Balian Cooperative Society. The operator plans the machines each evening; your date appears here as soon as they publish a plan that includes your field." },
  } as FarmerField,
  // Planned but not promised: the slot must not show 2026-11-06 anywhere.
  noPromise: { ...base, state: "waiting", status: "requested", promise: null, plannedDate: "2026-11-06", fieldsAhead: null, queuePosition: null, visit: null,
    reason: { code: "unplaced", text: "Every machine is full for the next 10 days. Your operator sees your field marked at risk and is looking for room." } } as FarmerField,
  onTheWay: { ...base, promise: { kind: "firm", date: SAMPLE_TODAY }, fieldsAhead: 0, queuePosition: 1 } as FarmerField,
  done: { ...base, state: "done", status: "kept", reason: { code: "kept", text: "The machine has sown this field. Your promise was kept." } } as FarmerField,
  broken: { ...base, status: "window", promise: { kind: "window", startDate: "2026-11-02", endDate: "2026-11-04" }, visit: null, notice: { kind: "broken", at: "2026-10-31T09:00:00.000Z" },
    reason: { code: "moved", text: "Your date had to move because a machine broke down. The date above is the earliest Vaari could find." } } as FarmerField,
  // The farmer said "I cannot wait longer": their window stands until the operator publishes a new plan.
  sooner: { ...base, status: "window", promise: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" }, visit: null, reason: windowReason, soonerRequested: true, waitingLimitDays: 3, burnDeadlineDate: "2026-11-02" } as FarmerField,
};

export const SAMPLE_REASONS = ["Sunday 1 November: every working machine is already full.", "Your date is 3 days before the last day you said you can wait."];

const item: QueueItem = {
  fieldId: "q1",
  token: 41,
  farmerName: "Paramjit Kaur",
  villageName: "Akoi",
  acres: 3,
  readyDate: "2026-11-02",
  burnDeadlineDate: "2026-11-09",
  plannedDate: "2026-11-03",
  promise: { kind: "window", startDate: "2026-11-02", endDate: "2026-11-04" },
  slackDays: 6,
  risk: "safe",
};

export const SAMPLE_BOOKED: QueueItem[] = [
  { ...item, fieldId: "q1", token: 43, farmerName: "Paramjit Kaur", promise: { kind: "firm", date: "2026-11-01" }, plannedDate: "2026-11-01" },
  { ...item, fieldId: "q2", token: 42, farmerName: "Baldev Singh", villageName: "Thales" },
  { ...item, fieldId: "q3", token: 41, farmerName: "Manjit Kaur", villageName: "Zulmgarh", promise: null, plannedDate: "2026-11-08", risk: "at_risk", slackDays: -1 },
];
