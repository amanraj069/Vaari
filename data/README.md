# Data

The demo season's harvest timing comes from real satellite fire detections, not invented dates. Farmers, fields, machines and breakdowns remain simulated.

## Files

| File | What | Committed |
|---|---|---|
| `raw/*.csv` | NASA FIRMS VIIRS fire detections, as downloaded. Never modified by any script | No (git-ignored) |
| `raw/osm_villages_box.json` | Raw OpenStreetMap (Overpass) response | No (git-ignored) |
| `villages.json` | Every named village and hamlet in the box: `id` (`v` + OSM node id), `name`, `namePa`, `lat`, `lon`, `place` | Yes |
| `harvest_curves.json` | Per-village ready-day distribution, detection counts and method | Yes |
| `boundaries.json` | Real outlines of Punjab and of Sangrur and Malerkotla districts (OpenStreetMap), simplified; used for the district-wide simulation and the /proof maps | Yes |
| `raw/osm_boundaries_*.json` | Raw Overpass responses for those outlines | No (git-ignored) |

## The box

West 75.2, south 29.8, east 76.2, north 30.6 (Sangrur district, Punjab). The same box is used everywhere in Vaari (`SANGRUR_BOX` in `backend/src/data/harvest.ts`).

## Sources

**NASA FIRMS, VIIRS active fires.** Archive downloads for the box, seasons 2024 and 2025:

| File | Rows | Dates | Satellite | Version |
|---|---|---|---|---|
| `raw/2024_Sangrur.csv` | 2,524 | 2024-09-21 to 2024-12-21 | Suomi NPP (`SNPP`) | 2 |
| `raw/2025_Sangrur.csv` | 821 | 2025-09-18 to 2025-12-30 | Suomi NPP (`SNPP`) | 2 |
| `raw/2024_Sangrur_NOAA20.csv` | 3,024 | 2024-09-22 to 2024-12-25 | NOAA-20 (`N20`) | 2 (standard processing) |
| `raw/2025_Sangrur_NOAA20.csv` | 891 | 2025-09-20 to 2025-12-28 | NOAA-20 (`N20`) | 2 (standard processing) |

All rows are `type 0` (presumed vegetation fire) and inside the box. S-NPP: archive download from https://firms.modaps.eosdis.nasa.gov/download/ (VIIRS S-NPP, custom area 75.2,29.8,76.2,30.6, CSV), saved as `raw/<season>_Sangrur.csv`. NOAA-20 (added 2026-10-09): the FIRMS area API, source `VIIRS_NOAA20_SP`, the same box, 15 September to 31 December in 5-day requests, merged per season (rows checked: inside the box, satellite N20, valid dates; nothing else changed). NOAA-20 passes about 50 minutes before S-NPP, so the two together see fires that one alone misses; a fire seen by both counts twice, which changes counts but not the shape of a curve much. NOAA-21 is not used: FIRMS has it only as near-real-time data (`VIIRS_NOAA21_NRT`), not standard processing. The FIRMS key is `MAP_KEY` in `backend/.env`; never commit it.
Acknowledgement: we acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).

**OpenStreetMap villages.** Nodes tagged `place=village` or `place=hamlet` with a name, inside the box, via the Overpass API (967 villages; snapshot time recorded in `villages.json`). Villages mapped only as areas, or not mapped at all, are missing.
Licence: © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0), https://www.openstreetmap.org/copyright. Any public use of `villages.json` must keep this attribution.

## Method (`npm run data:prepare`)

1. Parse every CSV in `raw/` (strict about the columns used; the files are only read, and their SHA-256 is recorded in the output and re-checked after the run).
2. Leave out low-confidence detections (`confidence = l`, which FIRMS flags as likely false alarms): 437 of 7,260.
3. Give each detection to the nearest village within **2 km**. Detections farther from every village (1,364, about 20%) count only towards the district curve.
4. Build a daily histogram of fire days per village per season. Day 0 is 1 October of that season. Seasons are pooled: every detection is one vote for its day.
5. Shift every histogram **3 days earlier** to turn "fire seen" into "field ready".
6. Villages with **5 or more** detections keep their own curve (`method: "village"`, 463 villages; 180 with S-NPP alone). Villages with 1 to 4 detections blend towards the district curve with weight = count / 5 (`"blended"`, 425). Villages with none use the district curve (`"district"`, 79).

Results for the 2024 and 2025 seasons combined, both satellites: district ready-day 10th percentile 24 October, median 4 November, 90th percentile 15 November; the busiest 10 days hold 54.8% of the harvest (50.3% with S-NPP alone).

## Assumptions (named constants, labelled in code and UI)

| Assumption | Value | Where |
|---|---|---|
| Harvest-to-fire delay | 3 days | `HARVEST_TO_FIRE_DAYS` |
| Detection-to-village radius | 2 km | `ASSIGNMENT_RADIUS_KM` |
| Detections for a village's own curve | 5 (fewer blend in proportion) | `FULL_WEIGHT_DETECTIONS` |
| Low-confidence detections | left out | `EXCLUDED_CONFIDENCE` |
| Harvest calendar | the same calendar days each season (2024 and 2025 curves applied to the 2026 demo season) | `DAY_ZERO_MONTH_DAY` |
| Who has booked by the demo day | fields ready from 2 days before to 7 days after the demo day | `backend/src/demo/seed.ts` |
| Field sizes | 1.5 to 6 acres | `backend/src/demo/seed.ts` |
| Waiting limits | 3 to 10 days | `backend/src/demo/seed.ts` |

The demo seed draws each field's ready day from its village's curve, restricted to the booking window (falling back to the district curve when a village has no ready days in it).

## What this data cannot tell you

- **FIRMS undercounts burning.** Each satellite passes over Punjab once in the early afternoon (NOAA-20 about 50 minutes before S-NPP) (the detections here are almost all between 07:00 and 09:00 UTC, 12:30 to 14:30 IST) and once at night. Fields lit after the afternoon pass, and often in the evening, can burn out before the next one and are never seen. Clouds, smoke and small fires also hide detections. Treat every count and curve as a **lower bound**.
- **Satellites show heat, not intent.** A detection is a hot pixel about 375 m across, not a named field or farmer. Vaari never uses it to accuse anyone of burning.
- **Daily curves are spiky.** With one daytime pass a day, a few detections per village and cloudy days, single days can be empty. The curves are used as measured, without smoothing.

## Boundaries (`npm run data:boundaries`)

The administrative outlines of Punjab (`admin_level=4`, `ISO3166-2=IN-PB`) and of Sangrur and Malerkotla districts (`admin_level=5`) from OpenStreetMap via Overpass (the main server often answers "too busy" for the state; a mirror is tried). Each relation's outer ways are stitched into closed rings and simplified with Douglas-Peucker (about 150 m for the districts, 600 m for the state; a closed ring is split at its farthest point first, or the algorithm collapses it). `--offline` rebuilds from `raw/`. Malerkotla was formed from Sangrur in 2021; the simulated district is the two together (the pre-2021 Sangrur), which is what the machine counts reported to the NGT up to 2022-23 cover. The demo box (75.2-76.2 E, 29.8-30.6 N) cuts thin strips off Sangrur's southern tip and Malerkotla's northern edge; villages there are not in `villages.json`, so those strips have no simulated farmers. Licence: ODbL 1.0, (c) OpenStreetMap contributors.

## Commands

```bash
cd backend
npm run data:villages   # network: OpenStreetMap -> data/villages.json (run once, or to refresh)
npm run data:boundaries # network: OpenStreetMap -> data/boundaries.json (--offline: from data/raw)
npm run data:prepare    # offline, deterministic: raw CSVs + villages.json -> data/harvest_curves.json
```

`data:prepare` stops without writing anything if `raw/` has no CSVs or `villages.json` is missing.

## sim/ (season simulator)

- `sim/assumptions.json`: every input of the simulated seasons, labelled "assumed" or "real range" with the reason or source (CEEW for the rental desk, farm size and season size); the scenarios and sweeps; the sourced conversion constants (PAU, CEEW) in `constants`. Edit here, then re-run.
- `sim/results.json`: written by `npm run simulate -- --runs 50 --seed 1` in `backend/` (by default on half the cores, at any worker count the same file; about 14 minutes on 6 workers; `--centres 3` for a quick look). Committed so `/proof` works on a fresh clone; the same seed always writes the same file. Never edit it by hand: the page shows only what the simulator wrote.
