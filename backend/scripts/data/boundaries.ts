/**
 * npm run data:boundaries: the real outlines of Punjab and of Sangrur and Malerkotla districts
 * (Malerkotla was carved out of Sangrur in 2021) from OpenStreetMap, for the /proof maps and for
 * choosing which villages the district-wide simulation covers. Writes data/boundaries.json.
 * Network step like data:villages; the raw Overpass responses are kept in data/raw (git-ignored).
 * `--offline` rebuilds from those raw files without the network. Each relation's outer ways are
 * stitched into closed rings and simplified (Douglas-Peucker) so the file stays small.
 * Data (c) OpenStreetMap contributors, ODbL 1.0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDirectory = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, "../../../data");
const rawDirectory = path.join(dataDirectory, "raw");
const offline = process.argv.includes("--offline");
// The main Overpass server often answers "too busy" for large relations; a mirror is tried too.
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const QUERIES = {
  districts: '[out:json][timeout:180];relation["boundary"="administrative"]["admin_level"="5"]["name"~"^(Sangrur|Malerkotla)$"](29.5,75.0,30.9,76.6);out geom;',
  state: '[out:json][timeout:240];relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="IN-PB"];out geom;',
};
// Simplification tolerance in degrees (about 150 m for districts, 600 m for the state outline).
const TOLERANCE = { districts: 0.0015, state: 0.006 };

type Point = [number, number]; // [lon, lat]
type Relation = { id: number; tags: Record<string, string>; members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] };

async function fetchRelations(kind: keyof typeof QUERIES): Promise<{ elements: Relation[]; osm3s?: { timestamp_osm_base?: string } }> {
  const rawFile = path.join(rawDirectory, `osm_boundaries_${kind}.json`);
  if (offline) {
    if (!existsSync(rawFile)) throw new Error(`--offline: ${rawFile} is missing`);
    return JSON.parse(readFileSync(rawFile, "utf8"));
  }
  for (const server of SERVERS) {
    const response = await fetch(server, {
      method: "POST",
      headers: { "user-agent": "vaari-hackathon-dataprep/0.3", accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: QUERIES[kind] }),
      signal: AbortSignal.timeout(280_000),
    }).catch(() => null);
    const text = response?.ok ? await response.text() : "";
    if (text.startsWith("{")) {
      mkdirSync(rawDirectory, { recursive: true });
      writeFileSync(rawFile, text);
      return JSON.parse(text);
    }
    console.error(`${server} did not answer for ${kind}; trying the next server`);
  }
  throw new Error(`no Overpass server answered for ${kind}; nothing written`);
}

/** Join a relation's outer ways end to end into closed rings. */
function stitch(relation: Relation): Point[][] {
  const pieces: Point[][] = relation.members
    .filter((member) => member.type === "way" && member.role === "outer" && member.geometry)
    .map((member) => member.geometry!.map((node) => [node.lon, node.lat] as Point));
  const same = (left: Point, right: Point) => left[0] === right[0] && left[1] === right[1];
  const rings: Point[][] = [];
  while (pieces.length > 0) {
    let ring = pieces.shift()!;
    while (!same(ring[0]!, ring.at(-1)!)) {
      const index = pieces.findIndex((piece) => same(piece[0]!, ring.at(-1)!) || same(piece.at(-1)!, ring.at(-1)!));
      if (index < 0) break; // an open ring (a gap in the data): kept as it is
      const piece = pieces.splice(index, 1)[0]!;
      ring = ring.concat((same(piece[0]!, ring.at(-1)!) ? piece : [...piece].reverse()).slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

/** Douglas-Peucker simplification of a polyline (tolerance in degrees). */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [first, last] = [points[0]!, points.at(-1)!];
  let farthest = 0;
  let index = 0;
  for (let at = 1; at < points.length - 1; at += 1) {
    const [x, y] = points[at]!;
    const [dx, dy] = [last[0] - first[0], last[1] - first[1]];
    const length = Math.hypot(dx, dy) || 1e-12;
    const distance = Math.abs(dy * x - dx * y + last[0] * first[1] - last[1] * first[0]) / length;
    if (distance > farthest) [farthest, index] = [distance, at];
  }
  if (farthest <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** A closed ring starts and ends on the same point, which Douglas-Peucker alone would collapse:
 * split it at the point farthest from the start and simplify the two halves. */
function simplifyRing(ring: Point[], tolerance: number): Point[] {
  const start = ring[0]!;
  let split = 1;
  ring.forEach(([lon, lat], index) => {
    if (Math.hypot(lon - start[0], lat - start[1]) > Math.hypot(ring[split]![0] - start[0], ring[split]![1] - start[1])) split = index;
  });
  return [...simplify(ring.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(ring.slice(split), tolerance)];
}

const round = (ring: Point[]) => ring.map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] as Point);
const outline = (relation: Relation, tolerance: number) =>
  stitch(relation)
    .map((ring) => round(simplifyRing(ring, tolerance)))
    .filter((ring) => ring.length >= 4);

const districts = await fetchRelations("districts");
const state = await fetchRelations("state");
const punjab = state.elements[0];
if (!punjab) throw new Error("Punjab (IN-PB) not found; nothing written");
const output = {
  source: "OpenStreetMap via Overpass API: administrative boundaries (state admin_level 4, districts admin_level 5), outer rings simplified",
  license: "ODbL 1.0, (c) OpenStreetMap contributors",
  osmSnapshot: districts.osm3s?.timestamp_osm_base ?? null,
  note: "Malerkotla district was formed from Sangrur in 2021; the simulated district is the two together (the pre-2021 Sangrur), matching the machine counts reported for it.",
  state: { name: "Punjab", osmRelation: punjab.id, rings: outline(punjab, TOLERANCE.state) },
  districts: districts.elements
    .map((relation) => ({ name: relation.tags.name ?? "", osmRelation: relation.id, rings: outline(relation, TOLERANCE.districts) }))
    .sort((left, right) => left.name.localeCompare(right.name, "en")),
};
writeFileSync(path.join(dataDirectory, "boundaries.json"), JSON.stringify(output) + "\n");
const points = (rings: Point[][]) => rings.reduce((sum, ring) => sum + ring.length, 0);
console.log(`wrote data/boundaries.json: Punjab ${output.state.rings.length} ring(s), ${points(output.state.rings)} points; ${output.districts.map((item) => `${item.name} ${item.rings.length} ring(s), ${points(item.rings)} points`).join("; ")}`);
