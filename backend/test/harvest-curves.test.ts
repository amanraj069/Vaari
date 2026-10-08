/**
 * Harvest curves on a hand-checked fixture (test/fixtures/firms): 11 VIIRS rows, 3 villages.
 * Alpha (vA): 6 usable detections -> own curve. Bravo (vB): 2 -> blended at weight 2/5.
 * Charlie (vC): none -> district. One low-confidence row is dropped; one row 2.5 km from Alpha and
 * one far away count for the district only. Fire day 0 = 1 October; ready day = fire day - 3.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFirmsCsv } from "../src/data/firms";
import { buildHarvestCurves, dayOffset, HARVEST_TO_FIRE_DAYS, nearestVillage, sampleReadyDay, seasonOf } from "../src/data/harvest";

const fixtureDirectory = path.resolve(__dirname, "fixtures/firms");
const csv = readFileSync(path.join(fixtureDirectory, "raw/fixture_viirs.csv"), "utf8");
const villages = (JSON.parse(readFileSync(path.join(fixtureDirectory, "villages.json"), "utf8")) as { villages: { id: string; name: string; lat: number; lon: number }[] }).villages;
const detections = parseFirmsCsv(csv, "fixture");
const curves = buildHarvestCurves(detections, villages);
const byId = Object.fromEntries(curves.villages.map((curve) => [curve.villageId, curve]));
const asMap = (pairs: [number, number][]) => new Map(pairs);

describe("FIRMS parsing and dates", () => {
  it("reads every row and the fields we use", () => {
    expect(detections).toHaveLength(11);
    expect(detections[0]).toMatchObject({ lat: 30.001, lon: 75.501, date: "2024-10-20", confidence: "n", dayNight: "D", satellite: "SNPP" });
  });
  it("rejects a file without the expected columns", () => {
    expect(() => parseFirmsCsv("lat,lon\n1,2\n", "bad.csv")).toThrow(/missing column/);
  });
  it("counts days from 1 October of the season", () => {
    expect(dayOffset("2024-10-01")).toBe(0);
    expect(dayOffset("2024-11-05")).toBe(35);
    expect(dayOffset("2025-09-28")).toBe(-3);
    expect(seasonOf("2025-01-04")).toBe("2024");
  });
});

describe("assignment to villages", () => {
  it("takes the nearest village within 2 km and nothing beyond", () => {
    expect(nearestVillage(detections[0]!, villages)?.id).toBe("vA");
    expect(nearestVillage(detections[10]!, villages)).toBeNull(); // 2.5 km north of Alpha
    expect(nearestVillage(detections[9]!, villages)).toBeNull(); // far from every village
  });
  it("leaves out low-confidence rows and keeps the totals honest", () => {
    expect(curves.totals).toEqual({ detections: 11, excludedLowConfidence: 1, outsideBox: 0, assignedToVillages: 8, unassigned: 2 });
    expect(curves.district.detections).toBe(10);
    expect(curves.seasons).toEqual(["2024", "2025"]);
  });
});

describe("curves", () => {
  it("a village with 5 or more detections gets its own curve, shifted 3 days earlier", () => {
    expect(HARVEST_TO_FIRE_DAYS).toBe(3);
    const alpha = byId.vA!;
    expect(alpha).toMatchObject({ method: "village", detections: 6, detectionsBySeason: { "2024": 4, "2025": 2 } });
    // Fires on day 19 (x3), 20 (x1), 24 (x2) -> ready on days 16, 17, 21.
    expect(alpha.readyDays).toEqual([
      [16, 0.5],
      [17, 0.166667],
      [21, 0.333333],
    ]);
  });

  it("a village with fewer than 5 detections blends towards the district by count / 5", () => {
    const bravo = asMap(byId.vB!.readyDays);
    expect(byId.vB!).toMatchObject({ method: "blended", detections: 2 });
    // District ready days: 16 -> 4/10, 17 -> 1/10, 21 -> 2/10, 32 -> 2/10, 37 -> 1/10. Bravo: all on day 32.
    expect(bravo.get(32)).toBeCloseTo(0.4 * 1 + 0.6 * 0.2, 6);
    expect(bravo.get(16)).toBeCloseTo(0.6 * 0.4, 6);
    expect([...bravo.values()].reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 5);
  });

  it("a village with no detections uses the district curve", () => {
    expect(byId.vC!).toMatchObject({ method: "district", detections: 0, detectionsBySeason: {} });
    expect(byId.vC!.readyDays).toEqual(curves.district.readyDays);
    expect(curves.district.readyDays).toEqual([
      [16, 0.4],
      [17, 0.1],
      [21, 0.2],
      [32, 0.2],
      [37, 0.1],
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const shuffled = buildHarvestCurves([...detections].reverse(), [...villages].reverse());
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(curves));
  });

  it("samples ready days only inside the requested window", () => {
    let state = 1;
    const random = () => ((state = (state * 48271) % 2147483647) / 2147483647);
    for (let draw = 0; draw < 200; draw += 1) {
      const day = sampleReadyDay(curves.district.readyDays, random, 17, 32)!;
      expect([17, 21, 32]).toContain(day);
    }
    expect(sampleReadyDay(curves.district.readyDays, random, 40, 50)).toBeNull();
  });
});

describe("npm run data:prepare", () => {
  const script = path.resolve(__dirname, "../scripts/data/prepare.ts");
  const tsx = path.resolve(__dirname, "../node_modules/.bin/tsx");

  it("writes byte-identical output on every run and never modifies the raw files", () => {
    const dataDirectory = mkdtempSync(path.join(tmpdir(), "vaari-data-"));
    try {
      cpSync(fixtureDirectory, dataDirectory, { recursive: true });
      const rawFile = path.join(dataDirectory, "raw/fixture_viirs.csv");
      const rawHash = createHash("sha256").update(readFileSync(rawFile)).digest("hex");
      execFileSync(tsx, [script], { env: { ...process.env, DATA_DIR: dataDirectory }, stdio: "pipe" });
      const first = readFileSync(path.join(dataDirectory, "harvest_curves.json"), "utf8");
      execFileSync(tsx, [script], { env: { ...process.env, DATA_DIR: dataDirectory }, stdio: "pipe" });
      expect(readFileSync(path.join(dataDirectory, "harvest_curves.json"), "utf8")).toBe(first);
      expect(createHash("sha256").update(readFileSync(rawFile)).digest("hex")).toBe(rawHash);
      const output = JSON.parse(first) as { sources: { file: string; sha256: string; rows: number }[] };
      expect(output.sources).toEqual([{ file: "raw/fixture_viirs.csv", sha256: rawHash, rows: 11 }]);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  it("stops without writing anything when the raw CSVs are missing", () => {
    const dataDirectory = mkdtempSync(path.join(tmpdir(), "vaari-data-"));
    try {
      cpSync(path.join(fixtureDirectory, "villages.json"), path.join(dataDirectory, "villages.json"));
      const result = spawnSync(tsx, [script], { env: { ...process.env, DATA_DIR: dataDirectory }, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/No FIRMS CSVs/);
      expect(existsSync(path.join(dataDirectory, "harvest_curves.json"))).toBe(false);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
