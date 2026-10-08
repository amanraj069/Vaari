import { describe, expect, it } from "vitest";
import { learnRate } from "../src/shared/rates";

// Reference values printed by backend/engine/vaari_engine/rates.py (repr) for the same inputs.
describe("learnRate matches the Python engine", () => {
  it("prior only", () => {
    const rate = learnRate([]);
    expect(rate.promiseAcresPerHour).toBeCloseTo(0.83, 12);
    expect(rate.planAcresPerHour).toBeCloseTo(1.08125, 12);
    expect(rate.observations).toBe(0);
  });
  it("with logs", () => {
    const logs = [
      { acres: 5, hours: 8 },
      { acres: 9, hours: 8 },
      { acres: 6.5, hours: 7 },
    ];
    const rate = learnRate(logs);
    expect(rate.promiseAcresPerHour).toBeCloseTo(0.74625, 12);
    expect(rate.planAcresPerHour).toBeCloseTo(1.0049107142857143, 12);
    expect(rate.observations).toBe(3);
  });
});
