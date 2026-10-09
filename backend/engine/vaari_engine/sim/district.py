"""The district the simulation covers, and where its machine centres are.

Why it exists: the proof page shows a whole district, not one centre. The district is the real
outline of Sangrur and Malerkotla (pre-2021 Sangrur) from OpenStreetMap (data/boundaries.json);
every village of data/villages.json inside it is served. Centres are placed by a fixed rule, never
chosen for the result: the first at the village with the most fire detections (the hotspot), each
next one at the village farthest from every centre so far (farthest-point sampling); then, for a
few rounds, each centre moves to the village nearest the middle of the villages it serves (so no
centre sits alone on the border). Each village is served by its nearest centre. Each centre then plays
its own season (simulated farmers, its own machines) under the same district-wide weather.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ..cluster import default_data_dir
from ..geo import haversine_km


@dataclass(frozen=True)
class Centre:
    index: int
    base: dict  # the centre's village: id, name, lat, lon
    villages: tuple[dict, ...]  # every village it serves, its own included
    machines: int  # its fleet: in proportion to the villages it serves, at least 1


@lru_cache(maxsize=4)
def load_boundaries(path: Path | None = None) -> dict:
    return json.loads((path or default_data_dir() / "boundaries.json").read_text())


def inside(lon: float, lat: float, rings: list[list[list[float]]]) -> bool:
    """Even-odd ray casting over every ring (a point inside an odd number of rings is inside)."""
    crossings = 0
    for ring in rings:
        for (lon_a, lat_a), (lon_b, lat_b) in zip(ring, ring[1:]):
            if (lat_a > lat) != (lat_b > lat) and lon < lon_a + (lat - lat_a) * (lon_b - lon_a) / (lat_b - lat_a):
                crossings += 1
    return crossings % 2 == 1


def district_rings(boundaries: dict) -> list[list[list[float]]]:
    return [ring for district in boundaries["districts"] for ring in district["rings"]]


def district_villages(villages: list[dict], boundaries: dict) -> list[dict]:
    rings = district_rings(boundaries)
    return [village for village in villages if inside(village["lon"], village["lat"], rings)]


BALANCING_ROUNDS = 10


def place_centres(villages: list[dict], detections: dict[str, int], count: int, average_machines: int) -> list[Centre]:
    """`count` centres: farthest-point sampling from the hotspot, then balancing rounds; each village to its nearest centre."""
    ordered = sorted(villages, key=lambda village: village["id"])  # a fixed order for every tie
    first = max(ordered, key=lambda village: detections.get(village["id"], 0))
    bases = [first]
    nearest = {village["id"]: haversine_km(first["lat"], first["lon"], village["lat"], village["lon"]) for village in ordered}
    while len(bases) < min(count, len(ordered)):
        farthest = max(ordered, key=lambda village: nearest[village["id"]])
        bases.append(farthest)
        for village in ordered:
            nearest[village["id"]] = min(nearest[village["id"]], haversine_km(farthest["lat"], farthest["lon"], village["lat"], village["lon"]))
    def assign() -> dict[int, list[dict]]:
        groups: dict[int, list[dict]] = {index: [] for index in range(len(bases))}
        for village in ordered:
            distances = [haversine_km(base["lat"], base["lon"], village["lat"], village["lon"]) for base in bases]
            groups[distances.index(min(distances))].append(village)
        return groups

    served = assign()
    for _round in range(BALANCING_ROUNDS):
        moved = False
        for index, members in served.items():
            if not members:
                continue
            middle_lat = sum(village["lat"] for village in members) / len(members)
            middle_lon = sum(village["lon"] for village in members) / len(members)
            closest = min(members, key=lambda village: haversine_km(middle_lat, middle_lon, village["lat"], village["lon"]))
            if closest["id"] != bases[index]["id"]:
                bases[index], moved = closest, True
        served = assign()
        if not moved:
            break
    # Bigger catchments get bigger fleets, so every machine carries the same acres (an average of
    # `average_machines` per centre, never fewer than one).
    mean_villages = len(ordered) / len(bases)
    return [
        Centre(
            index=index,
            base={key: base[key] for key in ("id", "name", "lat", "lon")},
            villages=tuple(sorted(served[index], key=lambda village: village["name"])),
            machines=max(1, round(average_machines * len(served[index]) / mean_villages)),
        )
        for index, base in enumerate(bases)
    ]


def district_centres(villages_all: list[dict], curves: dict, count: int, average_machines: int, boundaries: dict | None = None) -> list[Centre]:
    boundaries = boundaries or load_boundaries()
    detections = {curve["villageId"]: int(curve.get("detections", 0)) for curve in curves["villages"]}
    return place_centres(district_villages(villages_all, boundaries), detections, count, average_machines)
