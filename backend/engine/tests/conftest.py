from __future__ import annotations

import random
from typing import Any

import pytest

# Real OSM points near Sangrur (data/derived/villages_sangrur.json).
VILLAGES = [
    {"id": "balian", "name": "Balian", "lat": 30.2798, "lon": 75.8996},
    {"id": "bhindran", "name": "Bhindran", "lat": 30.2665, "lon": 75.9143},
    {"id": "zulmgarh", "name": "Zulmgarh", "lat": 30.2809, "lon": 75.8739},
    {"id": "rupaheri", "name": "Rupaheri", "lat": 30.3013, "lon": 75.9041},
    {"id": "laddi", "name": "Laddi", "lat": 30.2899, "lon": 75.9339},
    {"id": "mangwal", "name": "Mangwal", "lat": 30.2546, "lon": 75.8712},
]
BASE = {"lat": 30.2798, "lon": 75.8996}
PROMISE_RATE = 0.83
PLAN_RATE = 1.08


def machine(machine_id: str, down_days: list[int] | None = None) -> dict[str, Any]:
    return {
        "id": machine_id,
        "name": machine_id.upper(),
        "hoursPerDay": 8,
        "rate": {"promiseAcresPerHour": PROMISE_RATE, "planAcresPerHour": PLAN_RATE},
        "downDays": down_days or [],
    }


def make_request(
    field_count: int = 12,
    machine_count: int = 2,
    seed: int = 1,
    today: int = 30,
    rain_days: list[int] | None = None,
) -> dict[str, Any]:
    rng = random.Random(seed)
    fields = []
    for index in range(field_count):
        fields.append(
            {
                "id": f"f{index:02d}",
                "villageId": VILLAGES[index % len(VILLAGES)]["id"],
                "acres": rng.choice([1.5, 2.0, 2.5, 3.0, 4.0]),
                "readyDay": today + rng.randint(0, 4),
                "waitingLimitDays": rng.randint(3, 10),
                "requestOrder": index,
            }
        )
    return {
        "seasonStartDate": "2026-10-01",
        "today": today,
        "horizonDays": 10,
        "optimumLastDay": 45,
        "base": BASE,
        "villages": VILLAGES,
        "machines": [machine(f"m{index + 1}") for index in range(machine_count)],
        "fields": fields,
        "rainDays": rain_days or [],
        "settings": {"timeLimitSeconds": 5},
    }


@pytest.fixture
def small_request() -> dict[str, Any]:
    return make_request()
