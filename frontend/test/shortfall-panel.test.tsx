/** /proof's capacity-shortfall panel: shown only when the results file has the scenario, every number from the file. */
import { screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ShortfallPanel } from "@/components/proof/shortfall-panel";
import { proofResultsSchema } from "@/shared";
import { renderWithIntl } from "./render";

describe("/proof: where Vaari cannot save everyone", () => {
  const results = proofResultsSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../data/sim/results.json"), "utf8")));

  it("is shown only when the results file has the shortfall scenario", () => {
    renderWithIntl(<ShortfallPanel results={{ ...results, scenarios: { base: results.scenarios.base } }} />);
    expect(screen.queryByRole("heading", { name: "Where Vaari cannot save everyone" })).not.toBeInTheDocument();
  });

  it("puts the base season next to half the machines, from the file", () => {
    const base = results.scenarios.base;
    const halfLate = { phone_queue: { median: 900, p10: 850, p90: 950 }, nearest: { median: 880, p10: 840, p90: 930 }, vaari: { median: 610, p10: 560, p90: 660 } };
    const withShortfall = { ...results, scenarios: { base, capacityShortfall: { ...base, machines: 50, results: { ...base.results, fieldsLate: halfLate } } } };
    renderWithIntl(<ShortfallPanel results={withShortfall} />);
    expect(screen.getByRole("heading", { name: "Where Vaari cannot save everyone" })).toBeInTheDocument();
    expect(screen.getByText(`All machines (${base.machines})`)).toBeInTheDocument();
    expect(screen.getByText("Half the machines (50)")).toBeInTheDocument();
    const vaari = screen.getByRole("row", { name: /Vaari/ });
    expect(vaari).toHaveTextContent("610");
    expect(vaari).toHaveTextContent(String(base.results.fieldsLate.vaari!.median));
  });
});
