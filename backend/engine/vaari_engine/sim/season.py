"""One simulated season: fields, machines, breakdowns and rain, drawn from a seed.

Why it exists: the three policies must be compared on identical seasons, so a season is generated
once per run and then replayed under each policy. Ready days come from each village's real harvest
curve (data/harvest_curves.json); everything else follows data/sim/assumptions.json.

Farmers, machines, breakdowns and rain each come from their own random stream, so a scenario or a
sweep changes only what it names: a busier season ADDS farmers to the same ones (farmers are drawn
in a fixed order until the season holds its acres), half the machines are the first two of the same
four with the same breakdowns, and every season has the same rain.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..cluster import default_data_dir, load_reference_data, sample_ready_day
from .district import Centre, district_centres
from .rng import SplitMix64, derive_seed


@dataclass(frozen=True)
class SimField:
    id: str
    village_id: str
    acres: float
    ready_day: int
    waiting_limit_days: int
    request_day: int
    request_order: int

    @property
    def burn_deadline(self) -> int:
        """The last day the farmer waits while holding a promised date; sown after this, they would have burned."""
        return self.ready_day + self.waiting_limit_days


@dataclass(frozen=True)
class SimMachine:
    id: str
    name: str
    acres_per_hour: float  # true speed, unknown to the planners (Vaari learns it from work done)
    hours_per_day: float


@dataclass(frozen=True)
class Breakdown:
    machine_id: str
    start_day: int
    days: int

    def covers(self, day: int) -> bool:
        return self.start_day <= day < self.start_day + self.days


@dataclass(frozen=True)
class Season:
    scenario: str
    run: int
    fields: list[SimField]
    machines: list[SimMachine]
    breakdowns: list[Breakdown]
    rain_days: frozenset[int]
    villages: list[dict]  # id, name, lat, lon
    base: dict  # lat, lon
    first_day: int  # the evening the first farmer calls
    last_day: int  # the last day machines work in this simulation
    optimum_last_day: int
    setup_minutes: int
    road_factor: float
    road_speed_kmh: float
    # Farmers with no promised date give up this many days sooner (0 in the base season).
    days_sooner_without_date: int
    # The phone queue as a rental desk: back to the CHC between rentals (False: straight on).
    phone_queue_returns_to_chc: bool
    # Chance that a phone-queue rental comes back late: the farmer keeps the machine for the rest
    # of that day (CEEW: delayed returns, mostly where the machine is rented without a driver).
    phone_queue_late_return_chance: float
    # Seeds each rental's late-return draw, so a rental is late or not whatever else changes.
    late_return_seed: int

    def rental_returns_late(self, field_id: str, day: int) -> bool:
        if self.phone_queue_late_return_chance <= 0:
            return False
        return SplitMix64(derive_seed(self.late_return_seed, field_id, day)).random() < self.phone_queue_late_return_chance

    def gives_up_after(self, item: SimField, holds_promise: bool) -> int:
        """The last day this farmer still waits: their full limit with a promised date, fewer days without one."""
        if holds_promise:
            return item.burn_deadline
        return item.ready_day + max(0, item.waiting_limit_days - self.days_sooner_without_date)

    def machine_down(self, machine_id: str, day: int) -> bool:
        return any(item.machine_id == machine_id and item.covers(day) for item in self.breakdowns)

    def known_down_days(self, machine_id: str, evening: int) -> list[int]:
        """Down days an operator knows on this evening: a breakdown is known the evening before it starts."""
        days: list[int] = []
        for item in self.breakdowns:
            if item.machine_id == machine_id and item.start_day <= evening + 1:
                days.extend(range(item.start_day, item.start_day + item.days))
        return sorted(set(days))

    def known_rain_days(self, evening: int) -> list[int]:
        """Rain is forecast the evening before; the planners know nothing further ahead."""
        return sorted(day for day in self.rain_days if day <= evening + 1)


@dataclass(frozen=True)
class Assumptions:
    raw: dict[str, Any] = field(repr=False)

    def input(self, name: str) -> dict[str, Any]:
        return self.raw["inputs"][name]

    def constant(self, name: str) -> Any:
        return self.raw["constants"][name]["value"]


def load_assumptions(path: Path | None = None) -> Assumptions:
    path = path or default_data_dir() / "sim" / "assumptions.json"
    return Assumptions(json.loads(path.read_text()))


# Breakdowns and rain are drawn over a fixed calendar (day 0 to here), so they do not shift when a
# busier season adds farmers. It covers the last ready day plus the longest wait plus three weeks.
CALENDAR_DAYS = 120


def generate_season(
    assumptions: Assumptions,
    seed: int,
    scenario: str,
    run: int,
    overrides: dict[str, Any] | None = None,
    reference: tuple[list[dict], dict] | None = None,
    centre: Centre | None = None,
) -> Season:
    """One centre's season for (seed, scenario, run): its farmers, its machines, and the district's
    weather. Without `centre`, the district's first centre (the fire hotspot). `overrides` replace
    inputs by name: machines (this centre's fleet), machineShare (this share of the centre's fleet,
    rounded half up, at least one: the capacity-shortfall scenario), acresPerMachine,
    waitingLimitDays (every farmer waits exactly this long), daysSoonerWithoutDate,
    phoneQueueReturnsToChc, phoneQueueLateReturnChance."""
    overrides = overrides or {}
    value = lambda name: overrides.get(name, assumptions.input(name).get("value"))  # noqa: E731
    villages_all, curves = reference or load_reference_data()
    centre = centre or centres_of(assumptions, (villages_all, curves))[0]
    base, villages = centre.base, list(centre.villages)
    # Streams per centre (farmers, waits, machines, late returns); the weather is the district's.
    own = ("centre", centre.index)
    prefix = f"c{centre.index:02d}-"
    curve_by_village = {curve["villageId"]: curve["readyDays"] for curve in curves["villages"]}
    window = assumptions.input("seasonWindow")
    sizes = assumptions.input("fieldAcres")["values"]
    wait = assumptions.input("waitingLimitDays")
    lead = assumptions.input("requestLeadDays")
    fixed_wait = overrides.get("waitingLimitDays")
    field_rng = SplitMix64(derive_seed(seed, scenario, run, *own, "fields"))
    # The waiting limit is drawn from its own stream, so fixing it (the sweep) leaves the rest alone.
    wait_rng = SplitMix64(derive_seed(seed, scenario, run, *own, "wait"))

    # The acres booked: per machine of the centre's own fleet, so a smaller fleet keeps the same farmers.
    target_acres = float(value("acresPerMachine")) * centre.machines
    drafts = []
    total_acres = 0.0
    while total_acres < target_acres:
        index = len(drafts)
        village = field_rng.choice(villages)
        ready_day = sample_ready_day(curve_by_village.get(village["id"], []), field_rng, window["firstReadyDay"], window["lastReadyDay"])
        if ready_day is None:
            ready_day = sample_ready_day(curves["district"]["readyDays"], field_rng, window["firstReadyDay"], window["lastReadyDay"])
        assert ready_day is not None, "the district curve covers the season window"
        acres = float(field_rng.choice(sizes))
        request_day = ready_day - field_rng.randint(lead["min"], lead["max"])
        tie_break = field_rng.random()  # who got through on the phone first, among same-day callers
        drawn_wait = wait_rng.randint(wait["min"], wait["max"])
        limit = int(fixed_wait) if fixed_wait is not None else drawn_wait
        drafts.append((request_day, tie_break, index, village["id"], acres, ready_day, limit))
        total_acres += acres

    # The phone queue's order: by the day the farmer called, then who got through first.
    drafts.sort(key=lambda item: (item[0], item[1], item[2]))
    fields = [
        SimField(
            id=f"{prefix}s{index:03d}",
            village_id=village_id,
            acres=acres,
            ready_day=ready_day,
            waiting_limit_days=limit,
            request_day=request_day,
            request_order=order,
        )
        for order, (request_day, _tie, index, village_id, acres, ready_day, limit) in enumerate(drafts)
    ]

    speed = assumptions.input("machineAcresPerDay")
    hours = assumptions.input("machineHoursPerDay")["value"]
    breakdown_chance = assumptions.input("breakdownChancePerMachineDay")["value"]
    breakdown_days = assumptions.input("breakdownDays")
    machines: list[SimMachine] = []
    breakdowns: list[Breakdown] = []
    fleet = int(overrides.get("machines", centre.machines))
    if "machineShare" in overrides:
        # Fewer machines for the same farmers (the booked acres above use the full fleet).
        fleet = max(1, math.floor(centre.machines * float(overrides["machineShare"]) + 0.5))
    for number in range(1, fleet + 1):
        # One stream per machine: machine 2 is the same machine, with the same breakdowns, in every scenario.
        machine_rng = SplitMix64(derive_seed(seed, scenario, run, *own, "machine", number))
        machine = SimMachine(
            id=f"{prefix}m{number}", name=f"{base['name']} {number}", acres_per_hour=machine_rng.uniform(speed["min"], speed["max"]) / hours, hours_per_day=hours
        )
        machines.append(machine)
        day = 1
        while day <= CALENDAR_DAYS:
            if machine_rng.random() < breakdown_chance:
                length = machine_rng.randint(breakdown_days["min"], breakdown_days["max"])
                breakdowns.append(Breakdown(machine.id, day, length))
                day += length
            else:
                day += 1
    rain_rng = SplitMix64(derive_seed(seed, scenario, run, "rain"))
    rain_chance = assumptions.input("rainChancePerDay")["value"]
    all_rain = [day for day in range(1, CALENDAR_DAYS + 1) if rain_rng.random() < rain_chance]

    first_day = min(item.request_day for item in fields)
    # Long enough for every policy to finish or give up: the last farmer's wait plus three weeks.
    last_day = max(item.burn_deadline for item in fields) + 21
    assert last_day <= CALENDAR_DAYS, "the calendar must cover the season"

    return Season(
        scenario=scenario,
        run=run,
        fields=fields,
        machines=machines,
        breakdowns=[item for item in breakdowns if item.start_day + item.days > first_day and item.start_day <= last_day],
        rain_days=frozenset(day for day in all_rain if first_day < day <= last_day),
        villages=[{key: village[key] for key in ("id", "name", "lat", "lon")} for village in villages],
        base={"lat": base["lat"], "lon": base["lon"]},
        first_day=first_day,
        last_day=last_day,
        optimum_last_day=int(assumptions.constant("optimumLastDay")),
        setup_minutes=int(assumptions.input("setupMinutesPerField")["value"]),
        road_factor=float(assumptions.input("roadFactor")["value"]),
        road_speed_kmh=float(assumptions.input("roadSpeedKmh")["value"]),
        days_sooner_without_date=int(value("daysSoonerWithoutDate")),
        phone_queue_returns_to_chc=bool(overrides.get("phoneQueueReturnsToChc", True)),
        phone_queue_late_return_chance=float(value("phoneQueueLateReturnChance")),
        late_return_seed=derive_seed(seed, scenario, run, *own, "late-returns"),
    )


_CENTRES: dict[tuple[int, int, int], list[Centre]] = {}


def centres_of(assumptions: Assumptions, reference: tuple[list[dict], dict], count: int | None = None) -> list[Centre]:
    """The district's machine centres (placed once per process; the placement is fixed arithmetic)."""
    count = count or int(assumptions.input("machineCentres")["value"])
    average = int(assumptions.input("machines")["value"])
    key = (count, average, len(reference[0]))
    if key not in _CENTRES:
        _CENTRES[key] = district_centres(reference[0], reference[1], count, average)
    return _CENTRES[key]
