/**
 * The promise state machine, and what publishing a plan does to promises.
 *
 * Why it exists: a promise is the product. Every way a farmer's date can change goes through
 * `nextStatus`, which refuses any change the rules do not allow, so no code path can (for example)
 * quietly turn a firm date back into a window or "keep" a promise that was never made:
 *
 *   requested --publish--> window --narrow--> firm --sow on time--> kept
 *        \--publish (day within 2 days)-------^   \--break / sow late--> broken --re-promise--> window | firm
 *   window | firm --sooner (farmer asked, never later)--> window | firm
 *
 * `planChanges` is pure: given the fields, their current promises and a solved plan, it says what
 * publishing that plan would do. The draft shows it before approval (the operator sees "moves 2,
 * breaks 0"), and approval applies exactly the same list.
 */
import type { FieldPromise, PromiseStatus, SolveResponse } from "../shared";
import type { FieldRecord, PlanChanges, PromiseRecord } from "../store/types";

export type PromiseEvent = "publish" | "narrow" | "break" | "re_promise" | "sooner" | "sow_on_time" | "sow_late";

/** For each status, the events allowed and the status they lead to (a promise's kind decides window vs firm). */
const TRANSITIONS: Record<PromiseStatus, Partial<Record<PromiseEvent, "by_kind" | PromiseStatus>>> = {
  requested: { publish: "by_kind" },
  window: { narrow: "firm", break: "broken", sooner: "by_kind", sow_on_time: "kept", sow_late: "broken" },
  firm: { break: "broken", sooner: "firm", sow_on_time: "kept", sow_late: "broken" },
  broken: { re_promise: "by_kind" },
  kept: {},
};

export class PromiseTransitionError extends Error {
  constructor(
    readonly from: PromiseStatus,
    readonly event: PromiseEvent,
  ) {
    super(`a ${from} promise cannot ${event.replace("_", " ")}`);
  }
}

/** The status after `event`, or PromiseTransitionError if the rules do not allow it. */
export function nextStatus(from: PromiseStatus, event: PromiseEvent, promise: FieldPromise | null = null): PromiseStatus {
  const target = TRANSITIONS[from][event];
  if (target === undefined) throw new PromiseTransitionError(from, event);
  if (target !== "by_kind") return target;
  if (!promise) throw new PromiseTransitionError(from, event);
  return promise.kind;
}

/** The current held promise in a field's history (oldest first), or null. */
export function currentPromise(history: PromiseRecord[]): PromiseRecord | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index]!;
    if (record.state === "held") return record;
    if (record.state === "broken" || record.state === "kept") return null;
  }
  return null;
}

/** Where a field's turn stands, read from its promise history (oldest version first). */
export function promiseStatus(history: PromiseRecord[]): PromiseStatus {
  const held = currentPromise(history);
  if (held?.promise) return held.promise.kind;
  const latest = history.at(-1);
  if (latest?.state === "kept") return "kept";
  if (latest?.state === "broken") return "broken";
  return "requested";
}

export function lastDay(promise: FieldPromise): number {
  return promise.kind === "firm" ? promise.day : promise.endDay;
}

function samePromise(left: FieldPromise, right: FieldPromise): boolean {
  return left.kind === "firm" && right.kind === "firm"
    ? left.day === right.day
    : left.kind === "window" && right.kind === "window" && left.startDay === right.startDay && left.endDay === right.endDay;
}

/**
 * What publishing `solve` would change, against the promises held right now. Only fields the plan
 * covers are touched: a field booked after the draft was made keeps waiting for the next plan.
 */
export function planChanges(fields: FieldRecord[], heldByField: Map<string, PromiseRecord | null>, solve: SolveResponse): PlanChanges {
  const changes: PlanChanges = { promised: [], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] };
  const promiseOutByField = new Map(solve.promises.map((item) => [item.fieldId, item]));
  const unserved = new Set(solve.unservedFieldIds);
  for (const field of fields) {
    if (field.state === "done") continue;
    const inPlan = field.id in solve.fieldDays || unserved.has(field.id);
    if (!inPlan) continue;
    const newDay = solve.fieldDays[field.id] ?? null;
    const held = heldByField.get(field.id)?.promise ?? null;
    const out = promiseOutByField.get(field.id);

    if (!held) {
      if (out?.promise) changes.promised.push({ fieldId: field.id, promise: out.promise });
      else changes.unplaced.push(field.id);
      continue;
    }
    if (out?.broken) {
      changes.broken.push({ fieldId: field.id, previous: held, next: out.promise });
      continue;
    }
    // The farmer asked for sooner, so their promise was left out of the solve. The new date
    // replaces it only if it is no later, and a firm date is never traded for a window;
    // otherwise the old promise stands.
    if (
      field.soonerRequestedAt &&
      out?.promise &&
      !samePromise(out.promise, held) &&
      lastDay(out.promise) <= lastDay(held) &&
      !(held.kind === "firm" && out.promise.kind === "window")
    ) {
      changes.rePromised.push({ fieldId: field.id, previous: held, next: out.promise });
      continue;
    }
    if (held.kind === "window" && out?.promise?.kind === "firm" && out.changed) {
      // The firm date already says the new day; listing it as a move too would count one farmer twice.
      changes.firmed.push({ fieldId: field.id, day: out.promise.day });
      continue;
    }
    if (field.plannedDay !== null && newDay !== field.plannedDay) {
      changes.moved.push({ fieldId: field.id, fromDay: field.plannedDay, toDay: newDay });
    }
  }
  return changes;
}

export function countChanges(changes: PlanChanges): number {
  return changes.promised.length + changes.firmed.length + changes.moved.length + changes.broken.length + changes.rePromised.length;
}
