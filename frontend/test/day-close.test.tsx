/**
 * The operator's day card: today's fields are ticked as sown by default and an untick sends "not
 * sown"; tomorrow cannot start while a plan waits for approval; starting asks first, because the
 * day moves for every centre.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayClose } from "@/components/operator/day-close";
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
const render = (day: DayView) => renderWithIntl(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><DayClose day={day} /></QueryClientProvider>);

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

  it("waits for tomorrow's plan to be approved, then asks before starting the next day", async () => {
    serve();
    const waiting = render({ ...TODAY, closed: true, blockedBy: "approve" });
    expect(screen.getByRole("button", { name: "Start Monday, 2 November" })).toBeDisabled();
    expect(screen.getByText(/Approve tomorrow's plan to start tomorrow\./)).toBeInTheDocument();
    waiting.unmount();
    render({ ...TODAY, closed: true, blockedBy: null });
    fireEvent.click(screen.getByRole("button", { name: "Start Monday, 2 November" }));
    const dialog = await screen.findByRole("dialog", { name: "Start Monday, 2 November?" });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the day" }));
    await waitFor(() => expect(calls[0]?.url).toContain("operator/day/next"));
  });
});
