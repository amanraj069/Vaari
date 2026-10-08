/**
 * The operator's plan pieces: what approving changes (broken promises in ember, never hidden),
 * lanes that flag fields past the farmer's last waiting day with an icon and words (not colour
 * alone), and the move dialog that refuses workshop and rain days with the reason.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MachineLane } from "@/components/machine-lane";
import { MoveFieldDialog } from "@/components/move-field-dialog";
import { PlanChangesList } from "@/components/plan-changes";
import type { Lane, LaneStop, PlanChangesView } from "@/shared";
import { renderWithIntl } from "./render";

const ref = (token: number, farmerName: string) => ({ fieldId: `f${token}`, token, farmerName, villageName: "Balian" });

const changes: PlanChangesView = {
  promised: [{ ...ref(41, "Paramjit Kaur"), promise: { kind: "firm", date: "2026-11-01" } }],
  firmed: [{ ...ref(12, "Baldev Singh"), date: "2026-11-02" }],
  moved: [],
  broken: [{ ...ref(7, "Manjit Kaur"), previous: { kind: "firm", date: "2026-11-01" }, next: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" } }],
  rePromised: [],
  unplaced: [],
};

const stop = (overrides: Partial<LaneStop> = {}): LaneStop => ({
  fieldId: "f41", risk: "safe", token: 41, farmerName: "Paramjit Kaur", villageName: "Balian", acres: 1, part: 1, parts: 1,
  start: "08:00", end: "09:30", travelMinutesBefore: 0, stretch: false, promise: { kind: "firm", date: "2026-11-01" }, ...overrides,
});

const lane = (stops: LaneStop[]): Lane => ({
  machine: { id: "m1", name: "Super Seeder 1", kind: "super_seeder", status: "working", downDates: [], promiseAcresPerDay: 6.6, planAcresPerDay: 8.6, logsCount: 0 },
  down: false, stops, endTime: "12:00", capacityEndTime: "16:00", travelKm: 4.2,
});

describe("what approving does", () => {
  it("lists each farmer, with broken promises first and the proof that no plan could break fewer", () => {
    renderWithIntl(<PlanChangesList changes={changes} brokenProven />);
    expect(screen.getByText("1 promise breaks; the farmer is told at once")).toBeInTheDocument();
    expect(screen.getByText("No plan could break fewer promises (the planner proved it).")).toBeInTheDocument();
    expect(screen.getByText("1 farmer gets a first date")).toBeInTheDocument();
    expect(screen.getByText("1 window becomes a firm date")).toBeInTheDocument();
    expect(screen.getByText("Paramjit Kaur")).toBeInTheDocument();
  });

  it("says so when nothing changes", () => {
    renderWithIntl(<PlanChangesList changes={{ promised: [], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] }} brokenProven={null} />);
    expect(screen.getByText("No farmer's date changes.")).toBeInTheDocument();
  });

  it.each(["pa", "hi"] as const)("renders in %s", (locale) => {
    renderWithIntl(<PlanChangesList changes={changes} brokenProven />, locale);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});

describe("machine lane", () => {
  it("marks a field past the farmer's last waiting day with a warning that is spoken, not only coloured", () => {
    renderWithIntl(<ul><MachineLane lane={lane([stop({ risk: "at_risk" })])} index={0} dayStart="08:00" busy={false} /></ul>);
    expect(screen.getByRole("img", { name: "After the farmer's last waiting day" })).toBeInTheDocument();
    // Read-only on the board: no workshop button unless the page passes one.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("makes stops buttons on the plan page", async () => {
    const onSelectStop = vi.fn();
    renderWithIntl(
      <ul>
        <MachineLane lane={lane([stop()])} index={0} dayStart="08:00" busy={false} onSelectStop={onSelectStop} selectLabel={() => "Move #041 Paramjit Kaur"} />
      </ul>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Move #041 Paramjit Kaur" }));
    expect(onSelectStop).toHaveBeenCalledWith(expect.objectContaining({ fieldId: "f41" }));
  });
});

describe("move dialog", () => {
  const options = {
    machines: [
      { id: "m1", name: "Super Seeder 1", downDates: [] },
      { id: "m2", name: "Super Seeder 2", downDates: ["2026-11-01"] },
    ],
    dates: ["2026-11-01", "2026-11-02", "2026-11-03"],
    rainDates: ["2026-11-03"],
  };

  it("refuses workshop and rain days with the reason, and sends the chosen machine and day", async () => {
    const onMove = vi.fn();
    renderWithIntl(
      <MoveFieldDialog stop={stop()} currentMachineId="m1" planDate="2026-11-01" options={options} pending={false} error={null} onClose={() => undefined} onMove={onMove} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Move #041 Paramjit Kaur" });
    expect(within(dialog).getByRole("radio", { name: /3 Nov.*rain/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Super Seeder 2" }));
    expect(within(dialog).getByRole("radio", { name: /1 Nov.*in the workshop that day/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Move and re-plan" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: /2 Nov/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move and re-plan" }));
    expect(onMove).toHaveBeenCalledWith({ machineId: "m2", date: "2026-11-02" });
  });
});
