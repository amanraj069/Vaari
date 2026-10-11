/** Every state of /slot/[token], rendered from the SlotView component with sample data. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SlotView, timelineStep, type SlotState } from "@/components/slot-view";
import { SAMPLE_FIELDS, SAMPLE_REASONS, SAMPLE_TODAY } from "@/lib/samples";
import type { FarmerField } from "@/shared";
import { renderWithIntl } from "./render";

const ready = (field: FarmerField, overrides: Partial<Extract<SlotState, { kind: "ready" }>> = {}): SlotState => ({
  kind: "ready",
  field,
  today: SAMPLE_TODAY,
  why: { kind: "ready", reasons: SAMPLE_REASONS },
  onCannotWait: vi.fn().mockResolvedValue(undefined),
  changeBase: "slot/sample",
  onChanged: vi.fn(),
  ...overrides,
});
const currentStep = () => within(screen.getByRole("list", { name: "Progress of this turn" })).getByRole("listitem", { current: "step" });

describe("SlotView states", () => {
  it("loading", () => {
    renderWithIntl(<SlotView state={{ kind: "loading" }} />);
    // (The toast region is also a status; find the loading message by its text.)
    expect(screen.getByText("Opening your turn…")).toHaveAttribute("role", "status");
  });

  it("tampered link (401)", () => {
    renderWithIntl(<SlotView state={{ kind: "invalid" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This link does not work");
  });

  it("someone else's field (403)", () => {
    renderWithIntl(<SlotView state={{ kind: "forbidden" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This field is not yours");
  });

  it("field removed (404)", () => {
    renderWithIntl(<SlotView state={{ kind: "notFound" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This field is no longer in the plan");
  });

  it("API unavailable offers a retry", async () => {
    const onRetry = vi.fn();
    renderWithIntl(<SlotView state={{ kind: "unavailable", onRetry }} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("firm promise: huge date, lock, fields ahead, Planned step, reasons", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.firm)} />);
    expect(screen.getAllByText("Firm date").length).toBeGreaterThan(0);
    expect(screen.getByText("Sunday")).toBeInTheDocument();
    expect(screen.getAllByText(/November 1|1 November/).length).toBeGreaterThan(0);
    expect(screen.getByText("3 fields ahead of you")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Planned");
    expect(screen.getByText(SAMPLE_REASONS[0]!)).toBeInTheDocument();
  });

  it("a promise past the farmer's last day is called out, not left for the farmer to notice", () => {
    // After "I cannot wait longer" in a full season: last day 2 Nov, best window 5-6 Nov.
    const late: FarmerField = { ...SAMPLE_FIELDS.window, burnDeadlineDate: "2026-11-02", promise: { kind: "window", startDate: "2026-11-05", endDate: "2026-11-06" } };
    renderWithIntl(<SlotView state={ready(late)} />);
    const alert = screen.getAllByRole("alert").find((element) => element.textContent?.includes("No machine can reach you by"));
    expect(alert).toBeDefined();
    expect(alert).toHaveTextContent(/2 November|November 2/);
    expect(alert).toHaveTextContent("Your operator now sees your field marked at risk.");
  });

  it("no warning when the promise is inside the farmer's wait", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.window)} />);
    expect(screen.queryByText(/No machine can reach you by/)).not.toBeInTheDocument();
  });

  it("window promise: shows the window, not a single date", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.window)} />);
    expect(screen.getAllByText("Window").length).toBeGreaterThan(0);
    expect(screen.getByText("The machine comes between")).toBeInTheDocument();
    expect(screen.getByText("Vaari fixes the exact day two days before.")).toBeInTheDocument();
  });

  it("no promise yet: never shows the planned (unpromised) date", () => {
    const { container } = renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.noPromise)} />);
    expect(screen.getAllByText("No date yet").length).toBeGreaterThan(0);
    // plannedDate is 2026-11-06: it must not appear in any form.
    expect(container.textContent).not.toMatch(/November 6|6 November|Nov 6|6 Nov/);
    expect(screen.queryByText(/fields? ahead of you/)).not.toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Booked");
  });

  it("requested: no date and no 'why' until the operator publishes, with the plain reason", () => {
    const { container } = renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.requested, { why: { kind: "none" } })} />);
    expect(screen.getAllByText("Requested").length).toBeGreaterThan(0);
    expect(screen.getByText("Your request is in")).toBeInTheDocument();
    expect(screen.getByText(/your date appears here as soon as they publish a plan/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Why this date" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Firm date|The machine comes/);
    expect(currentStep()).toHaveTextContent("Booked");
  });

  it("a firm date says which machine comes and which stop the field is", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.firm)} />);
    expect(screen.getByText("Super Seeder 2 comes to Balian on Sunday, 1 November. Your field is stop 2 of 3 that day.")).toBeInTheDocument();
  });

  it("after 'I cannot wait longer' the current date stands and the farmer is told it will never move later", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.sooner)} />);
    expect(screen.getByText("You asked for an earlier date")).toBeInTheDocument();
    expect(screen.getByText(/it will never move later/)).toBeInTheDocument();
    expect(screen.getByText("The machine comes between")).toBeInTheDocument();
  });

  it("on the way: firm date is today", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.onTheWay)} />);
    expect(currentStep()).toHaveTextContent("On the way");
  });

  it("done: sown, no waiting action", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.done)} />);
    expect(screen.getAllByText("Sown").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "I cannot wait longer" })).not.toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Done");
  });

  it("moved promise shows the notice", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.broken)} />);
    expect(screen.getByText("Your date had to change. Here is your new date and the reason.")).toBeInTheDocument();
  });

  it("reason loading and unavailable", () => {
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.firm, { why: { kind: "loading" } })} />);
    expect(screen.getByText("Asking the planner…")).toBeInTheDocument();
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.firm, { why: { kind: "error" } })} />);
    expect(screen.getByText("The reason is not available right now.")).toBeInTheDocument();
  });

  it("'I cannot wait longer' asks for a shorter wait and sends it", async () => {
    const onCannotWait = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.firm, { onCannotWait })} />);
    await userEvent.click(screen.getByRole("button", { name: "I cannot wait longer" }));
    const dialog = screen.getByRole("dialog", { name: "How long can you wait now?" });
    const slider = within(dialog).getByRole("slider", { name: "Days you can wait after harvest" });
    expect(slider).toHaveAttribute("max", "4"); // current limit is 5: only shorter is allowed
    fireEvent.change(slider, { target: { value: "2" } });
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringMatching(/^2 days, until/));
    await userEvent.click(within(dialog).getByRole("button", { name: "Update my turn" }));
    await waitFor(() => expect(onCannotWait).toHaveBeenCalledWith(2));
  });

  it("'I cannot wait longer' shows a failure without closing", async () => {
    const onCannotWait = vi.fn().mockRejectedValue(new Error("409"));
    renderWithIntl(<SlotView state={ready(SAMPLE_FIELDS.firm, { onCannotWait })} />);
    await userEvent.click(screen.getByRole("button", { name: "I cannot wait longer" }));
    await userEvent.click(screen.getByRole("button", { name: "Update my turn" }));
    expect(await screen.findByText("Could not update. Please try again.")).toBeInTheDocument();
  });

  it.each(["pa", "hi"] as const)("renders every state in %s with no missing text", (locale) => {
    for (const field of Object.values(SAMPLE_FIELDS)) renderWithIntl(<SlotView state={ready(field)} />, locale);
    for (const kind of ["loading", "invalid", "forbidden", "notFound"] as const) renderWithIntl(<SlotView state={{ kind }} />, locale);
    renderWithIntl(<SlotView state={{ kind: "unavailable", onRetry: () => undefined }} />, locale);
    expect(screen.getAllByText(locale === "pa" ? "ਪੱਕੀ ਤਰੀਕ" : "पक्की तारीख़").length).toBeGreaterThan(0);
  });

  it("timeline step follows the promise, never the plan", () => {
    expect(timelineStep(SAMPLE_FIELDS.noPromise, SAMPLE_TODAY)).toBe("booked");
    expect(timelineStep(SAMPLE_FIELDS.requested, SAMPLE_TODAY)).toBe("booked");
    expect(timelineStep(SAMPLE_FIELDS.window, SAMPLE_TODAY)).toBe("planned");
    expect(timelineStep(SAMPLE_FIELDS.onTheWay, SAMPLE_TODAY)).toBe("onTheWay");
    expect(timelineStep(SAMPLE_FIELDS.onTheWay, null)).toBe("planned");
    expect(timelineStep(SAMPLE_FIELDS.done, SAMPLE_TODAY)).toBe("done");
  });
});
