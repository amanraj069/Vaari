"""Turns a SolveRequest into the facts the solver works with.

Why it exists: the CP-SAT model, the greedy fallback, the route builder and the explainer all need
the same derived facts (plan days, jobs, work minutes, travel bounds, the phone-queue baseline).
Computing them once here keeps those four in agreement.

A field larger than one machine-day of work is split into equal parts ("jobs"); a field counts as
sown on the day its last part is sown.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .contract import FirmPromise, Machine, SolveRequest, WindowPromise
from .geo import TravelMatrix

BASE_ID = "base"


@dataclass(frozen=True)
class Job:
    job_id: str
    field_id: str
    part: int
    parts: int
    village_id: str
    acres: float
    ready_day: int
    burn_deadline: int
    request_order: int
    promise: FirmPromise | WindowPromise | None
    previous_day: int | None


def promise_bounds(promise: FirmPromise | WindowPromise) -> tuple[int | None, int]:
    """(earliest day, latest day) a promise allows. A firm promise is met on or before its day."""
    if isinstance(promise, FirmPromise):
        return None, promise.day
    return promise.start_day, promise.end_day


def promise_latest_day(promise: FirmPromise | WindowPromise) -> int:
    return promise.day if isinstance(promise, FirmPromise) else promise.end_day


class Problem:
    def __init__(self, request: SolveRequest) -> None:
        self.request = request
        self.settings = request.settings
        self.plan_start = request.today + 1
        self.horizon_end = self.plan_start + request.horizon_days  # exclusive
        rain_days = set(request.rain_days)
        self.rain_days = rain_days
        self.plan_days = [day for day in range(self.plan_start, self.horizon_end)]
        self.sowing_days = [day for day in self.plan_days if day not in rain_days]
        self.machines: list[Machine] = list(request.machines)
        self.machine_by_id = {machine.id: machine for machine in self.machines}
        self.villages = {village.id: village for village in request.villages}

        points = {BASE_ID: (request.base.lat, request.base.lon)}
        points.update({village.id: (village.lat, village.lon) for village in request.villages})
        self.travel = TravelMatrix(points, self.settings.road_factor, self.settings.road_speed_kmh)

        # Upper bound on travel for any day that visits a village: base -> village -> base.
        # By the triangle inequality, a real route through several villages is never longer
        # than the sum of these round trips, so a plan that fits this bound always fits the day.
        self.round_trip_minutes = {
            village_id: self.travel.minutes(BASE_ID, village_id) + self.travel.minutes(village_id, BASE_ID)
            for village_id in self.villages
        }
        self.round_trip_km = {
            village_id: self.travel.road_km(BASE_ID, village_id) * 2 for village_id in self.villages
        }

        self.jobs: list[Job] = []
        self.jobs_by_field: dict[str, list[Job]] = {}
        self.field_by_id = {field.id: field for field in request.fields}
        for field in request.fields:
            parts = self._parts_needed(field.village_id, field.acres)
            part_acres = field.acres / parts
            field_jobs = [
                Job(
                    job_id=f"{field.id}#{part_index}",
                    field_id=field.id,
                    part=part_index,
                    parts=parts,
                    village_id=field.village_id,
                    acres=part_acres,
                    ready_day=field.ready_day,
                    burn_deadline=field.ready_day + field.waiting_limit_days,
                    request_order=field.request_order,
                    promise=field.promise,
                    previous_day=field.previous_day,
                )
                for part_index in range(1, parts + 1)
            ]
            self.jobs.extend(field_jobs)
            self.jobs_by_field[field.id] = field_jobs

        self.queue_day_by_field = self._phone_queue_days()

    def capacity_minutes(self, machine: Machine) -> int:
        return int(machine.hours_per_day * 60)

    def work_minutes(self, acres: float, machine: Machine, use_plan_rate: bool) -> int:
        rate = machine.rate.plan_acres_per_hour if use_plan_rate else machine.rate.promise_acres_per_hour
        return self.settings.setup_minutes_per_field + math.ceil(acres / rate * 60)

    def machine_works(self, machine: Machine, day: int) -> bool:
        return day not in self.rain_days and day not in machine.down_days

    def candidate_days(self, job: Job) -> list[int]:
        """Days a job could be sown, before any promise is applied."""
        return [day for day in self.sowing_days if day >= job.ready_day]

    def _parts_needed(self, village_id: str, acres: float) -> int:
        # Size parts so that one part fits a day on the slowest machine at the cautious rate.
        usable_acres = []
        for machine in self.machines:
            usable_minutes = (
                self.capacity_minutes(machine)
                - self.round_trip_minutes[village_id]
                - self.settings.setup_minutes_per_field
            )
            usable_acres.append(usable_minutes / 60 * machine.rate.promise_acres_per_hour)
        largest_part = min(usable_acres) if usable_acres else 0.0
        if largest_part <= 0:
            return 1  # village out of reach in one day: the solver will leave it unserved
        # Small tolerance so a field of exactly one day's capacity is not split by rounding.
        return max(1, math.ceil(acres / largest_part - 1e-9))

    def _phone_queue_days(self) -> dict[str, int | None]:
        """The day first-come-first-served would give each field, with the same capacity rules.

        This is the baseline for the fairness guard: no farmer should be pushed far behind it.
        """
        minutes_used: dict[tuple[str, int], int] = {}
        villages_visited: dict[tuple[str, int], set[str]] = {}
        queue_day_by_field: dict[str, int | None] = {}
        for field in sorted(self.request.fields, key=lambda item: item.request_order):
            last_day: int | None = None
            for job in self.jobs_by_field[field.id]:
                placed_day = None
                for day in self.candidate_days(job):
                    for machine in self.machines:
                        if not self.machine_works(machine, day):
                            continue
                        key = (machine.id, day)
                        visited = villages_visited.setdefault(key, set())
                        extra_travel = 0 if job.village_id in visited else self.round_trip_minutes[job.village_id]
                        needed = self.work_minutes(job.acres, machine, use_plan_rate=False) + extra_travel
                        if minutes_used.get(key, 0) + needed <= self.capacity_minutes(machine):
                            minutes_used[key] = minutes_used.get(key, 0) + needed
                            visited.add(job.village_id)
                            placed_day = day
                            break
                    if placed_day is not None:
                        break
                if placed_day is None:
                    last_day = None
                    break
                last_day = placed_day if last_day is None else max(last_day, placed_day)
            queue_day_by_field[field.id] = last_day
        return queue_day_by_field
