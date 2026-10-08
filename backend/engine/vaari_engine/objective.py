"""The plan objective: what "a better plan" means, as one lexicographic tuple.

Why it exists: the search planner optimises it, solve() reports it for either planner (so CP-SAT
and the search can be compared on the same scale), and the brute-force tests use it as the target.
One definition keeps the three honest. Levels, most important first:

  0. promises broken (hard: only non-zero when no plan keeps them all; then break the farmers who
     can wait longest first, as model.py's minimal-break mode does)
  1. fields sown after their burn deadline (the farmer would have burned), counting unserved fields
     whose deadline falls inside the horizon
  2. fields left unserved
  3. wheat lost: acres x 150/7 kg per day sown past the optimum (PAU)
  4. travel km (the exact shortest route of each machine-day)
  5. fairness slack: days beyond the phone-queue day + k
  6. tie-break: acre-days waited since the field was ready (sooner is safer, all else equal)

Unserved fields sit at level 2, not last: an unplanned field sows nothing and drives nowhere, so
below wheat and travel, abandoning a farmer would always look cheapest. For the same reason an
unserved job is charged levels 3, 5 and 6 as if sown on the first day after the horizon, a lower
bound on what waiting really costs it.

All levels are integers (grams, metres, centi-acre-days) so comparisons are exact and deterministic.
"""

from __future__ import annotations

from typing import NamedTuple

from .contract import Objective
from .problem import BASE_ID, Assignment, Problem, promise_bounds, promise_latest_day, wheat_loss_kg
from .route import shortest_village_order


class ObjectiveValue(NamedTuple):
    broken_promises: int
    broken_promise_slack: int  # minus the slack of each broken promise: prefer breaking the most patient
    late_fields: int
    unserved_fields: int
    wheat_loss_grams: int
    travel_meters: int
    fairness_slack_days: int
    waiting_centiacre_days: int


ZERO = ObjectiveValue(0, 0, 0, 0, 0, 0, 0, 0)


class FieldTerms(NamedTuple):
    """Everything in the objective that depends on one field's days (all but travel)."""

    broken: int
    broken_slack: int
    late: int
    unserved: int
    wheat_loss_grams: int
    fairness_slack_days: int
    waiting_centiacre_days: int


def field_terms(problem: Problem, field_id: str, job_days: list[int | None]) -> FieldTerms:
    """Objective terms of one field, given the day of each of its jobs (None = unserved)."""
    jobs = problem.jobs_by_field[field_id]
    first_job = jobs[0]
    after_horizon = problem.horizon_end
    unserved = any(day is None for day in job_days)
    served_days = [day for day in job_days if day is not None]
    field_day = after_horizon if unserved else max(served_days)

    broken = 0
    broken_slack = 0
    if first_job.promise is not None:
        earliest, latest = promise_bounds(first_job.promise)
        outside = any(day > latest or (earliest is not None and day < earliest) for day in served_days)
        if unserved or outside:
            broken = 1
            broken_slack = -max(0, first_job.burn_deadline - promise_latest_day(first_job.promise))

    if unserved:
        late = 1 if first_job.burn_deadline < after_horizon else 0
    else:
        late = 1 if field_day > first_job.burn_deadline else 0

    wheat_grams = 0
    waiting = 0
    for job, day in zip(jobs, job_days):
        effective_day = after_horizon if day is None else day
        wheat_grams += round(wheat_loss_kg(problem, job.acres, effective_day) * 1000)
        waiting += round(job.acres * 100) * max(0, effective_day - job.ready_day)

    queue_day = problem.queue_day_by_field.get(field_id)
    fairness = 0 if queue_day is None else max(0, field_day - queue_day - problem.settings.fairness_k_days)
    return FieldTerms(broken, broken_slack, late, 1 if unserved else 0, wheat_grams, fairness, waiting)


class TourCache:
    """Shortest tour CHC -> villages -> CHC for a set of villages: (minutes, metres), memoised."""

    def __init__(self, problem: Problem) -> None:
        self.problem = problem
        self.cache: dict[frozenset[str], tuple[int, int]] = {frozenset(): (0, 0)}

    def tour(self, village_ids: frozenset[str]) -> tuple[int, int]:
        cached = self.cache.get(village_ids)
        if cached is not None:
            return cached
        travel = self.problem.travel
        order = shortest_village_order(self.problem, list(village_ids))
        minutes = 0
        kilometres = 0.0
        location = BASE_ID
        for village_id in [*order, BASE_ID]:
            minutes += travel.minutes(location, village_id)
            kilometres += travel.road_km(location, village_id)
            location = village_id
        result = (minutes, round(kilometres * 1000))
        self.cache[village_ids] = result
        return result


def evaluate(problem: Problem, assignment: Assignment, tours: TourCache | None = None) -> ObjectiveValue:
    """The objective of a finished assignment, computed from scratch (no incremental bookkeeping)."""
    tours = tours or TourCache(problem)
    totals = list(ZERO)
    for field_id, jobs in problem.jobs_by_field.items():
        job_days = [
            None if job.job_id in assignment.unserved_job_ids or job.job_id not in assignment.day_machine_by_job
            else assignment.day_machine_by_job[job.job_id][1]
            for job in jobs
        ]
        terms = field_terms(problem, field_id, job_days)
        if field_id in assignment.broken_field_ids and not terms.broken:
            # A promise a planner chose to break counts as broken even if the new day happens to fit.
            promise = jobs[0].promise
            assert promise is not None
            slack = -max(0, jobs[0].burn_deadline - promise_latest_day(promise))
            terms = terms._replace(broken=1, broken_slack=slack)
        totals[0] += terms.broken
        totals[1] += terms.broken_slack
        totals[2] += terms.late
        totals[3] += terms.unserved
        totals[4] += terms.wheat_loss_grams
        totals[6] += terms.fairness_slack_days
        totals[7] += terms.waiting_centiacre_days
    villages_by_slot: dict[tuple[str, int], set[str]] = {}
    village_by_job = {job.job_id: job.village_id for job in problem.jobs}
    for job_id, slot in assignment.day_machine_by_job.items():
        villages_by_slot.setdefault(slot, set()).add(village_by_job[job_id])
    totals[5] = sum(tours.tour(frozenset(village_ids))[1] for village_ids in villages_by_slot.values())
    return ObjectiveValue(*totals)


def to_contract(value: ObjectiveValue) -> Objective:
    return Objective(
        broken_promises=value.broken_promises,
        late_fields=value.late_fields,
        unserved_fields=value.unserved_fields,
        wheat_loss_kg=round(value.wheat_loss_grams / 1000, 1),
        travel_km=round(value.travel_meters / 1000, 2),
        fairness_slack_days=value.fairness_slack_days,
        waiting_acre_days=round(value.waiting_centiacre_days / 100, 2),
    )
