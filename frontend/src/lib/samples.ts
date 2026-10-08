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
  promise: { kind: "firm", date: "2026-11-01" },
  plannedDate: "2026-11-01",
  fieldsAhead: 3,
  history: [],
  notice: null,
};

export const SAMPLE_FIELDS = {
  firm: base,
  // A window never runs past the farmer's last day (4 Nov here); the engine caps it there.
  window: { ...base, promise: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" }, plannedDate: "2026-11-04", fieldsAhead: 12 } as FarmerField,
  // Planned but not promised: the slot must not show 2026-11-06 anywhere.
  noPromise: { ...base, state: "waiting", promise: null, plannedDate: "2026-11-06", fieldsAhead: 20 } as FarmerField,
  onTheWay: { ...base, promise: { kind: "firm", date: SAMPLE_TODAY }, fieldsAhead: 0 } as FarmerField,
  done: { ...base, state: "done" } as FarmerField,
  broken: { ...base, promise: { kind: "window", startDate: "2026-11-02", endDate: "2026-11-04" }, notice: { kind: "broken", at: "2026-10-31T09:00:00.000Z" } } as FarmerField,
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
