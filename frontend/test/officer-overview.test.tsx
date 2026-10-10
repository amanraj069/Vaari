/**
 * The officer's dashboard: the one-line answer and tiles come from the overview's counts, villages
 * at burn risk are named (villages, never farmers), every centre is in the table with its plan
 * state, the next ten days are readable without hovering (a table), and the empty and error
 * states are their own. The village helper's overview counts its bookings the same way.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FacilitatorBookingsView } from "@/components/views/facilitator-bookings";
import { OfficerOverviewView } from "@/components/views/officer-overview";
import { SAMPLE_BOOKED, SAMPLE_TODAY } from "@/lib/samples";
import type { OfficerOverview } from "@/shared";
import { renderWithIntl } from "./render";

const counts = {
  machinesWorking: 3,
  machinesTotal: 4,
  fieldsActive: 9,
  acresActive: 31.5,
  fieldsSown: 2,
  promisesOpen: 7,
  promisesOnTrack: 6,
  promisesKept: 2,
  promisesBroken: 1,
  burnRisk: 2,
  tight: 1,
  waitingForDate: 2,
};
const village = { centreId: "chc-balian", fieldsSown: 0, tight: 0, burnRisk: 0 };
const OVERVIEW: OfficerOverview = {
  today: SAMPLE_TODAY,
  optimumLastDate: "2026-11-15",
  totals: { ...counts, centres: 1, villages: 12 },
  centres: [{ ...counts, id: "chc-balian", name: "Balian Cooperative Society", villageCount: 12, lat: 30.3, lon: 75.9, planDate: "2026-11-01", draftWaiting: true, maxDelayVsQueueDays: 2 }],
  villages: [
    { ...village, id: "v1", name: "Ubhawal", lat: 30.31, lon: 75.92, fieldsActive: 4, acresActive: 14, burnRisk: 2, tight: 1 },
    { ...village, id: "v2", name: "Balian", lat: 30.3, lon: 75.9, fieldsActive: 5, acresActive: 17.5 },
  ],
  sowingAhead: Array.from({ length: 10 }, (_, index) => ({ date: `2026-11-${String(index + 1).padStart(2, "0")}`, fields: index < 3 ? 3 - index : 0, acres: index < 3 ? 10 - index : 0 })),
  districts: [{ name: "Sangrur", rings: [[[75.8, 30.2], [76.0, 30.2], [76.0, 30.4], [75.8, 30.4], [75.8, 30.2]]] }],
};

function serve(byPath: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.entries(byPath).find(([path]) => url.includes(path));
      const answer = match?.[1] ?? { status: 404, body: { error: "NOT_RUN" } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }),
  );
}

function renderWith(ui: React.ReactElement, locale: "en" | "pa" | "hi" = "en") {
  return renderWithIntl(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>, locale);
}

afterEach(() => vi.unstubAllGlobals());

describe("officer overview", () => {
  it("answers first, from the counts: machines, promises, burn risk and where", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />);
    expect(await screen.findByText(/1 machine centre, 3 of 4 machines working tomorrow\./)).toBeInTheDocument();
    expect(screen.getByText(/7 promises open, 6 on track\./)).toBeInTheDocument();
    expect(screen.getByText("2 fields at burn risk, in Ubhawal.")).toBeInTheDocument();
    expect(screen.getByText(/1 centre has a re-plan waiting for its operator\./)).toBeInTheDocument();
    expect(screen.getByText("6/7")).toBeInTheDocument();
    expect(screen.getByText("Sangrur · every machine centre")).toBeInTheDocument();
  });

  it("lists every centre with its plan state, and the next ten days as a table", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />);
    const table = await screen.findByRole("table", { name: "Machine centres" });
    expect(within(table).getByRole("rowheader", { name: /Balian Cooperative Society/ })).toBeInTheDocument();
    expect(within(table).getByText("Re-plan waiting")).toBeInTheDocument();
    const ahead = screen.getByRole("table", { name: "Sowing ahead" });
    expect(within(ahead).getAllByRole("row")).toHaveLength(11);
    // Villages are named; the map describes each one in words.
    expect(screen.getByRole("img", { name: /Ubhawal: 4 active fields, 14 acres, 2 at burn risk, 1 tight/ })).toBeInTheDocument();
  });

  it("has its own empty and error states", async () => {
    serve({ "officer/overview": { status: 200, body: { ...OVERVIEW, centres: [], villages: [], totals: { ...OVERVIEW.totals, centres: 0 } } } });
    const empty = renderWith(<OfficerOverviewView />);
    expect(await screen.findByText("No machine centres yet")).toBeInTheDocument();
    empty.unmount();
    serve({ "officer/overview": { status: 503, body: { error: "API_UNAVAILABLE" } } });
    renderWith(<OfficerOverviewView />);
    expect(await screen.findByText("We could not load this")).toBeInTheDocument();
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", async (locale) => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />, locale);
    expect(await screen.findAllByRole("table")).not.toHaveLength(0);
  });
});

describe("village helper's bookings overview", () => {
  it("counts firm dates, windows, no date yet and fields close to the last day", async () => {
    serve({ "facilitator/fields": { status: 200, body: { today: SAMPLE_TODAY, items: SAMPLE_BOOKED } } });
    renderWith(<FacilitatorBookingsView />);
    // The numbers: one firm date, one window, one with no date yet, one close to its last day.
    await screen.findByText("Paramjit Kaur");
    const strip = screen.getByLabelText("Your bookings in numbers");
    for (const [label, value] of [["Firm date", "1"], ["Window", "1"], ["Waiting for a date", "1"], ["Close to the last day", "1"]] as const) {
      expect(within(strip).getByText(label).parentElement).toHaveTextContent(value);
    }
    // With bookings, no sentence repeats the numbers, and at three bookings "how booking works" is gone.
    expect(screen.queryByText("Book your first farmer")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "How booking works" })).not.toBeInTheDocument();
    // The ring and its legend give every status in words.
    expect(screen.getByRole("img", { name: "1 with a firm date, 1 with a window, 1 with no date yet" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Book a field" })[0]).toHaveAttribute("href", "/dashboard/book");
    expect(screen.getByText("Paramjit Kaur")).toBeInTheDocument();
  });
});
