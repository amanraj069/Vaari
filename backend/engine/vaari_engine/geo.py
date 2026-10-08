"""Travel distances between the CHC base and villages.

Why it exists: the planners need travel minutes to keep each machine-day inside its working hours,
and kilometres to compare plans. Where those numbers come from is swappable behind TravelSource:
- StraightLineTravel (the fallback, used today): haversine distance times an assumed road factor,
  at an assumed tractor road speed. Both assumptions live in Settings.
- GivenTravelMatrix: a road matrix supplied in the request. The engine never calls a map service
  itself (it has no AWS imports), so to use the Amazon Location route matrix the API fetches it and
  sends it as `travelMatrix`; nothing in the planners changes.
"""

from __future__ import annotations

import math
from typing import Protocol

from .contract import TravelMatrixInput

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    lat_a_rad, lat_b_rad = math.radians(lat_a), math.radians(lat_b)
    delta_lat = lat_b_rad - lat_a_rad
    delta_lon = math.radians(lon_b - lon_a)
    chord = math.sin(delta_lat / 2) ** 2 + math.cos(lat_a_rad) * math.cos(lat_b_rad) * math.sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(chord))


class TravelSource(Protocol):
    """Road kilometres and whole minutes between named points ("base" plus every village id)."""

    source: str

    def road_km(self, origin_id: str, destination_id: str) -> float: ...

    def minutes(self, origin_id: str, destination_id: str) -> int: ...


class StraightLineTravel:
    """Fallback: straight-line distance times a road factor, at a fixed road speed (both assumed)."""

    source = "straight-line"

    def __init__(self, points: dict[str, tuple[float, float]], road_factor: float, road_speed_kmh: float) -> None:
        self.km: dict[tuple[str, str], float] = {}
        self.minutes_by_pair: dict[tuple[str, str], int] = {}
        for origin_id, (origin_lat, origin_lon) in points.items():
            for destination_id, (destination_lat, destination_lon) in points.items():
                road_km = haversine_km(origin_lat, origin_lon, destination_lat, destination_lon) * road_factor
                self.km[(origin_id, destination_id)] = road_km
                self.minutes_by_pair[(origin_id, destination_id)] = math.ceil(road_km / road_speed_kmh * 60)

    def road_km(self, origin_id: str, destination_id: str) -> float:
        return self.km[(origin_id, destination_id)]

    def minutes(self, origin_id: str, destination_id: str) -> int:
        return self.minutes_by_pair[(origin_id, destination_id)]


class GivenTravelMatrix:
    """A road matrix computed elsewhere (for example the Amazon Location route matrix, by the API)."""

    def __init__(self, matrix: TravelMatrixInput, required_point_ids: list[str]) -> None:
        self.source = matrix.source
        missing = sorted(set(required_point_ids) - set(matrix.point_ids))
        if missing:
            raise ValueError(f"travelMatrix has no row for: {', '.join(missing[:5])}")
        self.km: dict[tuple[str, str], float] = {}
        self.minutes_by_pair: dict[tuple[str, str], int] = {}
        for origin_index, origin_id in enumerate(matrix.point_ids):
            for destination_index, destination_id in enumerate(matrix.point_ids):
                self.km[(origin_id, destination_id)] = matrix.km[origin_index][destination_index]
                self.minutes_by_pair[(origin_id, destination_id)] = matrix.minutes[origin_index][destination_index]

    def road_km(self, origin_id: str, destination_id: str) -> float:
        return self.km[(origin_id, destination_id)]

    def minutes(self, origin_id: str, destination_id: str) -> int:
        return self.minutes_by_pair[(origin_id, destination_id)]
