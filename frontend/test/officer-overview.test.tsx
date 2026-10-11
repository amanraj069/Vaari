/**
 * The officer's two pages. District (/dashboard): one sentence from the counts and the outlook, the
 * map (centres are buttons; all bookings by default, critical only on request) and
 * beside it what to do (loans, standbys); choosing a centre in the list or on the map shows its
 * facts. Centres (/dashboard/centres): the numbers, the harvest wave readable without hovering (a
 * table), every centre worst outlook first, villages to watch. Centres are named, farmers never;
 * the empty and error states are their own. The village helper's overview counts its bookings the same way.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FacilitatorBookingsView } from "@/components/views/facilitator-bookings";
import { OfficerCentresView } from "@/components/views/officer-centres";
import { OfficerFleetView } from "@/components/views/officer-fleet";
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
  totals: { ...counts, centres: 10, villages: 12 },
  centres: [
    { ...counts, district: "Sangrur", fleet: { own: 4, superSeeders: 3, happySeeders: 1, inWorkshop: 1, lentOut: 0, borrowedIn: 0, acresBookedSeason: 300 }, id: "chc-balian", name: "Balian Cooperative Society", villageCount: 12, lat: 30.3, lon: 75.9, planDate: "2026-11-01", draftWaiting: true, maxDelayVsQueueDays: 2, outlook: { lateAcres: 12.4, lateIfOneDownAcres: 40, lateIfOneMoreAcres: 0, capacityAcresPerDay: 19.9, waitingAcres: 20 } },
    { ...counts, burnRisk: 0, district: "Sangrur", fleet: { own: 4, superSeeders: 3, happySeeders: 1, inWorkshop: 1, lentOut: 0, borrowedIn: 0, acresBookedSeason: 600 }, id: "chc-sim-03", name: "Rajpura CHC", villageCount: 20, lat: 30.27, lon: 76.13, planDate: "2026-11-01", draftWaiting: false, maxDelayVsQueueDays: 0, outlook: { lateAcres: 0, lateIfOneDownAcres: 0, lateIfOneMoreAcres: 0, capacityAcresPerDay: 33.2, waitingAcres: 10 } },
    { ...counts, burnRisk: 0, district: "Sangrur", fleet: { own: 4, superSeeders: 3, happySeeders: 1, inWorkshop: 1, lentOut: 0, borrowedIn: 0, acresBookedSeason: 200 }, id: "chc-sim-11", name: "Dudian CHC", villageCount: 18, lat: 29.88, lon: 75.94, planDate: "2026-11-01", draftWaiting: false, maxDelayVsQueueDays: 0, outlook: { lateAcres: 0, lateIfOneDownAcres: 23, lateIfOneMoreAcres: 0, capacityAcresPerDay: 33.2, waitingAcres: 10 } },
    ...Array.from({ length: 7 }, (_, index) => ({ ...counts, burnRisk: 0, district: "Sangrur", fleet: { own: 4, superSeeders: 3, happySeeders: 1, inWorkshop: 1, lentOut: 0, borrowedIn: 0, acresBookedSeason: 100 }, id: `chc-sim-2${index}`, name: `Quiet ${index} CHC`, villageCount: 9, lat: 30, lon: 75.8, planDate: "2026-11-01", draftWaiting: false, maxDelayVsQueueDays: 0, outlook: { lateAcres: 0, lateIfOneDownAcres: 0, lateIfOneMoreAcres: 0, capacityAcresPerDay: 20, waitingAcres: 0 } })),
  ],
  villages: [
    { ...village, id: "v1", name: "Ubhawal", lat: 30.31, lon: 75.92, fieldsActive: 4, acresActive: 14, burnRisk: 2, tight: 1 },
    { ...village, id: "v2", name: "Balian", lat: 30.3, lon: 75.9, fieldsActive: 5, acresActive: 17.5 },
  ],
  outlook: {
    days: Array.from({ length: 10 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, "0")}`,
      readyBookedAcres: index < 3 ? 30 - index * 10 : 0,
      readyExpectedAcres: index === 5 ? 160 : 20,
      capacityAcres: 80,
      plannedAcres: index < 3 ? 25 : 0,
      waitingAcres: index === 6 ? 150 : 40,
    })),
    lateAcres: 12.4,
    moves: [{ fromCentreId: "chc-sim-03", toCentreId: "chc-balian", distanceKm: 12, lateBeforeAcres: 12.4, lateAfterAcres: 0 }],
    extraMachines: [],
    loans: [],
    assumptions: { acresPerMachineSeason: 140, waitingLimitMinDays: 3, waitingLimitMaxDays: 10, acresPerMachineDay: 6.6, maxLendKm: 30 },
  },
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

describe("officer district (the map page)", () => {
  it("answers in one sentence, from the counts and the outlook, and keeps the detail for the centres page", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />);
    expect(await screen.findByText("2 fields at burn risk, in Ubhawal.")).toBeInTheDocument();
    expect(screen.getByText(/Lend 1 machine and every centre reaches its fields in time through 10 November\./)).toBeInTheDocument();
    expect(screen.getByText("Sangrur · 10 machine centres")).toBeInTheDocument();
    // No table of centres and no chart here: one link away.
    expect(screen.queryByRole("table", { name: "Machine centres" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See all 10 centres/ })).toHaveAttribute("href", "/dashboard/centres");
  });

  it("says what to do, and choosing a loan shows the borrowing centre's facts", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />);
    const actions = await screen.findByRole("region", { name: "What to do" });
    const loan = within(actions).getByRole("button", { name: /Lend one machine from Rajpura to Balian Cooperative Society\./ });
    expect(loan).toHaveTextContent("12 km · 12 → 0 acres late");
    expect(within(screen.getByRole("region", { name: "Keep a standby near" })).getByRole("button", { name: /Dudian/ })).toHaveTextContent("23 acres late if one breaks");
    fireEvent.click(loan);
    const detail = await screen.findByRole("region", { name: "Balian Cooperative Society" });
    expect(within(detail).getByText("Borrow 1 machine from Rajpura, 12 km away. Then no field is late.")).toBeInTheDocument();
    expect(within(detail).getByText("12 acres late")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "What to do" }));
    expect(await screen.findByRole("region", { name: "What to do" })).toBeInTheDocument();
  });

  it("makes every centre on the map a button, and shows all bookings by default, critical only on request", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />);
    const centre = await screen.findByRole("button", { name: "Dudian CHC: Centre: one breakdown away" });
    fireEvent.click(centre);
    expect(await screen.findByRole("region", { name: "Dudian CHC" })).toBeInTheDocument();
    expect(centre).toHaveAttribute("aria-pressed", "true");
    // All bookings shown by default: both villages are on the map.
    expect(screen.getByRole("img", { name: /Ubhawal: 4 active fields, 14 acres, 2 at burn risk, 1 tight/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Balian: 5 active fields/ })).toBeInTheDocument();
    const critical = screen.getByRole("switch", { name: "Show critical only" });
    expect(critical).toHaveAttribute("aria-checked", "false");
    fireEvent.click(critical);
    expect(critical).toHaveAttribute("aria-checked", "true");
    // When critical only is toggled, non-at-risk unselected villages are hidden.
    expect(screen.queryByRole("img", { name: /^Balian: / })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Ubhawal: 4 active fields, 14 acres, 2 at burn risk, 1 tight/ })).toBeInTheDocument();
  });

  it("arranges a suggested loan after saying what it does, and lists loans already arranged with a way to end them", async () => {
    const posted: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("officer/loans")) {
          posted.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
          return new Response(JSON.stringify(init?.method === "DELETE" ? { ended: "x" } : { loanId: "chc-sim-03~m2" }), { status: init?.method === "DELETE" ? 200 : 201, headers: { "content-type": "application/json" } });
        }
        const loans = [{ id: "chc-sim-11~m1", fromChcId: "chc-sim-11", toChcId: "chc-sim-03", machineName: "Super Seeder 1", startDate: "2026-11-01", endDate: "2026-11-10" }];
        return new Response(JSON.stringify({ ...OVERVIEW, outlook: { ...OVERVIEW.outlook, loans } }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    renderWith(<OfficerOverviewView />);
    fireEvent.click(await screen.findByRole("button", { name: "Arrange the loan from Rajpura to Balian Cooperative Society" }));
    const dialog = await screen.findByRole("dialog", { name: "Lend a machine from Rajpura to Balian Cooperative Society?" });
    expect(dialog).toHaveTextContent(/Rajpura sends its machine with the fewest fields booked to Balian Cooperative Society for 1–10 November\./);
    // The officer picks how long; the body follows the choice.
    fireEvent.click(within(dialog).getByLabelText(/^5 days/));
    expect(dialog).toHaveTextContent(/for 1–5 November\./);
    expect(dialog).not.toHaveTextContent(/simulated/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Arrange the loan" }));
    await waitFor(() => expect(posted).toEqual([expect.objectContaining({ method: "POST", body: JSON.stringify({ fromChcId: "chc-sim-03", toChcId: "chc-balian", days: 5 }) })]));
    // The arranged loan is listed and drawn; ending it asks first.
    const loans = screen.getByRole("region", { name: "Machines on loan" });
    expect(within(loans).getByText("Super Seeder 1 · 1–10 November")).toBeInTheDocument();
    expect(screen.getByText("Machine on loan")).toBeInTheDocument();
    fireEvent.click(within(loans).getByRole("button", { name: "End loan" }));
    const end = await screen.findByRole("dialog", { name: "Send Super Seeder 1 back to Dudian?" });
    fireEvent.click(within(end).getByRole("button", { name: "End loan" }));
    await waitFor(() => expect(posted.at(-1)).toMatchObject({ method: "DELETE", url: expect.stringContaining("officer/loans/chc-sim-11~m1") }));
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
    expect(await screen.findAllByRole("button")).not.toHaveLength(0);
  });
});

describe("officer centres page", () => {
  it("gives the numbers, the harvest wave as a table, centres worst outlook first (eight, then all), and villages", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerCentresView />);
    const numbers = await screen.findByLabelText("District numbers");
    expect(within(numbers).getByText("Acres late by 10 November").parentElement).toHaveTextContent("12");
    expect(within(numbers).getByText("6/7")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Machine centres" });
    const rows = within(table).getAllByRole("rowheader");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("Balian Cooperative Society");
    expect(rows[1]).toHaveTextContent("Dudian CHC");
    expect(within(table).getByText("Re-plan waiting")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Show all 10 centres (2 more)" })[0]!);
    await waitFor(() => expect(within(table).getAllByRole("rowheader")).toHaveLength(10));
    expect(within(screen.getByRole("table", { name: "The harvest wave against the machines" })).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText(/Most fields become ready on Fri 6 November: 160 acres, 2× what the machines can sow that day \(80 acres\)\./)).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Villages to watch" })).getByRole("rowheader", { name: /Ubhawal/ })).toBeInTheDocument();
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", async (locale) => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerCentresView />, locale);
    expect(await screen.findAllByRole("table")).not.toHaveLength(0);
  });
});

describe("officer machines page", () => {
  it("counts the officer's district's machines by centre, most load per machine first", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerFleetView />);
    const numbers = await screen.findByLabelText("The district's machines");
    expect(within(numbers).getByText("Machines").parentElement).toHaveTextContent("40");
    expect(within(numbers).getByText("In the workshop").parentElement).toHaveTextContent("10");
    // An officer runs one district, so the page never splits or names districts.
    expect(screen.queryByRole("region", { name: "By district" })).not.toBeInTheDocument();
    expect(screen.queryByText("Malerkotla")).not.toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "By centre, most load per machine first" })).getAllByRole("rowheader");
    // Rajpura: 600 acres over 4 machines = 150 a machine, the most.
    expect(rows[0]).toHaveTextContent("Rajpura CHC");
    expect(screen.getAllByText("150 ac")[0]).toBeInTheDocument();
  });

  it("asks before arranging a loan from a centre's own facts too", async () => {
    serve({ "officer/overview": { status: 200, body: OVERVIEW } });
    renderWith(<OfficerOverviewView />);
    fireEvent.click(await screen.findByRole("button", { name: "Balian Cooperative Society: Centre: fields late" }));
    const detail = await screen.findByRole("region", { name: "Balian Cooperative Society" });
    fireEvent.click(within(detail).getByRole("button", { name: "Arrange" }));
    expect(await screen.findByRole("dialog", { name: "Lend a machine from Rajpura to Balian Cooperative Society?" })).toBeInTheDocument();
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
