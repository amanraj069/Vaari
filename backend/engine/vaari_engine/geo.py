"""Travel distances between the CHC base and villages.

Why it exists: the solver needs travel minutes to keep each machine-day inside its working hours.
Until the Amazon Location route matrix is wired, distance is straight-line (haversine) times an
assumed road factor, at an assumed tractor road speed. Both assumptions live in Settings.
"""

from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    lat_a_rad, lat_b_rad = math.radians(lat_a), math.radians(lat_b)
    delta_lat = lat_b_rad - lat_a_rad
    delta_lon = math.radians(lon_b - lon_a)
    chord = math.sin(delta_lat / 2) ** 2 + math.cos(lat_a_rad) * math.cos(lat_b_rad) * math.sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(chord))


class TravelMatrix:
    """Road kilometres and minutes between named points ("base" plus every village id)."""

    def __init__(self, points: dict[str, tuple[float, float]], road_factor: float, road_speed_kmh: float) -> None:
        self.road_speed_kmh = road_speed_kmh
        self.km: dict[tuple[str, str], float] = {}
        for origin_id, (origin_lat, origin_lon) in points.items():
            for destination_id, (destination_lat, destination_lon) in points.items():
                straight_km = haversine_km(origin_lat, origin_lon, destination_lat, destination_lon)
                self.km[(origin_id, destination_id)] = straight_km * road_factor

    def road_km(self, origin_id: str, destination_id: str) -> float:
        return self.km[(origin_id, destination_id)]

    def minutes(self, origin_id: str, destination_id: str) -> int:
        return math.ceil(self.km[(origin_id, destination_id)] / self.road_speed_kmh * 60)
