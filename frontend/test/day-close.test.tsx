/**
 * The operator's day: today's fields are ticked as sown by default and an untick sends "not sown";
 * the card is gone once the day is recorded or nothing was planned; the header's "Start tomorrow"
 * is hidden until today is recorded, disabled with its reason while a plan waits for approval, and
 * asks first, because the day moves for every centre.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayClose, StartDay } from "@/components/operator/day-close";
import type { DayView } from "@/shared";
import { renderWithIntl } from "./render";

const stop = { token: 17, farmerName: "Jaswinder Singh", villageName: "Balian", acres: 6, machineName: "Super Seeder 1", hours: 5.5 };
const TODAY: DayView = {
  date: "2026-11-01",
  nextDate: "2026-11-02",
  closed: false,
  stops: [
    { ...stop, fieldId: "f-1" },
    { ...stop, fieldId: "f-2", token: 18, farmerName: "Gurpreet Kaur" },
  ],
  blockedBy: "record",
  canStart: true,
};

const calls: { url: string; body: string }[] = [];
function serve() {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ error: "NOT_IN_TEST" }), { status: 500, headers: { "content-type": "application/json" } });
    }),
  );
}
const render = (day: DayView) =>
  renderWithIntl(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <DayClose day={day} />
      <StartDay day={day} />
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("the operator's day", () => {
  it("records today's fields, sown unless unticked", async () => {
    serve();
    render(TODAY);
    expect(screen.getByRole("heading", { name: "Today, Sunday, 1 November" })).toBeInTheDocument();
    const second = screen.getByRole("checkbox", { name: /#018 Gurpreet Kaur/ });
    expect(second).toBeChecked();
    fireEvent.click(second);
    expect(within(second.closest("label")!).getByText("Not sown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save today's work" }));
    await waitFor(() => expect(calls[0]).toMatchObject({ url: expect.stringContaining("operator/day/record"), body: JSON.stringify({ outcomes: [{ fieldId: "f-1", sown: true }, { fieldId: "f-2", sown: false }] }) }));
    // Tomorrow cannot start while today is unrecorded: no start button yet.
    expect(screen.queryByRole("button", { name: /^Start / })).not.toBeInTheDocument();
  });

  it("shows no card once today is recorded or when nothing was planned", () => {
    serve();
    const recorded = render({ ...TODAY, closed: true, blockedBy: null });
    expect(screen.queryByRole("heading", { name: /^Today,/ })).not.toBeInTheDocument();
    recorded.unmount();
    render({ ...TODAY, stops: [], closed: false, blockedBy: null });
    expect(screen.queryByRole("heading", { name: /^Today,/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Monday, 2 November" })).toBeEnabled();
  });

  it("hides the start button from an operator who cannot move the season", () => {
    serve();
    render({ ...TODAY, closed: true, blockedBy: null, canStart: false });
    expect(screen.queryByRole("button", { name: /^Start / })).not.toBeInTheDocument();
  });

  it("waits for tomorrow's plan to be approved, then asks before starting the next day", async () => {
    serve();
    const waiting = render({ ...TODAY, closed: true, blockedBy: "approve" });
    const blocked = screen.getByRole("button", { name: "Start Monday, 2 November" });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription("Approve tomorrow's plan to start tomorrow.");
    waiting.unmount();
    render({ ...TODAY, closed: true, blockedBy: null });
    fireEvent.click(screen.getByRole("button", { name: "Start Monday, 2 November" }));
    const dialog = await screen.findByRole("dialog", { name: "Start Monday, 2 November?" });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the day" }));
    await waitFor(() => expect(calls[0]?.url).toContain("operator/day/next"));
  });
});
