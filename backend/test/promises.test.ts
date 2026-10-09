/**
 * The promise state machine and what publishing a plan changes, without the engine or a store.
 * These are the rules the planner relies on: a promise only moves along the allowed arrows, a
 * farmer who asked for sooner never ends up later, and a field booked after a draft is untouched.
 */
import { describe, expect, it } from "vitest";
import { nextStatus, planChanges, promiseStatus, PromiseTransitionError } from "../src/domain/promises";
import type { SolveResponse } from "../src/shared";
import type { FieldRecord, PromiseRecord } from "../src/store/types";

const record = (version: number, state: PromiseRecord["state"], promise: PromiseRecord["promise"]): PromiseRecord => ({
  chcId: "c",
  fieldId: "f",
  version,
  promise,
  state,
  at: "2026-10-31T00:00:00.000Z",
  reason: "first_promise",
});

const field = (id: string, overrides: Partial<FieldRecord> = {}): FieldRecord => ({
  chcId: "c", id, token: 1, farmerId: "farmer", farmerName: "F", villageId: "v", acres: 2, readyDay: 30, waitingLimitDays: 8,
  requestOrder: 0, createdAt: "x", state: "waiting", plannedDay: null, plannedMachineId: null, bookedBy: null, farmerPhone: null,
  consentAt: null, consentBy: null, linkVersion: 1, soonerRequestedAt: null, ...overrides,
});

function solve(fieldDays: Record<string, number>, promises: SolveResponse["promises"], unserved: string[] = []): SolveResponse {
  return {
    planStartDay: 31, fieldDays, unservedFieldIds: unserved, assignments: [], routes: [], promises, queueDays: {},
    metrics: { fieldsTotal: 0, fieldsPlanned: 0, fieldsUnserved: 0, fieldsPastBurnDeadline: 0, promisesHeld: 0, promisesBroken: 0, wheatLossKg: 0, travelKm: 0, maxDelayVsQueueDays: 0, fieldsBeyondFairnessK: 0 },
    solver: { status: "optimal", mode: "normal", wallSeconds: 0, burnPassObjective: 0, costPassObjective: 0 },
  };
}

describe("promise state machine", () => {
  it("follows requested -> window -> firm -> kept", () => {
    expect(nextStatus("requested", "publish", { kind: "window", startDay: 34, endDay: 35 })).toBe("window");
    expect(nextStatus("window", "narrow")).toBe("firm");
    expect(nextStatus("firm", "sow_on_time")).toBe("kept");
  });

  it("goes straight to firm when the first date is within two days", () => {
    expect(nextStatus("requested", "publish", { kind: "firm", day: 32 })).toBe("firm");
  });

  it("breaks, and a broken promise is replaced by a new one", () => {
    expect(nextStatus("firm", "break")).toBe("broken");
    expect(nextStatus("window", "sow_late")).toBe("broken");
    expect(nextStatus("broken", "re_promise", { kind: "firm", day: 33 })).toBe("firm");
  });

  it("refuses every change the rules do not allow", () => {
    expect(() => nextStatus("firm", "narrow")).toThrow(PromiseTransitionError);
    expect(() => nextStatus("requested", "sow_on_time")).toThrow(PromiseTransitionError);
    expect(() => nextStatus("kept", "break")).toThrow(PromiseTransitionError);
    expect(() => nextStatus("window", "publish", { kind: "firm", day: 32 })).toThrow(PromiseTransitionError);
    expect(() => nextStatus("requested", "publish", null)).toThrow(PromiseTransitionError);
  });

  it("reads the status from a field's history", () => {
    expect(promiseStatus([])).toBe("requested");
    expect(promiseStatus([record(1, "held", { kind: "window", startDay: 34, endDay: 35 })])).toBe("window");
    expect(promiseStatus([record(1, "replaced", { kind: "window", startDay: 34, endDay: 35 }), record(2, "held", { kind: "firm", day: 34 })])).toBe("firm");
    expect(promiseStatus([record(1, "kept", { kind: "firm", day: 34 })])).toBe("kept");
    expect(promiseStatus([record(1, "broken", { kind: "firm", day: 32 })])).toBe("broken");
    expect(promiseStatus([record(1, "broken", { kind: "firm", day: 32 }), record(2, "held", { kind: "firm", day: 33 })])).toBe("firm");
  });
});

describe("what publishing a plan changes", () => {
  const window = { kind: "window" as const, startDay: 34, endDay: 36 };

  it("promises requested fields, firms windows inside two days, records moves and breaks", () => {
    const fields = [field("new"), field("narrow", { plannedDay: 34 }), field("moves", { plannedDay: 35 }), field("breaks", { plannedDay: 32 }), field("late")];
    const held = new Map<string, PromiseRecord | null>([
      ["new", null],
      ["narrow", record(1, "held", window)],
      ["moves", record(1, "held", window)],
      ["breaks", record(1, "held", { kind: "firm", day: 32 })],
      ["late", null],
    ]);
    const changes = planChanges(
      fields,
      held,
      solve(
        { new: 33, narrow: 32, moves: 34, breaks: 35 },
        [
          { fieldId: "new", promise: { kind: "window", startDay: 33, endDay: 34 }, previous: null, changed: true, broken: false },
          { fieldId: "narrow", promise: { kind: "firm", day: 32 }, previous: window, changed: true, broken: false },
          { fieldId: "moves", promise: window, previous: window, changed: false, broken: false },
          { fieldId: "breaks", promise: { kind: "firm", day: 35 }, previous: { kind: "firm", day: 32 }, changed: true, broken: true },
        ],
        ["late"],
      ),
    );
    expect(changes.promised).toEqual([{ fieldId: "new", promise: { kind: "window", startDay: 33, endDay: 34 } }]);
    expect(changes.firmed).toEqual([{ fieldId: "narrow", day: 32 }]);
    // "narrow" changed day too, but it is listed once, as firmed.
    expect(changes.moved).toEqual([{ fieldId: "moves", fromDay: 35, toDay: 34 }]);
    expect(changes.broken).toEqual([{ fieldId: "breaks", previous: { kind: "firm", day: 32 }, next: { kind: "firm", day: 35 } }]);
    expect(changes.unplaced).toEqual(["late"]);
  });

  it("gives a farmer who asked for sooner the new date only if it is no later, and never trades firm for a window", () => {
    const sooner = { soonerRequestedAt: "x" };
    const fields = [field("earlier", sooner), field("later", sooner), field("firmToWindow", sooner)];
    const held = new Map<string, PromiseRecord | null>([
      ["earlier", record(1, "held", window)],
      ["later", record(1, "held", window)],
      ["firmToWindow", record(1, "held", { kind: "firm", day: 35 })],
    ]);
    const changes = planChanges(
      fields,
      held,
      solve({ earlier: 32, later: 38, firmToWindow: 33 }, [
        { fieldId: "earlier", promise: { kind: "firm", day: 32 }, previous: null, changed: true, broken: false },
        { fieldId: "later", promise: { kind: "window", startDay: 37, endDay: 38 }, previous: null, changed: true, broken: false },
        { fieldId: "firmToWindow", promise: { kind: "window", startDay: 33, endDay: 34 }, previous: null, changed: true, broken: false },
      ]),
    );
    expect(changes.rePromised).toEqual([{ fieldId: "earlier", previous: window, next: { kind: "firm", day: 32 } }]);
  });

  it("leaves fields the plan does not cover (booked after the draft) and sown fields alone", () => {
    const changes = planChanges([field("bookedLater"), field("sown", { state: "done" })], new Map(), solve({ sown: 32 }, []));
    expect(changes).toEqual({ promised: [], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] });
  });
});
