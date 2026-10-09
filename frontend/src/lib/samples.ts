/**
 * Sample records for the /design page and component tests only. They follow the API's shapes;
 * nothing here is shown as real data. Every sentence lives in the messages files (namespace
 * "design", keys sample*): /design shows them in the reader's language (useSamples), and the tests
 * use the English ones (SAMPLE_FIELDS, SAMPLE_REASONS, read from messages/en.json).
 */
import { useTranslations } from "next-intl";
import type { FarmerField, QueueItem } from "@/shared";
import english from "../../messages/en.json";

export const SAMPLE_TODAY = "2026-10-31";

type SampleTextKey = "sampleFirmRoute" | "sampleWindow" | "sampleRequested" | "sampleUnplaced" | "sampleKept" | "sampleMoved" | "sampleWhyFull" | "sampleWhyBefore";
type SampleText = (key: SampleTextKey) => string;

function sampleFields(text: SampleText) {
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
    reason: { code: "firm_route", text: text("sampleFirmRoute") },
    soonerRequested: false,
    history: [],
    notice: null,
  };
  const windowReason = { code: "window" as const, text: text("sampleWindow") };
  return {
    firm: base,
    // A window never runs past the farmer's last day (4 Nov here); the engine caps it there.
    window: { ...base, status: "window", promise: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" }, plannedDate: "2026-11-04", fieldsAhead: 12, queuePosition: 13, visit: null, reason: windowReason } as FarmerField,
    // Booked, waiting for the operator's next published plan: no date, no place in the queue yet.
    requested: {
      ...base, state: "waiting", status: "requested", promise: null, plannedDate: null, fieldsAhead: null, queuePosition: null, visit: null,
      reason: { code: "requested", text: text("sampleRequested") },
    } as FarmerField,
    // Planned but not promised: the slot must not show 2026-11-06 anywhere.
    noPromise: { ...base, state: "waiting", status: "requested", promise: null, plannedDate: "2026-11-06", fieldsAhead: null, queuePosition: null, visit: null,
      reason: { code: "unplaced", text: text("sampleUnplaced") } } as FarmerField,
    onTheWay: { ...base, promise: { kind: "firm", date: SAMPLE_TODAY }, fieldsAhead: 0, queuePosition: 1 } as FarmerField,
    done: { ...base, state: "done", status: "kept", reason: { code: "kept", text: text("sampleKept") } } as FarmerField,
    broken: { ...base, status: "window", promise: { kind: "window", startDate: "2026-11-02", endDate: "2026-11-04" }, visit: null, notice: { kind: "broken", at: "2026-10-31T09:00:00.000Z" },
      reason: { code: "moved", text: text("sampleMoved") } } as FarmerField,
    // The farmer said "I cannot wait longer": their window stands until the operator publishes a new plan.
    sooner: { ...base, status: "window", promise: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" }, visit: null, reason: windowReason, soonerRequested: true, waitingLimitDays: 3, burnDeadlineDate: "2026-11-02" } as FarmerField,
  };
}

const sampleReasons = (text: SampleText) => [text("sampleWhyFull"), text("sampleWhyBefore")];

/** The samples in the reader's language (for /design). */
export function useSamples() {
  const t = useTranslations("design");
  const text: SampleText = (key) => t(key);
  return { fields: sampleFields(text), reasons: sampleReasons(text) };
}

const inEnglish: SampleText = (key) => english.design[key];

/** English samples for component tests. */
export const SAMPLE_FIELDS = sampleFields(inEnglish);
export const SAMPLE_REASONS = sampleReasons(inEnglish);

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
