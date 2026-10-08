"""Exact optimum by enumeration, and tiny random instances to run it on.

Why it exists: the only honest way to say how good the search planner is, is to compare it with
the true optimum. This oracle shares nothing with search.py except the objective's definition
(objective.field_terms): it enumerates every day (or "unserved") for every job, packs each day's
jobs onto machines by trying every machine choice, and checks capacity with its own tour code.
Promises are hard here: a promised job must be sown inside its promise.
"""

from __future__ import annotations

import itertools
import random
from typing import Any

from conftest import BASE, VILLAGES
from vaari_engine.contract import SolveRequest
from vaari_engine.objective import ObjectiveValue, field_terms
from vaari_engine.problem import BASE_ID, Assignment, Job, Problem, promise_bounds

Slot = tuple[str, int]


def tour_minutes_and_metres(problem: Problem, village_ids: frozenset[str]) -> tuple[int, int]:
    """Shortest tour CHC -> villages -> CHC in minutes; ties go to the first order in sorted
    permutation order (the same tie rule as route.py), and its kilometres become metres."""
    if not village_ids:
        return 0, 0
    best_minutes: int | None = None
    best_km = 0.0
    for order in itertools.permutations(sorted(village_ids)):
        stops = [BASE_ID, *order, BASE_ID]
        minutes = sum(problem.travel.minutes(origin, destination) for origin, destination in zip(stops, stops[1:]))
        if best_minutes is None or minutes < best_minutes:
            best_minutes = minutes
            best_km = sum(problem.travel.road_km(origin, destination) for origin, destination in zip(stops, stops[1:]))
    assert best_minutes is not None
    return best_minutes, round(best_km * 1000)


def machine_day_fits(problem: Problem, machine_id: str, day: int, jobs: list[Job]) -> tuple[bool, int]:
    """Whether these jobs fit one machine-day (cautious rate + shortest tour), and its metres."""
    machine = problem.machine_by_id[machine_id]
    if day in machine.down_days or day in problem.rain_days:
        return (not jobs), 0
    work = sum(problem.work_minutes(job.acres, machine, use_plan_rate=False) for job in jobs)
    minutes, metres = tour_minutes_and_metres(problem, frozenset(job.village_id for job in jobs))
    return work + minutes <= machine.hours_per_day * 60, metres


def day_options(problem: Problem, job: Job) -> list[int | None]:
    """Days a job may take (ready, no rain, inside its promise), plus None when it may stay unserved."""
    days: list[int | None] = list(problem.candidate_days(job))
    if job.promise is not None:
        earliest, latest = promise_bounds(job.promise)
        days = [day for day in days if day is not None and day <= latest and (earliest is None or day >= earliest)]
        return days  # a promised job must be sown inside its promise
    return [*days, None]


def best_packing(problem: Problem, day: int, jobs: tuple[Job, ...]) -> tuple[int, dict[str, str]] | None:
    """Least-travel way to put these jobs on the machines working this day, or None if none fits."""
    machines = [machine.id for machine in problem.machines if problem.machine_works(machine, day)]
    if not jobs:
        return 0, {}
    best: tuple[int, dict[str, str]] | None = None
    for choice in itertools.product(machines, repeat=len(jobs)):
        total_metres = 0
        feasible = True
        for machine_id in machines:
            on_machine = [job for job, chosen in zip(jobs, choice) if chosen == machine_id]
            fits, metres = machine_day_fits(problem, machine_id, day, on_machine)
            if not fits:
                feasible = False
                break
            total_metres += metres
        if feasible and (best is None or total_metres < best[0]):
            best = (total_metres, {job.job_id: chosen for job, chosen in zip(jobs, choice)})
    return best


def brute_force(problem: Problem) -> tuple[ObjectiveValue, Assignment] | None:
    """The lexicographic optimum with every promise kept, or None if no such plan exists."""
    jobs = problem.jobs
    options = [day_options(problem, job) for job in jobs]
    packing_cache: dict[tuple[int, tuple[str, ...]], tuple[int, dict[str, str]] | None] = {}
    best_value: ObjectiveValue | None = None
    best_assignment: Assignment | None = None
    for days in itertools.product(*options):
        day_of_job = {job.job_id: day for job, day in zip(jobs, days)}
        # Field-level terms depend only on days; travel is the best packing of each day.
        totals = [0] * 8
        for field_id, field_jobs in problem.jobs_by_field.items():
            terms = field_terms(problem, field_id, [day_of_job[job.job_id] for job in field_jobs])
            totals[0] += terms.broken
            totals[1] += terms.broken_slack
            totals[2] += terms.late
            totals[3] += terms.unserved
            totals[4] += terms.wheat_loss_grams
            totals[6] += terms.fairness_slack_days
            totals[7] += terms.waiting_centiacre_days
        if best_value is not None and tuple(totals[:5]) > tuple(best_value[:5]):
            continue  # already worse before travel; travel cannot rescue it
        machine_by_job: dict[str, str] = {}
        feasible = True
        for day in sorted({day for day in days if day is not None}):
            day_jobs = tuple(job for job in jobs if day_of_job[job.job_id] == day)
            key = (day, tuple(job.job_id for job in day_jobs))
            if key not in packing_cache:
                packing_cache[key] = best_packing(problem, day, day_jobs)
            packing = packing_cache[key]
            if packing is None:
                feasible = False
                break
            totals[5] += packing[0]
            machine_by_job.update(packing[1])
        if not feasible:
            continue
        value = ObjectiveValue(*totals)
        if best_value is None or value < best_value:
            best_value = value
            best_assignment = Assignment(method="search")
            for job in jobs:
                day = day_of_job[job.job_id]
                if day is None:
                    best_assignment.unserved_job_ids.add(job.job_id)
                else:
                    best_assignment.day_machine_by_job[job.job_id] = (machine_by_job[job.job_id], day)
    if best_value is None or best_assignment is None:
        return None
    return best_value, best_assignment


def tiny_request(seed: int) -> dict[str, Any]:
    """A small random instance: 3-5 fields (at most 6 jobs), 1-2 machines, 3-4 plan days, real
    village points near Sangrur, sometimes rain, a breakdown, wheat loss inside the horizon, and
    promises taken from a random feasible plan (so a plan keeping all of them always exists)."""
    rng = random.Random(seed)
    today = 30
    horizon = rng.randint(3, 4)
    villages = rng.sample(VILLAGES, rng.randint(2, 4))
    machines = []
    for index in range(rng.randint(1, 2)):
        promise_rate = rng.uniform(0.66, 1.0)
        machines.append(
            {
                "id": f"m{index + 1}",
                "name": f"M{index + 1}",
                "hoursPerDay": rng.choice([4, 6, 8]),
                "rate": {"promiseAcresPerHour": round(promise_rate, 3), "planAcresPerHour": round(promise_rate * 1.3, 3)},
                "downDays": [today + rng.randint(1, horizon)] if rng.random() < 0.3 else [],
            }
        )
    fields = []
    for index in range(rng.randint(3, 5)):
        fields.append(
            {
                "id": f"f{index}",
                "villageId": rng.choice(villages)["id"],
                "acres": rng.choice([0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]),
                "readyDay": today + rng.randint(0, horizon - 1),
                "waitingLimitDays": rng.randint(0, 4),
                "requestOrder": index,
            }
        )
    request = {
        "seasonStartDate": "2026-10-01",
        "today": today,
        "horizonDays": horizon,
        "optimumLastDay": today + rng.randint(0, horizon),
        "base": BASE,
        "villages": villages,
        "machines": machines,
        "fields": fields,
        "rainDays": [today + rng.randint(1, horizon)] if rng.random() < 0.25 else [],
        "settings": {"method": "search"},
    }
    # Keep it tiny: drop fields until there are at most 6 jobs (a big field splits into parts).
    while len(Problem(SolveRequest.model_validate(request)).jobs) > 6:
        request["fields"].pop()

    # Promises from a random feasible plan: place jobs in random order on random slots that fit.
    problem = Problem(SolveRequest.model_validate(request))
    jobs_in_slot: dict[Slot, list[Job]] = {}
    days_by_field: dict[str, list[int]] = {}
    shuffled = list(problem.jobs)
    rng.shuffle(shuffled)
    for job in shuffled:
        slots = [
            (machine.id, day)
            for day in problem.candidate_days(job)
            for machine in problem.machines
            if problem.machine_works(machine, day)
        ]
        rng.shuffle(slots)
        for machine_id, day in slots:
            trial = [*jobs_in_slot.get((machine_id, day), []), job]
            if machine_day_fits(problem, machine_id, day, trial)[0]:
                jobs_in_slot[(machine_id, day)] = trial
                days_by_field.setdefault(job.field_id, []).append(day)
                break
    for field in request["fields"]:
        part_days = days_by_field.get(field["id"], [])
        parts = len(problem.jobs_by_field[field["id"]])
        if len(part_days) < parts or rng.random() < 0.5:
            continue  # unplaced in the random plan, or simply not promised yet
        if rng.random() < 0.5:
            field["promise"] = {"kind": "firm", "day": max(part_days) + rng.randint(0, 1)}
        else:
            field["promise"] = {
                "kind": "window",
                "startDay": min(part_days) - rng.randint(0, 1),
                "endDay": max(part_days) + rng.randint(0, 1),
            }
    return request
