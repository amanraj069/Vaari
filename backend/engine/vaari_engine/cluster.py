"""A seeded, SIMULATED village cluster to plan: the demo CHC's season, reproducible from a seed.

Why it exists: `npm run plan -- --seed 1` and the coming season simulator need a realistic problem
without the API or a database. It mirrors the API's demo season (backend/src/demo/seed.ts): the
Balian cooperative, the real OpenStreetMap villages within 6 km, four machines on the cautious speed
prior, and each field's ready day drawn from its village's harvest curve, which is built from real
NASA FIRMS fire detections (2024 and 2025). Farmers, fields and machines are simulated. Field sizes,
waiting limits and the booking window are assumptions, the same ones the API's seed uses.
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .contract import SolveRequest
from .geo import haversine_km
from .rates import learn_rate

SEASON_START_DATE = "2026-10-01"  # day 0; the harvest curves also count from 1 October
DEMO_TODAY = "2026-10-31"  # the API's DEMO_TODAY default
OPTIMUM_LAST_DATE = "2026-11-15"  # PAU Package of Practices, Rabi 2025-26: first fortnight of November
BASE_VILLAGE_NAME = "Balian"
CLUSTER_RADIUS_KM = 6
DEFAULT_FIELD_COUNT = 34
DEFAULT_MACHINE_COUNT = 4
MACHINE_HOURS_PER_DAY = 8  # assumed, as in the API seed
# ASSUMPTIONS, the same as backend/src/demo/seed.ts (swept in the simulator later).
FIELD_SIZES_ACRES = [1.5, 2, 2.5, 3, 3, 3.5, 4, 4, 5, 6]
WAITING_LIMIT_MIN_DAYS = 3
WAITING_LIMIT_MAX_DAYS = 10
BOOKING_WINDOW_DAYS_BEFORE = 2
BOOKING_WINDOW_DAYS_AFTER = 7


@dataclass(frozen=True)
class Cluster:
    request: SolveRequest
    seed: int
    base_village_name: str
    village_names: dict[str, str]
    machine_names: dict[str, str]
    season_start_date: str


def default_data_dir() -> Path:
    configured = os.environ.get("DATA_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[3] / "data"  # vaari_engine -> engine -> backend -> repo


def date_to_day(iso_date: str) -> int:
    return (date.fromisoformat(iso_date) - date.fromisoformat(SEASON_START_DATE)).days


def day_to_date(day: int) -> date:
    return date.fromordinal(date.fromisoformat(SEASON_START_DATE).toordinal() + day)


def _sample_ready_day(distribution: list[list[float]], rng: random.Random, from_day: int, to_day: int) -> int | None:
    """Draw a day from a (day, probability) curve restricted to [from_day, to_day] (as harvest.ts)."""
    in_range = [(int(day), probability) for day, probability in distribution if from_day <= day <= to_day]
    total = sum(probability for _day, probability in in_range)
    if total <= 0:
        return None
    threshold = rng.random() * total
    for day, probability in in_range:
        threshold -= probability
        if threshold < 0:
            return day
    return in_range[-1][0]


def seeded_cluster(
    seed: int,
    today_date: str = DEMO_TODAY,
    field_count: int = DEFAULT_FIELD_COUNT,
    machine_count: int = DEFAULT_MACHINE_COUNT,
    data_dir: Path | None = None,
) -> Cluster:
    data_dir = data_dir or default_data_dir()
    try:
        villages = json.loads((data_dir / "villages.json").read_text())["villages"]
        curves = json.loads((data_dir / "harvest_curves.json").read_text())
    except FileNotFoundError as error:
        raise FileNotFoundError(
            f"{error.filename} is missing: the seeded cluster needs data/villages.json and data/harvest_curves.json"
        ) from error

    base = next((village for village in villages if village["name"] == BASE_VILLAGE_NAME), None)
    if base is None:
        raise ValueError(f"{BASE_VILLAGE_NAME} missing from villages.json")
    cluster_villages = sorted(
        (
            village
            for village in villages
            if haversine_km(base["lat"], base["lon"], village["lat"], village["lon"]) <= CLUSTER_RADIUS_KM
        ),
        key=lambda village: village["name"],
    )
    curve_by_village = {curve["villageId"]: curve["readyDays"] for curve in curves["villages"]}

    rng = random.Random(seed)
    today = date_to_day(today_date)
    window_from, window_to = today - BOOKING_WINDOW_DAYS_BEFORE, today + BOOKING_WINDOW_DAYS_AFTER
    prior = learn_rate([])
    machine_names = {
        f"m{index + 1}": ("Happy Seeder" if index == 3 else f"Super Seeder {index + 1}") for index in range(machine_count)
    }
    fields = []
    for order in range(field_count):
        village = cluster_villages[rng.randrange(len(cluster_villages))]
        # The village's own curve (which may itself be blended toward the district), else the district's.
        ready_day = _sample_ready_day(curve_by_village.get(village["id"], []), rng, window_from, window_to)
        if ready_day is None:
            ready_day = _sample_ready_day(curves["district"]["readyDays"], rng, window_from, window_to)
        if ready_day is None:
            raise ValueError(f"no harvest-curve days between day {window_from} and {window_to}; pick another --today")
        fields.append(
            {
                "id": f"f-{order + 1:02d}",
                "villageId": village["id"],
                "acres": FIELD_SIZES_ACRES[rng.randrange(len(FIELD_SIZES_ACRES))],
                "readyDay": ready_day,
                "waitingLimitDays": rng.randint(WAITING_LIMIT_MIN_DAYS, WAITING_LIMIT_MAX_DAYS),
                "requestOrder": order,
            }
        )

    request = SolveRequest.model_validate(
        {
            "seasonStartDate": SEASON_START_DATE,
            "today": today,
            "horizonDays": 10,
            "optimumLastDay": date_to_day(OPTIMUM_LAST_DATE),
            "base": {"lat": base["lat"], "lon": base["lon"]},
            "villages": [{key: village[key] for key in ("id", "name", "lat", "lon")} for village in cluster_villages],
            "machines": [
                {
                    "id": machine_id,
                    "name": name,
                    "hoursPerDay": MACHINE_HOURS_PER_DAY,
                    "rate": {
                        "promiseAcresPerHour": prior.promise_acres_per_hour,
                        "planAcresPerHour": prior.plan_acres_per_hour,
                    },
                    "downDays": [],
                }
                for machine_id, name in machine_names.items()
            ],
            "fields": fields,
            "settings": {"method": "search", "searchSeed": seed},
        }
    )
    return Cluster(
        request=request,
        seed=seed,
        base_village_name=BASE_VILLAGE_NAME,
        village_names={village["id"]: village["name"] for village in cluster_villages},
        machine_names=machine_names,
        season_start_date=SEASON_START_DATE,
    )
