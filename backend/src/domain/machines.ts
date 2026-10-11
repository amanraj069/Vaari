/**
 * Whether a machine works for this centre on a day. One answer for the planner, the operator's
 * pages and the officer's outlook: not in the workshop, not lent to another centre, and, for a
 * machine borrowed from another centre, only on the loan's days.
 */
import type { MachineRecord } from "../store/types";

export function machineOff(machine: MachineRecord, day: number): boolean {
  if (machine.downDays.includes(day)) return true;
  const { loan } = machine;
  if (!loan) return false;
  const insideLoan = day >= loan.startDay && day <= loan.endDay;
  return loan.direction === "out" ? insideLoan : !insideLoan;
}

/** The days in [fromDay, toDay] the machine does not work here (the engine's downDays). */
export function offDays(machine: MachineRecord, fromDay: number, toDay: number): number[] {
  const days = new Set(machine.downDays);
  for (let day = fromDay; day <= toDay; day += 1) if (machineOff(machine, day)) days.add(day);
  return [...days].sort((left, right) => left - right);
}

/** A centre's own machines, free to lend: not on loan either way. */
export function ownMachines(machines: MachineRecord[]): MachineRecord[] {
  return machines.filter((machine) => !machine.loan);
}
