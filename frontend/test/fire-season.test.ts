/**
 * The landing page's fire chart reads src/data/fire-season.json, a small copy of the district curve
 * in data/harvest_curves.json. This fails if the copy drifts (run `node scripts/fire-season.mjs`),
 * and checks the copy gives back real detection counts, not rounded shares.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFireSeason } from "../scripts/fire-season.mjs";
import fireSeason from "../src/data/fire-season.json";
import { fireSeasonFacts } from "../src/components/fire-season-chart";

const curves = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "harvest_curves.json"), "utf8"));

describe("fire season data", () => {
  it("matches data/harvest_curves.json", () => {
    expect(fireSeason).toEqual(buildFireSeason(curves));
  });

  it("daily counts add up to the detection total", () => {
    const sum = fireSeason.days.reduce((total, [, count]) => total + count!, 0);
    expect(sum).toBe(fireSeason.detections);
    expect(fireSeason.detections).toBe(fireSeason.detectionsBySeason["2024"] + fireSeason.detectionsBySeason["2025"]);
  });

  it("the facts the landing page states are computed from the counts", () => {
    const facts = fireSeasonFacts();
    const inWindow = fireSeason.days.filter(([day]) => day! >= 31 && day! <= 45).reduce((total, [, count]) => total + count!, 0);
    expect(facts.inOptimum).toBe(inWindow);
    expect(facts.optimumShare).toBe(Math.round((inWindow / fireSeason.detections) * 100));
    expect(facts.peak.count).toBe(Math.max(...fireSeason.days.filter(([day]) => day! >= 0 && day! <= 60).map(([, count]) => count!)));
  });
});
