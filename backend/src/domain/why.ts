/**
 * "Why this date?" from the solver's own reasons, phrased by templates (en/pa/hi). One function so
 * the signed-in route, the phone-session route, the slot link and the WhatsApp agent all say exactly
 * the same thing. The engine decides; nothing here invents a date.
 */
import type { Locale, Why } from "../shared";
import type { EngineClient } from "../engine/client";
import { reasonText } from "../explain/templates";
import type { FieldRecord, VaariStore } from "../store/types";
import type { Planner } from "./planner";

export async function explainField(deps: { planner: Planner; store: VaariStore; engine: EngineClient }, field: FieldRecord, locale: Locale): Promise<Why> {
  const { request: solveRequest } = await deps.planner.buildSolveRequest(field.chcId);
  // Unplanned: ask whether any day inside the horizon could work.
  const currentDay = field.plannedDay ?? deps.planner.today() + 1 + (solveRequest.horizonDays ?? 10);
  const explained = await deps.engine.explain({ ...solveRequest, fieldId: field.id, currentDay });
  const machines = await deps.store.listMachines(field.chcId);
  const machineName = new Map(machines.map((machine) => [machine.id, machine.name]));
  return {
    fieldId: field.id,
    plannedDate: field.plannedDay === null ? null : deps.planner.dayToIso(field.plannedDay),
    earlierPossible: explained.earlierPossible,
    reasons: explained.reasons.map((reason) => {
      const dates = reason.days.map((day) => deps.planner.dayToIso(day));
      const machineNames = reason.machineIds.map((id) => machineName.get(id) ?? id);
      return { code: reason.code, dates, machineNames, count: reason.count, text: reasonText(reason.code, { dates, machines: machineNames, count: reason.count }, locale) };
    }),
    source: "template",
  };
}
