/**
 * npm run data:prepare: raw FIRMS CSVs + data/villages.json -> data/harvest_curves.json.
 * Offline and deterministic: inputs are read in sorted order, the output has no timestamps, and
 * the same inputs give byte-identical output. Raw files are only read; their SHA-256 is recorded
 * and re-checked after the run to prove they were not modified.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseFirmsCsv, type FireDetection } from "../../src/data/firms";
import { buildHarvestCurves, type VillagePoint } from "../../src/data/harvest";

const dataDirectory = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, "../../../data");
const rawDirectory = path.join(dataDirectory, "raw");
const villagesFile = path.join(dataDirectory, "villages.json");
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

const csvFiles = existsSync(rawDirectory) ? readdirSync(rawDirectory).filter((name) => name.toLowerCase().endsWith(".csv")).sort() : [];
if (csvFiles.length === 0) {
  console.error(`No FIRMS CSVs in ${rawDirectory}. Download the VIIRS archive for the box 75.2,29.8,76.2,30.6 (see data/README.md). Nothing written.`);
  process.exit(1);
}
if (!existsSync(villagesFile)) {
  console.error("data/villages.json is missing. Run `npm run data:villages` first. Nothing written.");
  process.exit(1);
}

const hashesBefore = new Map(csvFiles.map((name) => [name, sha256(path.join(rawDirectory, name))]));
const detections: FireDetection[] = [];
const sources: { file: string; sha256: string; rows: number }[] = [];
for (const name of csvFiles) {
  const rows = parseFirmsCsv(readFileSync(path.join(rawDirectory, name), "utf8"), name);
  detections.push(...rows);
  sources.push({ file: `raw/${name}`, sha256: hashesBefore.get(name)!, rows: rows.length });
}
const villagesBody = JSON.parse(readFileSync(villagesFile, "utf8")) as { villages: VillagePoint[] };
const villages = villagesBody.villages.map(({ id, name, lat, lon }) => ({ id, name, lat, lon }));

const curves = buildHarvestCurves(detections, villages);
const output = { ...curves, sources, villagesFile: { file: "villages.json", sha256: sha256(villagesFile), villages: villages.length } };
writeFileSync(path.join(dataDirectory, "harvest_curves.json"), JSON.stringify(output) + "\n");

for (const name of csvFiles) {
  if (sha256(path.join(rawDirectory, name)) !== hashesBefore.get(name)) {
    console.error(`raw/${name} changed during the run; this must never happen.`);
    process.exit(1);
  }
}

const methods = curves.villages.reduce<Record<string, number>>((count, village) => ({ ...count, [village.method]: (count[village.method] ?? 0) + 1 }), {});
const peak = [...curves.district.readyDays].sort((left, right) => right[1] - left[1])[0];
console.log(`seasons ${curves.seasons.join(", ")} | ${curves.totals.detections} detections, ${curves.totals.excludedLowConfidence} low-confidence left out, ${curves.totals.assignedToVillages} assigned to a village within 2 km, ${curves.totals.unassigned} not near any village`);
console.log(`villages: ${curves.villages.length} (village curve ${methods.village ?? 0}, blended ${methods.blended ?? 0}, district ${methods.district ?? 0})`);
console.log(`district ready-day peak: day ${peak?.[0]} after 1 October (shifted ${curves.assumptions.harvestToFireDays} days before fires)`);
console.log("wrote data/harvest_curves.json; raw files unchanged");
