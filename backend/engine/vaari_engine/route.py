"""Stage 2 of planning: the exact order of each machine-day's stops.

Why it exists: CP-SAT decided which fields a machine sows on a day using a safe travel bound.
This module finds the shortest real order (CHC -> villages -> CHC) and the clock time of every
stop. A machine-day rarely visits more than a handful of villages, so the order is exact:
brute force up to 7 villages, Held-Karp dynamic programming up to 12.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

from .contract import Machine, Route, Stop, WindowPromise
from .problem import BASE_ID, Job, Problem

EXACT_BRUTE_FORCE_LIMIT = 7
EXACT_DYNAMIC_LIMIT = 12


@dataclass(frozen=True)
class RouteJob:
    job: Job
    stretch: bool


def shortest_village_order(problem: Problem, village_ids: list[str]) -> list[str]:
    """Village order minimising travel minutes for a tour that starts and ends at the CHC."""
    if len(village_ids) <= 1:
        return list(village_ids)
    minutes = problem.travel.minutes

    def tour_minutes(order: tuple[str, ...]) -> int:
        total = minutes(BASE_ID, order[0]) + minutes(order[-1], BASE_ID)
        for previous_id, next_id in zip(order, order[1:]):
            total += minutes(previous_id, next_id)
        return total

    if len(village_ids) <= EXACT_BRUTE_FORCE_LIMIT:
        # Sorted input keeps ties deterministic.
        best = min(itertools.permutations(sorted(village_ids)), key=tour_minutes)
        return list(best)

    if len(village_ids) <= EXACT_DYNAMIC_LIMIT:
        ordered_ids = sorted(village_ids)
        count = len(ordered_ids)
        # cost[(visited_mask, last_index)] = (minutes, previous_index)
        cost: dict[tuple[int, int], tuple[int, int]] = {}
        for index, village_id in enumerate(ordered_ids):
            cost[(1 << index, index)] = (minutes(BASE_ID, village_id), -1)
        for mask in range(1, 1 << count):
            for last in range(count):
                if (mask, last) not in cost:
                    continue
                current_minutes = cost[(mask, last)][0]
                for following in range(count):
                    if mask & (1 << following):
                        continue
                    next_mask = mask | (1 << following)
                    candidate = current_minutes + minutes(ordered_ids[last], ordered_ids[following])
                    if (next_mask, following) not in cost or candidate < cost[(next_mask, following)][0]:
                        cost[(next_mask, following)] = (candidate, last)
        full_mask = (1 << count) - 1
        last = min(range(count), key=lambda index: cost[(full_mask, index)][0] + minutes(ordered_ids[index], BASE_ID))
        order_indices = []
        mask = full_mask
        while last != -1:
            order_indices.append(last)
            previous = cost[(mask, last)][1]
            mask ^= 1 << last
            last = previous
        return [ordered_ids[index] for index in reversed(order_indices)]

    # Beyond 12 villages in a day (not expected): nearest neighbour.
    remaining = set(village_ids)
    order: list[str] = []
    current = BASE_ID
    while remaining:
        nearest = min(sorted(remaining), key=lambda village_id: minutes(current, village_id))
        order.append(nearest)
        remaining.remove(nearest)
        current = nearest
    return order


def build_route(problem: Problem, machine: Machine, day: int, route_jobs: list[RouteJob]) -> Route:
    """Order stops and time them at the machine's median rate (the plan rate)."""
    jobs_by_village: dict[str, list[RouteJob]] = {}
    for route_job in route_jobs:
        jobs_by_village.setdefault(route_job.job.village_id, []).append(route_job)
    village_order = shortest_village_order(problem, list(jobs_by_village))

    clock = problem.settings.day_start_minute
    location = BASE_ID
    travel_km = 0.0
    stops: list[Stop] = []
    for village_id in village_order:
        travel_minutes = problem.travel.minutes(location, village_id)
        travel_km += problem.travel.road_km(location, village_id)
        location = village_id
        # Inside a village: core stops first, then by burn deadline (most urgent first).
        village_jobs = sorted(
            jobs_by_village[village_id],
            key=lambda item: (item.stretch, item.job.burn_deadline, item.job.request_order, item.job.part),
        )
        for stop_index, route_job in enumerate(village_jobs):
            travel_before = travel_minutes if stop_index == 0 else 0
            arrive = clock + travel_before
            start = arrive + problem.settings.setup_minutes_per_field
            work_minutes = problem.work_minutes(route_job.job.acres, machine, use_plan_rate=True)
            end = arrive + work_minutes
            stops.append(
                Stop(
                    field_id=route_job.job.field_id,
                    village_id=village_id,
                    part=route_job.job.part,
                    parts=route_job.job.parts,
                    acres=round(route_job.job.acres, 2),
                    arrive_minute=arrive,
                    start_minute=start,
                    end_minute=end,
                    travel_minutes_before=travel_before,
                    stretch=route_job.stretch,
                )
            )
            clock = end
    if village_order:
        clock += problem.travel.minutes(location, BASE_ID)
        travel_km += problem.travel.road_km(location, BASE_ID)
    return Route(
        machine_id=machine.id,
        day=day,
        stops=stops,
        travel_km=round(travel_km, 2),
        end_minute=clock,
        capacity_minute=problem.settings.day_start_minute + problem.capacity_minutes(machine),
    )


def core_fits_at_promise_rate(problem: Problem, machine: Machine, route: Route) -> bool:
    """On a slow day the operator skips the stretch stops and drives the rest in the printed order.
    That must still fit the day at the cautious (promise) rate, or a promise could slip."""
    core_stops = [stop for stop in route.stops if not stop.stretch]
    minutes = sum(problem.work_minutes(stop.acres, machine, use_plan_rate=False) for stop in core_stops)
    location = BASE_ID
    for stop in core_stops:
        if stop.village_id != location:
            minutes += problem.travel.minutes(location, stop.village_id)
            location = stop.village_id
    if core_stops:
        minutes += problem.travel.minutes(location, BASE_ID)
    return minutes <= problem.capacity_minutes(machine)


def _promise_allows(job: Job, day: int) -> bool:
    # A window is met inside it, so a field cannot be sown before its window opens.
    if isinstance(job.promise, WindowPromise):
        return job.promise.start_day <= day
    return True


def build_routes(problem: Problem, day_machine_by_job: dict[str, tuple[str, int]]) -> list[Route]:
    """Routes for every machine-day, plus stretch stops on the first plan day.

    Stretch: the plan for tomorrow is timed at the median rate, so a machine usually has time left.
    Fields promised for later days that are ready tomorrow fill that time, most urgent first.
    Their promise does not change: finishing early is a bonus, never a new commitment.
    """
    jobs_by_id = {job.job_id: job for job in problem.jobs}
    route_jobs_by_machine_day: dict[tuple[str, int], list[RouteJob]] = {}
    for job_id, (machine_id, day) in day_machine_by_job.items():
        route_jobs_by_machine_day.setdefault((machine_id, day), []).append(RouteJob(jobs_by_id[job_id], False))

    tomorrow = problem.plan_start
    if tomorrow not in problem.rain_days:
        stretch_candidates = sorted(
            (
                jobs_by_id[job_id]
                for job_id, (_machine_id, day) in day_machine_by_job.items()
                if day > tomorrow
                and jobs_by_id[job_id].ready_day <= tomorrow
                and _promise_allows(jobs_by_id[job_id], tomorrow)
            ),
            key=lambda job: (job.burn_deadline, job.request_order, job.part),
        )
        for machine in problem.machines:
            if not problem.machine_works(machine, tomorrow):
                continue
            key = (machine.id, tomorrow)
            current = route_jobs_by_machine_day.get(key, [])
            for candidate in list(stretch_candidates):
                trial = current + [RouteJob(candidate, True)]
                trial_route = build_route(problem, machine, tomorrow, trial)
                if trial_route.end_minute <= trial_route.capacity_minute and core_fits_at_promise_rate(
                    problem, machine, trial_route
                ):
                    current = trial
                    stretch_candidates.remove(candidate)
            if current:
                route_jobs_by_machine_day[key] = current

    routes = [
        build_route(problem, problem.machine_by_id[machine_id], day, route_jobs)
        for (machine_id, day), route_jobs in route_jobs_by_machine_day.items()
    ]
    routes.sort(key=lambda route: (route.day, route.machine_id))
    return routes
