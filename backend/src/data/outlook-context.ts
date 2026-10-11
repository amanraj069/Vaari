/**
 * What the district outlook reads from data/: each village's ready share (its harvest curve from
 * NASA FIRMS, normalised inside the simulator's season window) and the simulator's own assumptions
 * (data/sim/assumptions.json: acres per machine in a season, waiting limits, the season window), so
 * the officer's forecast and /proof rest on the same labelled inputs. Read once per data folder.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dateToDay } from "../shared";
import type { HarvestCurves } from "./harvest";
import { readyShare } from "../domain/outlook";
import type { OutlookContext } from "../domain/views";

const assumptionsSchema = z.object({
  inputs: z.object({
    seasonWindow: z.object({ firstReadyDay: z.number().int(), lastReadyDay: z.number().int() }),
    acresPerMachine: z.object({ value: z.number() }),
    waitingLimitDays: z.object({ min: z.number().int(), max: z.number().int() }),
  }),
});

const contextByDir = new Map<string, OutlookContext>();

export function loadOutlookContext(dataDir: string, seasonStartDate: string): OutlookContext {
  const key = `${dataDir}|${seasonStartDate}`;
  const cached = contextByDir.get(key);
  if (cached) return cached;
  const { inputs } = assumptionsSchema.parse(JSON.parse(readFileSync(path.join(dataDir, "sim", "assumptions.json"), "utf8")));
  const curves = JSON.parse(readFileSync(path.join(dataDir, "harvest_curves.json"), "utf8")) as HarvestCurves;
  const assumptions = {
    acresPerMachineSeason: inputs.acresPerMachine.value,
    waitingLimitMinDays: inputs.waitingLimitDays.min,
    waitingLimitMaxDays: inputs.waitingLimitDays.max,
    windowFirstCurveDay: inputs.seasonWindow.firstReadyDay,
    windowLastCurveDay: inputs.seasonWindow.lastReadyDay,
  };
  // Curves count days from 1 October of the season's year.
  const curveDayZero = dateToDay(seasonStartDate, `${seasonStartDate.slice(0, 4)}-10-01`);
  const context: OutlookContext = {
    sharesByVillage: new Map(curves.villages.map((curve) => [curve.villageId, readyShare(curve.readyDays, curveDayZero, assumptions)])),
    districtShare: readyShare(curves.district.readyDays, curveDayZero, assumptions),
    assumptions,
  };
  contextByDir.set(key, context);
  return context;
}
