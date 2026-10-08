/** Reason sentences: dates in a row read as one range, separate days stay separate, in every language. */
import { describe, expect, it } from "vitest";
import { reasonText } from "../src/explain/templates";

const values = (dates: string[]) => ({ dates, machines: [], count: null });

describe("reason dates", () => {
  it("collapses three or more days in a row into one range", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    const text = reasonText("DAYS_FULL", values(days), "en");
    // Intl's own range style: "Sunday 1 – Sunday 8 November".
    expect(text).toMatch(/^Sunday,? 1( November)?\s*[–-]\s*Sunday,? 8 November: every working machine is already full\.$/);
    expect(text).not.toContain("Wednesday");
  });

  it("keeps one or two days as they are, and splits runs at a gap", () => {
    expect(reasonText("DAYS_FULL", values(["2026-11-01", "2026-11-02"]), "en")).toBe("Sunday, 1 November and Monday, 2 November: every working machine is already full.");
    const gap = reasonText("DAYS_FULL", values(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-06"]), "en");
    expect(gap).toMatch(/Sunday,? 1( November)?\s*[–-]\s*Tuesday,? 3 November and Friday, 6 November/);
  });

  it("forms the range in Punjabi and Hindi too", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03"];
    for (const locale of ["pa", "hi"] as const) {
      const text = reasonText("DAYS_FULL", values(days), locale);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain("2026");
    }
  });
});
