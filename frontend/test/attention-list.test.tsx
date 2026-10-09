/** The operator's list of farmers who said "I cannot wait longer" from their slot link. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttentionList } from "@/components/attention-list";
import { renderWithIntl } from "./render";

describe("operator: farmers who cannot wait longer", () => {
  it("lists each one with the new last day and the date they hold now", () => {
    renderWithIntl(
      <AttentionList
        items={[{ fieldId: "f1", token: 18, farmerName: "Paramjit Kaur", villageName: "Akoi", burnDeadlineDate: "2026-11-02", requestedAt: "2026-10-31T08:00:00.000Z", promise: { kind: "window", startDate: "2026-11-03", endDate: "2026-11-04" } }]}
      />,
    );
    const section = screen.getByRole("region", { name: "1 farmer cannot wait longer" });
    expect(within(section).getByText("#018")).toBeInTheDocument();
    expect(section).toHaveTextContent(/Paramjit Kaur, Akoi: can wait until .*2 November/);
  });

  it("shows nothing when nobody asked", () => {
    renderWithIntl(<AttentionList items={[]} />);
    expect(screen.queryByText(/cannot wait longer/)).not.toBeInTheDocument();
  });
});
