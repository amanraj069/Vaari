/**
 * The district outlines from data/boundaries.json (OpenStreetMap, ODbL), for the officer's map.
 * Read once per data directory; a missing or malformed file gives no outlines (the map then draws
 * villages only), never a failed overview.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ringSchema = z.array(z.tuple([z.number(), z.number()]));
const boundariesSchema = z.object({ districts: z.array(z.object({ name: z.string(), rings: z.array(ringSchema) })) });
export type DistrictOutline = z.infer<typeof boundariesSchema>["districts"][number];

const outlinesByDir = new Map<string, DistrictOutline[]>();

export function loadDistrictOutlines(dataDir: string): DistrictOutline[] {
  const cached = outlinesByDir.get(dataDir);
  if (cached) return cached;
  let outlines: DistrictOutline[] = [];
  try {
    const parsed = boundariesSchema.safeParse(JSON.parse(readFileSync(path.join(dataDir, "boundaries.json"), "utf8")));
    if (parsed.success) outlines = parsed.data.districts.map(({ name, rings }) => ({ name, rings }));
  } catch {
    outlines = [];
  }
  outlinesByDir.set(dataDir, outlines);
  return outlines;
}

/** The district whose outline holds a point (a centre's base), or null outside every outline. */
export function districtAt(lon: number, lat: number, outlines: readonly DistrictOutline[]): string | null {
  return outlines.find((outline) => insideRings(lon, lat, outline.rings))?.name ?? null;
}

/** Even-odd ray casting over every ring of an outline (the simulator's rule, sim/district.py). */
function insideRings(lon: number, lat: number, rings: [number, number][][]): boolean {
  let crossings = 0;
  for (const ring of rings) {
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const [lonA, latA] = ring[index]!;
      const [lonB, latB] = ring[index + 1]!;
      if (latA > lat !== latB > lat && lon < lonA + ((lat - latA) * (lonB - lonA)) / (latB - latA)) crossings += 1;
    }
  }
  return crossings % 2 === 1;
}
