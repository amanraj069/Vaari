/**
 * The district outlook's arithmetic (domain/outlook.ts): earliest last waiting day first, late
 * acres counted exactly, the forecast never double-counts booked acres, and a machine is lent only
 * by a centre that stays on time without it and only within reach.
 */
import { describe, expect, it } from "vitest";
import { centreOutlook, forecastLots, playOutlook, readyShare, suggestMoves, type CentreOutlookInput } from "../src/domain/outlook";

describe("playOutlook", () => {
  it("counts nothing late when the machines keep up", () => {
    const result = playOutlook([{ readyDay: 1, lastDay: 3, acres: 10 }], 1, [6, 6, 6]);
    expect(result.lateAcres).toBe(0);
    expect(result.days.map((day) => day.waitingAcres)).toEqual([4, 0, 0]);
  });

  it("sows the earliest last waiting day first and counts what is left after it", () => {
    // 12 acres due by day 2 and 6 acres due by day 5, 5 acres a day: 2 acres miss day 2.
    const result = playOutlook(
      [
        { readyDay: 1, lastDay: 5, acres: 6 },
        { readyDay: 1, lastDay: 2, acres: 12 },
      ],
      1,
      [5, 5, 5, 5, 5],
    );
    expect(result.lateAcres).toBe(2);
    expect(result.days[0]!.sownAcres).toBe(5);
  });

  it("does not sow a field before it is ready", () => {
    const result = playOutlook([{ readyDay: 3, lastDay: 3, acres: 4 }], 1, [10, 10, 0]);
    expect(result.lateAcres).toBe(4);
  });
});

describe("forecastLots", () => {
  it("expects the season's share each day less what is already booked, over the waiting limits", () => {
    const share = new Map([
      [10, 0.5],
      [11, 0.5],
    ]);
    const { lots, expectedByDay } = forecastLots([share], 100, new Map([[10, 20]]), [10, 11], { waitingLimitMinDays: 3, waitingLimitMaxDays: 4 });
    expect(expectedByDay).toEqual([30, 50]);
    expect(lots).toEqual([
      { readyDay: 10, lastDay: 13, acres: 15 },
      { readyDay: 10, lastDay: 14, acres: 15 },
      { readyDay: 11, lastDay: 14, acres: 25 },
      { readyDay: 11, lastDay: 15, acres: 25 },
    ]);
  });

  it("never expects negative acres when more is booked than the curve suggests", () => {
    const { lots, expectedByDay } = forecastLots([new Map([[10, 1]])], 10, new Map([[10, 50]]), [10], { waitingLimitMinDays: 3, waitingLimitMaxDays: 10 });
    expect(expectedByDay).toEqual([0]);
    expect(lots).toEqual([]);
  });

  it("normalises a curve inside the season window", () => {
    const share = readyShare(
      [
        [5, 0.2],
        [10, 0.3],
        [11, 0.1],
      ],
      0,
      { windowFirstCurveDay: 10, windowLastCurveDay: 55 },
    );
    expect(share.get(10)).toBeCloseTo(0.75);
    expect(share.has(5)).toBe(false);
  });
});

const centre = (id: string, lon: number, machines: number, dueAcres: number): CentreOutlookInput => ({
  id,
  lat: 30,
  lon,
  machinesTotal: machines,
  lots: [{ readyDay: 1, lastDay: 2, acres: dueAcres }],
  acresPerMachineDay: 5,
  workingByDay: [machines, machines],
});

describe("suggestMoves", () => {
  it("borrows from the nearest centre that stays on time without the machine", () => {
    // Short: 30 acres due in 2 days with 2 machines (20 acres). Near: 5 machines, 10 acres due.
    const short = centre("short", 76.0, 2, 30);
    const near = centre("near", 76.05, 5, 10);
    const far = centre("far", 76.15, 5, 10);
    const { moves, extra } = suggestMoves([short, near, far], 1);
    expect(moves).toEqual([expect.objectContaining({ fromCentreId: "near", toCentreId: "short", lateBeforeAcres: 10, lateAfterAcres: 0 })]);
    expect(extra).toEqual([]);
    expect(centreOutlook(near, 1).lateIfOneDownAcres).toBe(0);
  });

  it("never takes a centre's last machine or one it needs, and asks for machines instead", () => {
    const short = centre("short", 76.0, 2, 60);
    const busy = centre("busy", 76.02, 2, 20);
    const lone = centre("lone", 76.03, 1, 0);
    const { moves, extra } = suggestMoves([short, busy, lone], 1);
    expect(moves).toEqual([]);
    expect(extra).toEqual([{ centreId: "short", machines: 4, lateAcres: 40 }]);
  });

  it("does not lend beyond reach", () => {
    // About 48 km apart at this latitude.
    const short = centre("short", 76.0, 2, 30);
    const distant = centre("distant", 76.5, 6, 0);
    expect(suggestMoves([short, distant], 1).moves).toEqual([]);
  });
});
