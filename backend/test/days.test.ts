import { describe, expect, it } from "vitest";
import { dateToDay, dayToDate, minuteToClock } from "../src/shared/days";

describe("days", () => {
  it("round-trips day indices and dates", () => {
    expect(dayToDate("2026-10-01", 0)).toBe("2026-10-01");
    expect(dayToDate("2026-10-01", 45)).toBe("2026-11-15");
    expect(dateToDay("2026-10-01", "2026-11-15")).toBe(45);
  });
  it("formats minutes as a clock", () => {
    expect(minuteToClock(8 * 60 + 5)).toBe("08:05");
  });
});
