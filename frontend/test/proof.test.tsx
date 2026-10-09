/**
 * /proof shows only what the simulator wrote: an empty state when there is no results file, an
 * error when it is unreadable, and with the real data/sim/results.json every number on the page
 * comes from that file (checked against it here), in English, Punjabi and Hindi.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProofPage from "@/app/proof/page";
import { bestPolicy, countOutcomes, formatNumber, outcomeOf, rankPolicies, reductionVsQueue, sweepValueLabel } from "@/lib/proof";
import { proofResultsSchema, type ProofResults } from "@/shared";
import { renderWithIntl } from "./render";

const RESULTS = proofResultsSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../data/sim/results.json"), "utf8")));

function serve(proof: { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const answer = url.includes("/api/proxy/public/proof") ? proof : { status: 200, body: { signedIn: false } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }),
  );
}

function renderPage(locale: "en" | "pa" | "hi" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <ProofPage />
    </QueryClientProvider>,
    locale,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("/proof", () => {
  it("shows a calm 'not available' state, never placeholder numbers or a command, when there are no results", async () => {
    serve({ status: 404, body: { error: "NOT_RUN" } });
    renderPage();
    expect(await screen.findByText("Results are not available right now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/npm run|--runs|results file|cd backend/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the same calm state when the results cannot be read", { timeout: 15000 }, async () => {
    serve({ status: 500, body: { error: "RESULTS_INVALID" } });
    renderPage();
    // The page retries a failed load twice (with back-off) before giving up.
    expect(await screen.findByText("Results are not available right now", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText(/npm run|--runs|results file|cd backend|schema/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders every number from the results file", async () => {
    serve({ status: 200, body: RESULTS });
    renderPage();
    const base = RESULTS.scenarios.base;
    // The hero's third line is the measured difference: farmers who burned, summed over every season.
    const fewer = reductionVsQueue(base.totals.fieldsLate, "vaari")!;
    const hero = await screen.findByRole("heading", { level: 1, name: /^Same seasons/ });
    expect(hero).toHaveTextContent(fewer > 0 ? `${fewer}% fewer farmers burn.` : "The difference, measured.");
    expect(screen.getByText(new RegExp(`${RESULTS.runs} seasons across ${base.centres} machine centres: ${formatNumber(base.fieldsPerSeason, "fields")} farmers and ${base.machines} Super Seeders`))).toBeInTheDocument();
    // Takeaways: waiting days and PM2.5 from the base season's medians.
    const wait = base.results.medianWaitDays;
    // The waiting takeaway claims shorter waits only when they are; otherwise the slot shows the centre's income.
    const days = (value: number) => `${formatNumber(value, "days")} day${Number(formatNumber(value, "days")) === 1 ? "" : "s"}`;
    const income = base.results.incomePerMachineRupees;
    if (wait.vaari!.median < wait.phone_queue!.median || income.vaari!.median <= income.phone_queue!.median) {
      expect(screen.getByText(new RegExp(`waits ${days(wait.vaari!.median)} after harvest with Vaari, against ${days(wait.phone_queue!.median)} with a phone queue`))).toBeInTheDocument();
    } else {
      expect(screen.getByText("More income per machine")).toBeInTheDocument();
      expect(screen.queryByText("Shorter waits")).not.toBeInTheDocument();
      expect(screen.getByText(new RegExp(`₹${formatNumber(income.vaari!.median, "rupees")} per machine in the median season with Vaari`))).toBeInTheDocument();
    }
    // The season-by-season share still feeds the first takeaway; its own chart is gone.
    const paired = base.pairedWithQueue.fieldsLate.vaari;
    expect(screen.getByText(new RegExp(`fewer in ${formatNumber(paired.betterPct, "percent")}% of seasons`))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Season by season against the phone queue" })).not.toBeInTheDocument();
    // Every source with a link opens it.
    const ceew = screen.getAllByRole("link", { name: /CEEW, Custom Hiring Centres/ })[0]!;
    expect(ceew).toHaveAttribute("href", expect.stringContaining("ceew.in"));

    const table = screen.getByRole("table", { name: new RegExp(`Median over ${RESULTS.runs} simulated seasons`) });
    // Every row's numbers come from the file; distance is not shown (driving less is not a better season for a farmer).
    const pm25Row = within(table).getByRole("row", { name: /PM2.5 from the fires/ });
    for (const policy of ["phone_queue", "nearest", "vaari"] as const) {
      expect(pm25Row).toHaveTextContent(`${formatNumber(RESULTS.scenarios.base.results.pm25Kg[policy]!.median, "kg")} kg`);
    }
    expect(within(table).queryByRole("row", { name: /Kilometres driven/ })).not.toBeInTheDocument();
    // The best median in a row is named for screen readers, not only coloured.
    const best = bestPolicy(RESULTS, "pm25Kg", RESULTS.scenarios.base.results.pm25Kg)!;
    expect(within(pm25Row).getAllByRole("cell")[["phone_queue", "nearest", "vaari"].indexOf(best)]).toHaveTextContent(/, Best/);
    // The baselines make no promises: said in words, not as a number.
    expect(within(within(table).getByRole("row", { name: /Promises kept/ })).getAllByText("No promises made")).toHaveLength(2);
    // Days without a date replace the relative delay; every policy has a value, ranked.
    const noDate = within(table).getByRole("row", { name: /Days a farmer waits without a date/ });
    for (const policy of ["phone_queue", "nearest", "vaari"] as const) {
      expect(noDate).toHaveTextContent(formatNumber(RESULTS.scenarios.base.results.daysWithoutDate[policy]!.median, "days"));
    }
    expect(within(table).queryByRole("row", { name: /Worst delay/ })).not.toBeInTheDocument();

    // How the season ended, one map per way of working, with no play control; the counts match the file.
    expect(screen.queryByRole("button", { name: /Play the season/ })).not.toBeInTheDocument();
    for (const [policy, name] of [["phone_queue", "Phone queue"], ["nearest", "Nearest village next"], ["vaari", "Vaari"]] as const) {
      const counts = countOutcomes(RESULTS.replay, policy);
      expect(counts.unresolved).toBe(0);
      expect(counts.onTime + counts.late + counts.burned).toBe(RESULTS.replay.fields.length);
      expect(screen.getByRole("img", { name: new RegExp(`^${name}: ${formatNumber(counts.onTime, "fields")} fields sown by .*, ${formatNumber(counts.late, "fields")} sown after it, ${counts.burned} burned$`) })).toBeInTheDocument();
    }
    expect(screen.getByText(`cd backend && ${RESULTS.generatedBy}`)).toBeInTheDocument();
  });

  it("measures the base season only, switches sweeps, and every value shown comes from the file", async () => {
    serve({ status: 200, body: RESULTS });
    renderPage();
    const table = await screen.findByRole("table", { name: new RegExp(`Median over ${RESULTS.runs} simulated seasons`) });
    // Only the base season is measured on the page: no season switch.
    const base = RESULTS.scenarios.base;
    expect(screen.getByText(`Sangrur district: ${base.centres} centres, ${base.machines} machines, ${formatNumber(base.fieldsPerSeason, "fields")} farmers`)).toBeInTheDocument();
    // The headline's assumption is stated under the lead, with the number from the file.
    const days = Number(RESULTS.assumptions.inputs.daysSoonerWithoutDate!.value);
    if (days > 0) expect(screen.getByText(new RegExp(`gives up ${days} days? sooner than one holding a date`))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Direct transfers|Too few machines/ })).not.toBeInTheDocument();
    const lateRow = within(table).getByRole("row", { name: /Farmers not reached by their last waiting day/ });
    expect(lateRow).toHaveTextContent(formatNumber(base.results.fieldsLate.phone_queue!.median, "fields"));

    // The sweep starts on the first sweep in the file; the toggle switches it, and the table follows.
    const [first, second] = RESULTS.sweeps;
    expect(screen.getByRole("button", { name: "How busy the season is" })).toHaveAttribute("aria-pressed", "true");
    expect(first!.parameter).toBe("acresPerMachine");
    fireEvent.click(screen.getByRole("button", { name: "How long farmers wait" }));
    expect(second!.parameter).toBe("waitingLimitDays");
    const numbers = screen.getByRole("region", { name: "Show the numbers: How long farmers wait" });
    const lastPoint = second!.points.at(-1)!;
    const vaari = lastPoint.results.fieldsLatePct.vaari!;
    expect(within(numbers).getByRole("row", { name: new RegExp(`^${sweepValueLabel(second!.parameter, lastPoint.value)} `) })).toHaveTextContent(`${formatNumber(vaari.median, "percent")}%`);
    // Shares are shown as percentages on the late-returns sweep.
    fireEvent.click(screen.getByRole("button", { name: "Rentals that come back late" }));
    expect(screen.getByRole("region", { name: "Show the numbers: Rentals that come back late" })).toHaveTextContent("50%");

    // Inputs: the field-size mean is computed from the file's list, not typed.
    const sizes = (RESULTS.assumptions.inputs.fieldAcres!.values ?? []) as number[];
    const mean = Math.round((sizes.reduce((sum, item) => sum + item, 0) / sizes.length) * 10) / 10;
    expect(screen.getByText(new RegExp(`Each farmer books ${Math.min(...sizes)}–${Math.max(...sizes)} acres, ${mean} on average`))).toBeInTheDocument();
  });

  it.each(["pa", "hi"] as const)("renders the full page in %s with no missing text", async (locale) => {
    serve({ status: 200, body: RESULTS });
    renderPage(locale);
    expect(await screen.findAllByRole("table")).not.toHaveLength(0);
  });
});

describe("proof helpers", () => {
  const field = RESULTS.replay.fields.find((item) => item.sownDay.vaari !== null)!;

  it("a season ends sown by the optimum, sown after it, or burned", () => {
    const optimum = RESULTS.replay.optimumLastDay;
    const none = { phone_queue: null, nearest: null, vaari: null };
    expect(outcomeOf({ ...field, sownDay: { ...none, vaari: optimum }, burnedDay: none }, "vaari", optimum)).toBe("onTime");
    expect(outcomeOf({ ...field, sownDay: { ...none, vaari: optimum + 1 }, burnedDay: none }, "vaari", optimum)).toBe("late");
    expect(outcomeOf({ ...field, sownDay: none, burnedDay: { ...none, vaari: field.burnDeadline } }, "vaari", optimum)).toBe("burned");
    expect(outcomeOf({ ...field, sownDay: none, burnedDay: none }, "vaari", optimum)).toBe("unresolved");
  });

  it("marks no best on the delay measure, and none on a tie", () => {
    const results = RESULTS as ProofResults;
    expect(bestPolicy(results, "worstDelayVsQueueDays", results.scenarios.base.results.worstDelayVsQueueDays)).toBeNull();
    const tie = { median: 1, p10: 0, p90: 2 };
    expect(bestPolicy(results, "kmDriven", { phone_queue: tie, nearest: tie, vaari: tie })).toBeNull();
    expect(bestPolicy(results, "kmDriven", { phone_queue: { ...tie, median: 3 }, nearest: tie, vaari: { ...tie, median: 2 } })).toBe("nearest");
  });

  it("ranks each row best, second and worst, with ties sharing a place and no ranking where it is unfair", () => {
    const results = RESULTS as ProofResults;
    const cell = (median: number) => ({ median, p10: median, p90: median });
    // Lower is better for kilometres; higher is better for income.
    expect(rankPolicies(results, "kmDriven", { phone_queue: cell(3), nearest: cell(1), vaari: cell(2) })).toEqual({ phone_queue: "worst", nearest: "best", vaari: "second" });
    expect(rankPolicies(results, "incomePerMachineRupees", { phone_queue: cell(3), nearest: cell(1), vaari: cell(2) })).toEqual({ phone_queue: "best", nearest: "worst", vaari: "second" });
    expect(rankPolicies(results, "kmDriven", { phone_queue: cell(2), nearest: cell(1), vaari: cell(1) })).toEqual({ phone_queue: "worst", nearest: "best", vaari: "best" });
    const none = { phone_queue: null, nearest: null, vaari: null };
    expect(rankPolicies(results, "kmDriven", { phone_queue: cell(1), nearest: cell(1), vaari: cell(1) })).toEqual(none);
    // No promises made is worst: the farmer gets no date at all.
    expect(rankPolicies(results, "promisesKeptPct", { phone_queue: null, nearest: null, vaari: cell(90) })).toEqual({ phone_queue: "worst", nearest: "worst", vaari: "best" });
    expect(rankPolicies(results, "worstDelayVsQueueDays", { phone_queue: cell(0), nearest: cell(8), vaari: cell(8) })).toEqual(none);
  });

  it("formats numbers in Indian grouping", () => {
    expect(formatNumber(256508, "rupees")).toBe("2,56,508");
    expect(formatNumber(95.75, "acres")).toBe("95.8");
  });
});
