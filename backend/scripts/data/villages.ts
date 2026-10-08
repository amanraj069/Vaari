/**
 * npm run data:villages: fetch every named village and hamlet in the Sangrur box from OpenStreetMap
 * (Overpass API) and write data/villages.json. This is the one network step, kept apart from
 * data:prepare so that one stays deterministic. The raw response is kept in data/raw (git-ignored).
 * Data (c) OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SANGRUR_BOX } from "../../src/data/harvest";

const dataDirectory = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, "../../../data");
const { west, south, east, north } = SANGRUR_BOX;
const query = `[out:json][timeout:90];node["place"~"^(village|hamlet)$"](${south},${west},${north},${east});out;`;

type OverpassNode = { id: number; lat: number; lon: number; tags?: Record<string, string> };

const response = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  // Overpass answers 406 Not Acceptable without a User-Agent (docs/FOUGHT_BACK.md).
  headers: { "user-agent": "vaari-hackathon-dataprep/0.2", accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ data: query }),
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok) {
  console.error(`Overpass answered HTTP ${response.status}; nothing written.`);
  process.exit(1);
}
const raw = await response.text();
const body = JSON.parse(raw) as { osm3s?: { timestamp_osm_base?: string }; elements: OverpassNode[] };
mkdirSync(path.join(dataDirectory, "raw"), { recursive: true });
writeFileSync(path.join(dataDirectory, "raw/osm_villages_box.json"), raw);

const villages = body.elements
  .filter((node) => node.tags?.name)
  .map((node) => ({
    id: `v${node.id}`,
    name: node.tags!.name!,
    namePa: node.tags!["name:pa"] ?? null,
    lat: Math.round(node.lat * 1e5) / 1e5,
    lon: Math.round(node.lon * 1e5) / 1e5,
    place: node.tags!.place!,
  }))
  .sort((left, right) => left.name.localeCompare(right.name, "en") || (left.id < right.id ? -1 : 1));

const output = {
  source: "OpenStreetMap via Overpass API: nodes with place=village or place=hamlet and a name",
  license: "ODbL 1.0, (c) OpenStreetMap contributors",
  osmSnapshot: body.osm3s?.timestamp_osm_base ?? null,
  box: SANGRUR_BOX,
  villages,
};
writeFileSync(path.join(dataDirectory, "villages.json"), JSON.stringify(output, null, 1) + "\n");
console.log(`wrote ${villages.length} villages to data/villages.json (OSM snapshot ${output.osmSnapshot})`);
