/**
 * The operator's fleet page: every machine says in a word where it is tomorrow (working, in the
 * workshop, lent to another centre, borrowed from one), a machine on loan offers no workshop or
 * remove buttons (the officer ends a loan), adding a machine posts its name and kind, removing one
 * asks first, and a waiting re-plan points to the plan page.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperatorMachinesView } from "@/components/views/operator-machines";
import type { OperatorMachines } from "@/shared";
import { renderWithIntl } from "./render";

const base = { kind: "super_seeder" as const, promiseAcresPerDay: 6.6, planAcresPerDay: 8.7, logsCount: 0, downDates: [], plannedFields: 3, plannedAcres: 10.5, removable: true, loan: null, status: "working" as const };
const FLEET: OperatorMachines = {
  chc: { id: "chc-balian", name: "Balian Cooperative Society" },
  today: "2026-10-31",
  draftWaiting: true,
  machines: [
    { ...base, id: "m1", name: "Super Seeder 1" },
    { ...base, id: "m2", name: "Super Seeder 2", status: "down", downDates: ["2026-11-01", "2026-11-02"] },
    { ...base, id: "m3", name: "Super Seeder 3", status: "away", removable: false, plannedFields: 0, plannedAcres: 0, loan: { direction: "out", centreName: "Bhikhi CHC", startDate: "2026-11-01", endDate: "2026-11-10" } },
    { ...base, id: "loan-chc-sim-12-m2", name: "Super Seeder 2", removable: false, loan: { direction: "in", centreName: "Rattoke CHC", startDate: "2026-11-01", endDate: "2026-11-10" } },
  ],
};

const calls: { url: string; method: string; body: string }[] = [];
function serve() {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return new Response(JSON.stringify(FLEET), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
    }),
  );
}
const renderPage = () => renderWithIntl(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OperatorMachinesView /></QueryClientProvider>);

afterEach(() => vi.unstubAllGlobals());

describe("operator machines", () => {
  it("says where each machine is, and a machine on loan has no workshop or remove buttons", async () => {
    serve();
    renderPage();
    const cards = await screen.findAllByRole("listitem");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText("Working tomorrow")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("In the workshop")).toBeInTheDocument();
    expect(within(cards[1]!).getByRole("button", { name: "Back in work" })).toBeInTheDocument();
    expect(within(cards[2]!).getByText("Lent to Bhikhi CHC")).toBeInTheDocument();
    expect(within(cards[2]!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(cards[3]!).getByText("Borrowed from Rattoke CHC")).toBeInTheDocument();
    expect(within(cards[3]!).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check and approve" })).toHaveAttribute("href", "/dashboard/plan");
  });

  it("adds a machine by name and kind, and removes one only after asking", async () => {
    serve();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
    const add = await screen.findByRole("dialog", { name: "Add a machine" });
    fireEvent.change(within(add).getByLabelText("Name"), { target: { value: "Rented Happy Seeder" } });
    fireEvent.click(within(add).getByLabelText("Happy Seeder"));
    fireEvent.click(within(add).getByRole("button", { name: "Add machine" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")).toMatchObject({ body: JSON.stringify({ name: "Rented Happy Seeder", kind: "happy_seeder" }) }));

    fireEvent.click(within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Super Seeder 1?" });
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove machine" }));
    await waitFor(() => expect(calls.find((call) => call.method === "DELETE")?.url).toContain("operator/machines/m1"));
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", async (locale) => {
    serve();
    renderWithIntl(<QueryClientProvider client={new QueryClient()}><OperatorMachinesView /></QueryClientProvider>, locale);
    expect(await screen.findAllByRole("listitem")).toHaveLength(4);
  });
});
