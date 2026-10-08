# Data

The demo season's harvest timing comes from real satellite fire detections, not invented dates. Farmers, fields, machines and breakdowns remain simulated.

## Files

| File | What | Committed |
|---|---|---|
| `raw/*.csv` | NASA FIRMS VIIRS fire detections, as downloaded. Never modified by any script | No (git-ignored) |
| `raw/osm_villages_box.json` | Raw OpenStreetMap (Overpass) response | No (git-ignored) |
| `villages.json` | Every named village and hamlet in the box: `id` (`v` + OSM node id), `name`, `namePa`, `lat`, `lon`, `place` | Yes |
| `harvest_curves.json` | Per-village ready-day distribution, detection counts and method | Yes |

## The box

West 75.2, south 29.8, east 76.2, north 30.6 (Sangrur district, Punjab). The same box is used everywhere in Vaari (`SANGRUR_BOX` in `backend/src/data/harvest.ts`).

## Sources

**NASA FIRMS, VIIRS active fires.** Archive downloads for the box, seasons 2024 and 2025:

| File | Rows | Dates | Satellite | Version |
|---|---|---|---|---|
| `raw/2024_Sangrur.csv` | 2,524 | 2024-09-21 to 2024-12-21 | Suomi NPP (`SNPP`) | 2 |
| `raw/2025_Sangrur.csv` | 821 | 2025-09-18 to 2025-12-30 | Suomi NPP (`SNPP`) | 2 |

All rows are `type 0` (presumed vegetation fire) and inside the box. Only S-NPP is present (no NOAA-20 or NOAA-21), so adding those satellites later would raise the counts. Download: https://firms.modaps.eosdis.nasa.gov/download/ (VIIRS S-NPP, custom area 75.2,29.8,76.2,30.6, CSV), saved as `raw/<season>_Sangrur.csv`.
Acknowledgement: we acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).

**OpenStreetMap villages.** Nodes tagged `place=village` or `place=hamlet` with a name, inside the box, via the Overpass API (967 villages; snapshot time recorded in `villages.json`). Villages mapped only as areas, or not mapped at all, are missing.
Licence: © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0), https://www.openstreetmap.org/copyright. Any public use of `villages.json` must keep this attribution.

## Method (`npm run data:prepare`)

1. Parse every CSV in `raw/` (strict about the columns used; the files are only read, and their SHA-256 is recorded in the output and re-checked after the run).
2. Leave out low-confidence detections (`confidence = l`, which FIRMS flags as likely false alarms): 179 of 3,345.
3. Give each detection to the nearest village within **2 km**. Detections farther from every village (649, about 20%) count only towards the district curve.
4. Build a daily histogram of fire days per village per season. Day 0 is 1 October of that season. Seasons are pooled: every detection is one vote for its day.
5. Shift every histogram **3 days earlier** to turn "fire seen" into "field ready".
6. Villages with **5 or more** detections keep their own curve (`method: "village"`, 180 villages). Villages with 1 to 4 detections blend towards the district curve with weight = count / 5 (`"blended"`, 592). Villages with none use the district curve (`"district"`, 195).

Results for the 2024 and 2025 seasons combined: district ready-day 10th percentile 23 October, median 4 November, 90th percentile 15 November.

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

- **FIRMS undercounts burning.** S-NPP passes over Punjab once in the early afternoon (the detections here are almost all between 07:00 and 09:00 UTC, 12:30 to 14:30 IST) and once at night. Fields lit after the afternoon pass, and often in the evening, can burn out before the next one and are never seen. Clouds, smoke and small fires also hide detections. Treat every count and curve as a **lower bound**.
- **Satellites show heat, not intent.** A detection is a hot pixel about 375 m across, not a named field or farmer. Vaari never uses it to accuse anyone of burning.
- **Daily curves are spiky.** With one daytime pass a day, a few detections per village and cloudy days, single days can be empty. The curves are used as measured, without smoothing.

## Commands

```bash
cd backend
npm run data:villages   # network: OpenStreetMap -> data/villages.json (run once, or to refresh)
npm run data:prepare    # offline, deterministic: raw CSVs + villages.json -> data/harvest_curves.json
```

`data:prepare` stops without writing anything if `raw/` has no CSVs or `villages.json` is missing.
