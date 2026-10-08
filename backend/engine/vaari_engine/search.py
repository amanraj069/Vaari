"""Fast planner: an earliest-burn-deadline plan, improved by seeded local search.

Why it exists: CP-SAT (model.py) is the reference planner, but its cost pass rarely proves a plan
optimal in interactive time and is far too slow to run thousands of times in the season simulator.
This planner decides the same thing, which (machine, day) sows each job or that it stays unserved,
in a fraction of a second, gives the same plan for the same seed, and is checked against brute
force on small instances (tests/test_search.py). It is also CP-SAT's fallback when that finds no
plan in time.

What it never does: sow before a field is ready, use a machine on its down day or anyone on a rain
day, move a pinned field, or overfill a machine-day. Capacity is sowing minutes at the cautious
(promise) rate plus the exact travel of the day's shortest route. Promises are the objective's top
level, so a plan that breaks one always loses to any plan that keeps them all.

How:
  1. Construction places jobs in earliest-burn-deadline order (promised fields first, by their
     promise) on the earliest day with room, on the machine that adds the least travel.
  2. Descent applies improving moves until none is left: relocate, swap, eject (a field in trouble
     takes a slot and the job there moves on), whole-field moves for split fields, and swaps of two
     machine-days' work.
  3. Ruin and recreate: each round pulls out related jobs (close in day and distance, or every job
     around a breaking promise's window), puts them back in their best places, descends again, and
     keeps the result under late acceptance.
  4. Only if the best plan still breaks a promise: CP-SAT answers exactly how few must break (OR-Tools
     is imported only then), the search continues from that plan, and the better plan wins. Local
     search alone cannot be trusted here: packing promises into crowded days is NP-hard, and on
     the seed-1 breakdown re-plan a greedy re-pack reached CP-SAT's proven minimum in at most 13
     of 300 tries.
The seed drives the descent order and steps 3-4, so the same seed always gives the same plan.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass

from .objective import ZERO, FieldTerms, ObjectiveValue, TourCache, field_terms
from .problem import Assignment, ImpossiblePinError, Problem, promise_bounds, promise_latest_day

Slot = tuple[str, int]  # (machine id, day)

# Ruin-and-recreate rounds after the first descent, and the late-acceptance history length.
DEFAULT_ROUNDS = 100
LATE_ACCEPTANCE_LENGTH = 10
# How many related jobs one round pulls out: 2 up to a quarter of the jobs, capped at 8, but up to 4
# on small instances (rearranging several jobs at once is often what a tight day needs).
RUIN_MIN_JOBS = 2
RUIN_MAX_JOBS = 8
RUIN_SMALL_INSTANCE_JOBS = 4
# Relatedness: one day apart counts like this many minutes of travel between the two villages.
RUIN_DAY_WEIGHT_MINUTES = 30
# While a promise is breaking, this share of rounds re-packs the days around its window instead.
WINDOW_RUIN_SHARE = 0.3
# Time limit for CP-SAT's exact "fewest broken promises" answer (step 4).
EXACT_CHECK_SECONDS = 5.0
NOT_PROMISED = 10**6


@dataclass(frozen=True)
class SearchStats:
    seed: int
    rounds: int
    moves_evaluated: int
    moves_applied: int
    construction: ObjectiveValue
    after_descent: ObjectiveValue
    final: ObjectiveValue
    exact_check: str  # "not needed" | "confirmed" | "improved" | "unavailable"
    wall_seconds: float


@dataclass(frozen=True)
class SearchResult:
    assignment: Assignment
    objective: ObjectiveValue
    stats: SearchStats


class _Context:
    """Facts about the problem that never change during the search."""

    def __init__(self, problem: Problem) -> None:
        self.problem = problem
        self.tours = TourCache(problem)
        self.job_by_id = {job.job_id: job for job in problem.jobs}
        self.job_order = [job.job_id for job in problem.jobs]
        self.capacity_by_machine = {machine.id: problem.capacity_minutes(machine) for machine in problem.machines}
        self.work_minutes: dict[tuple[str, str], int] = {
            (job.job_id, machine.id): problem.work_minutes(job.acres, machine, use_plan_rate=False)
            for job in problem.jobs
            for machine in problem.machines
        }
        pinned_slot_by_field = {pin.field_id: (pin.machine_id, pin.day) for pin in problem.request.pins}

        self.pinned_slot_by_job: dict[str, Slot] = {}
        # Every slot a job may use (ready, no rain, machine working), earliest day first. A promised
        # job also gets the subset inside its promise; it may leave that subset only while broken.
        self.slots_by_job: dict[str, list[Slot]] = {}
        self.promise_slots_by_job: dict[str, list[Slot]] = {}
        for job in problem.jobs:
            slots = [
                (machine.id, day)
                for day in problem.candidate_days(job)
                for machine in problem.machines
                if problem.machine_works(machine, day)
            ]
            pinned_slot = pinned_slot_by_field.get(job.field_id)
            if pinned_slot is not None:
                if pinned_slot not in slots:
                    raise ImpossiblePinError(job.field_id, pinned_slot[0], pinned_slot[1])
                self.pinned_slot_by_job[job.job_id] = pinned_slot
                slots = [pinned_slot]
            self.slots_by_job[job.job_id] = slots
            if job.promise is None:
                self.promise_slots_by_job[job.job_id] = slots
            else:
                earliest, latest = promise_bounds(job.promise)
                self.promise_slots_by_job[job.job_id] = [
                    slot for slot in slots if slot[1] <= latest and (earliest is None or slot[1] >= earliest)
                ]
        self.allowed_slot_sets = {job_id: set(slots) for job_id, slots in self.slots_by_job.items()}
        self.promise_slot_sets = {job_id: set(slots) for job_id, slots in self.promise_slots_by_job.items()}
        self.movable_job_ids = [job_id for job_id in self.job_order if job_id not in self.pinned_slot_by_job]
        # Every machine-day that can sow at all, earliest first.
        self.working_slots: list[Slot] = [
            (machine.id, day)
            for day in problem.sowing_days
            for machine in problem.machines
            if problem.machine_works(machine, day)
        ]

    def construction_key(self, job_id: str) -> tuple[int, int, int, int]:
        """Earliest burn deadline first, but promised jobs (hard constraints) before everyone, by promise."""
        job = self.job_by_id[job_id]
        if job_id in self.pinned_slot_by_job:
            return (-1, 0, job.request_order, job.part)
        promise_day = promise_latest_day(job.promise) if job.promise is not None else NOT_PROMISED
        return (promise_day, job.burn_deadline, job.request_order, job.part)


class _PlanState:
    """A plan under construction, with its objective kept up to date move by move."""

    def __init__(self, context: _Context) -> None:
        self.context = context
        problem = context.problem
        self.slot_of_job: dict[str, Slot | None] = {job_id: None for job_id in context.job_order}
        self.jobs_in_slot: dict[Slot, list[str]] = {}
        self.work_in_slot: dict[Slot, int] = {}
        self.villages_in_slot: dict[Slot, dict[str, int]] = {}  # village id -> jobs there
        self.tour_in_slot: dict[Slot, tuple[int, int]] = {}  # (minutes, metres)
        self.terms_by_field: dict[str, FieldTerms] = {}
        totals = list(ZERO)
        for field_id, jobs in problem.jobs_by_field.items():
            terms = field_terms(problem, field_id, [None] * len(jobs))
            self.terms_by_field[field_id] = terms
            _add_terms(totals, terms, sign=1)
        self.totals = ObjectiveValue(*totals)
        # Machine-days whose work changed since day swaps last found nothing to improve: only pairs
        # involving one of them can have become worth swapping.
        self.changed_slots: set[Slot] = set(context.working_slots)
        self.moves_evaluated = 0
        self.moves_applied = 0

    def field_broken(self, field_id: str) -> bool:
        return self.terms_by_field[field_id].broken == 1

    def field_in_trouble(self, field_id: str) -> bool:
        """Unserved, sown after its burn deadline, or off its promise."""
        terms = self.terms_by_field[field_id]
        return bool(terms.unserved or terms.late or terms.broken)

    def allowed_slots(self, job_id: str) -> list[Slot]:
        job = self.context.job_by_id[job_id]
        if job.promise is not None and not self.field_broken(job.field_id):
            return self.context.promise_slots_by_job[job_id]
        return self.context.slots_by_job[job_id]

    def may_use(self, job_id: str, slot: Slot) -> bool:
        job = self.context.job_by_id[job_id]
        if job.promise is not None and not self.field_broken(job.field_id):
            return slot in self.context.promise_slot_sets[job_id]
        return slot in self.context.allowed_slot_sets[job_id]

    def reassign(self, moves: list[tuple[str, Slot | None]], commit: bool) -> ObjectiveValue | None:
        """The objective after moving each listed job to its slot (None = unserved).

        Returns None if any machine-day would overflow. With commit=True the moves are applied
        (callers only commit moves they have just evaluated as feasible).
        """
        context = self.context
        new_slot_by_job = dict(moves)
        new_work: dict[Slot, int] = {}
        new_villages: dict[Slot, dict[str, int]] = {}
        for job_id, new_slot in moves:
            village_id = context.job_by_id[job_id].village_id
            old_slot = self.slot_of_job[job_id]
            for slot, step in ((old_slot, -1), (new_slot, 1)):
                if slot is None:
                    continue
                if slot not in new_work:
                    new_work[slot] = self.work_in_slot.get(slot, 0)
                    new_villages[slot] = dict(self.villages_in_slot.get(slot, {}))
                new_work[slot] += step * context.work_minutes[(job_id, slot[0])]
                counts = new_villages[slot]
                counts[village_id] = counts.get(village_id, 0) + step
                if counts[village_id] == 0:
                    del counts[village_id]

        totals = list(self.totals)
        new_tours: dict[Slot, tuple[int, int]] = {}
        for slot, work in new_work.items():
            tour = context.tours.tour(frozenset(new_villages[slot]))
            if work + tour[0] > context.capacity_by_machine[slot[0]]:
                if not commit:
                    self.moves_evaluated += 1
                return None
            new_tours[slot] = tour
            totals[5] += tour[1] - self.tour_in_slot.get(slot, (0, 0))[1]

        problem = context.problem
        new_terms_by_field: dict[str, FieldTerms] = {}
        for job_id, _slot in moves:
            field_id = context.job_by_id[job_id].field_id
            if field_id in new_terms_by_field:
                continue
            job_days: list[int | None] = []
            for job in problem.jobs_by_field[field_id]:
                slot = new_slot_by_job[job.job_id] if job.job_id in new_slot_by_job else self.slot_of_job[job.job_id]
                job_days.append(None if slot is None else slot[1])
            terms = field_terms(problem, field_id, job_days)
            new_terms_by_field[field_id] = terms
            _add_terms(totals, self.terms_by_field[field_id], sign=-1)
            _add_terms(totals, terms, sign=1)
        value = ObjectiveValue(*totals)

        if not commit:
            self.moves_evaluated += 1
            return value
        for job_id, new_slot in moves:
            old_slot = self.slot_of_job[job_id]
            if old_slot is not None:
                self.jobs_in_slot[old_slot].remove(job_id)
            if new_slot is not None:
                self.jobs_in_slot.setdefault(new_slot, []).append(job_id)
            self.slot_of_job[job_id] = new_slot
        for slot, work in new_work.items():
            self.work_in_slot[slot] = work
            self.villages_in_slot[slot] = new_villages[slot]
            self.tour_in_slot[slot] = new_tours[slot]
            self.changed_slots.add(slot)
        self.terms_by_field.update(new_terms_by_field)
        self.totals = value
        self.moves_applied += 1
        return value

    def fits(self, moves: list[tuple[str, Slot | None]]) -> bool:
        """Capacity only: would every machine-day these moves touch still fit? (No objective.)"""
        context = self.context
        work: dict[Slot, int] = {}
        villages: dict[Slot, dict[str, int]] = {}
        for job_id, new_slot in moves:
            village_id = context.job_by_id[job_id].village_id
            for slot, step in ((self.slot_of_job[job_id], -1), (new_slot, 1)):
                if slot is None:
                    continue
                if slot not in work:
                    work[slot] = self.work_in_slot.get(slot, 0)
                    villages[slot] = dict(self.villages_in_slot.get(slot, {}))
                work[slot] += step * context.work_minutes[(job_id, slot[0])]
                villages[slot][village_id] = villages[slot].get(village_id, 0) + step
        for slot, minutes in work.items():
            visited = frozenset(village_id for village_id, count in villages[slot].items() if count > 0)
            if minutes + context.tours.tour(visited)[0] > context.capacity_by_machine[slot[0]]:
                return False
        return True

    def fits_quickly(self, job_id: str, slot: Slot) -> bool:
        """Cheap necessary check before a full evaluation: the job's work plus the slot's current load.

        Adding a village never shortens the shortest tour when travel obeys the triangle inequality
        (straight-line travel always does), so if this fails the move cannot fit.
        """
        context = self.context
        return (
            self.work_in_slot.get(slot, 0)
            + context.work_minutes[(job_id, slot[0])]
            + self.tour_in_slot.get(slot, (0, 0))[0]
            <= context.capacity_by_machine[slot[0]]
        )

    def snapshot(self) -> tuple:
        return (
            dict(self.slot_of_job),
            {slot: list(job_ids) for slot, job_ids in self.jobs_in_slot.items()},
            dict(self.work_in_slot),
            {slot: dict(counts) for slot, counts in self.villages_in_slot.items()},
            dict(self.tour_in_slot),
            dict(self.terms_by_field),
            self.totals,
        )

    def restore(self, snapshot: tuple) -> None:
        slot_of_job, jobs_in_slot, work, villages, tours, terms, totals = snapshot
        self.slot_of_job = dict(slot_of_job)
        self.jobs_in_slot = {slot: list(job_ids) for slot, job_ids in jobs_in_slot.items()}
        self.work_in_slot = dict(work)
        self.villages_in_slot = {slot: dict(counts) for slot, counts in villages.items()}
        self.tour_in_slot = dict(tours)
        self.terms_by_field = dict(terms)
        self.totals = totals
        # Snapshots are taken only after a finished descent, when no day swap improves anything.
        self.changed_slots = set()


def _add_terms(totals: list[int], terms: FieldTerms, sign: int) -> None:
    totals[0] += sign * terms.broken
    totals[1] += sign * terms.broken_slack
    totals[2] += sign * terms.late
    totals[3] += sign * terms.unserved
    totals[4] += sign * terms.wheat_loss_grams
    totals[6] += sign * terms.fairness_slack_days
    totals[7] += sign * terms.waiting_centiacre_days


def _insert(state: _PlanState, job_id: str, best_by_objective: bool, best_fit: bool = False) -> bool:
    """Place an unserved job. Construction takes the earliest day with room and, on that day, the
    machine that adds the least travel; recreate takes the slot with the best objective, or with
    best_fit the slot it fills most tightly (bin packing's best-fit rule, for re-packing crowded
    days). A promised job looks inside its promise first and leaves it only if nothing there has room."""
    context = state.context
    job = context.job_by_id[job_id]
    candidate_lists = [context.promise_slots_by_job[job_id]]
    if job.promise is not None:
        candidate_lists.append(context.slots_by_job[job_id])
    for candidates in candidate_lists:
        best_slot: Slot | None = None
        best_key: tuple | None = None
        for slot in candidates:
            if best_slot is not None and not best_by_objective and slot[1] > best_slot[1]:
                break  # construction: a later day never beats the earliest day with room
            if not state.fits_quickly(job_id, slot):
                continue
            value = state.reassign([(job_id, slot)], commit=False)
            if value is None:
                continue
            if best_fit:
                spare_minutes = (
                    context.capacity_by_machine[slot[0]]
                    - state.work_in_slot.get(slot, 0)
                    - context.work_minutes[(job_id, slot[0])]
                    - context.tours.tour(frozenset({*state.villages_in_slot.get(slot, {}), job.village_id}))[0]
                )
                key: tuple = (value[:2], spare_minutes, value)
            elif best_by_objective:
                key = value
            else:
                key = (value.travel_meters,)
            if best_key is None or key < best_key:
                best_slot, best_key = slot, key
        if best_slot is not None:
            state.reassign([(job_id, best_slot)], commit=True)
            return True
    return False


def _improve_job(state: _PlanState, job_id: str) -> list[str] | None:
    """Apply the first improving relocate, swap or eject involving this job; return the jobs it touched."""
    context = state.context
    current_value = state.totals
    current_slot = state.slot_of_job[job_id]
    allowed = state.allowed_slots(job_id)
    # Relocate: same job, another machine or day (earliest first, which favours sowing sooner).
    for slot in allowed:
        if slot == current_slot or not state.fits_quickly(job_id, slot):
            continue
        value = state.reassign([(job_id, slot)], commit=False)
        if value is not None and value < current_value:
            state.reassign([(job_id, slot)], commit=True)
            return _touched_jobs(state, [current_slot, slot], [job_id])
    # Swap: trade places with a job in another slot (an unserved job may push one out).
    for slot in allowed:
        if slot == current_slot:
            continue
        for other_id in list(state.jobs_in_slot.get(slot, [])):
            if other_id in context.pinned_slot_by_job:
                continue
            if current_slot is not None and current_slot not in context.allowed_slot_sets[other_id]:
                continue
            moves = [(job_id, slot), (other_id, current_slot)]
            value = state.reassign(moves, commit=False)
            if value is not None and value < current_value:
                state.reassign(moves, commit=True)
                return _touched_jobs(state, [current_slot, slot], [job_id, other_id])
    # A field split into parts only counts as sown when its last part is, so moving one part
    # rarely helps on its own: also try moving every movable part of the field together.
    field_id = context.job_by_id[job_id].field_id
    part_ids = [
        part.job_id for part in context.problem.jobs_by_field[field_id] if part.job_id not in context.pinned_slot_by_job
    ]
    if len(part_ids) > 1:
        for slot in allowed:
            moves = [(part_id, slot) for part_id in part_ids]
            value = state.reassign(moves, commit=False)
            if value is not None and value < current_value:
                old_slots = [state.slot_of_job[part_id] for part_id in part_ids]
                state.reassign(moves, commit=True)
                return _touched_jobs(state, [*old_slots, slot], part_ids)
    # Eject, only for a field in trouble (unserved, late, or off its promise): take a slot by
    # moving one job already there to a third place. This is how a stuck field gets room on a full
    # day. The field's other parts come along, so a split field can land whole.
    if not state.field_in_trouble(field_id):
        return None
    incoming_breaks_promise = state.field_broken(field_id)
    for slot in allowed:
        incoming = [(part_id, slot) for part_id in part_ids] if len(part_ids) > 1 else [(job_id, slot)]
        for other_id in list(state.jobs_in_slot.get(slot, [])):
            if other_id in context.pinned_slot_by_job or other_id in part_ids:
                continue
            if not state.fits([*incoming, (other_id, None)]):
                continue  # the field does not fit even with the other one gone
            # When the incoming field is breaking its promise, the job it pushes out may leave its
            # own promise: the count of broken promises stays the same, and the objective then
            # prefers breaking whichever farmer can wait longer.
            targets = context.slots_by_job[other_id] if incoming_breaks_promise else state.allowed_slots(other_id)
            for target in targets:
                if target == slot or (target != current_slot and not state.fits_quickly(other_id, target)):
                    continue
                moves = [*incoming, (other_id, target)]
                value = state.reassign(moves, commit=False)
                if value is not None and value < current_value:
                    old_slots = [state.slot_of_job[moved_id] for moved_id, _slot in incoming]
                    state.reassign(moves, commit=True)
                    return _touched_jobs(state, [*old_slots, slot, target], [moved_id for moved_id, _slot in moves])
    return None


def _touched_jobs(state: _PlanState, slots: list[Slot | None], moved_job_ids: list[str]) -> list[str]:
    """Jobs worth another look after a move: the moved ones and every job on the changed days (it
    may now prefer another machine). Unserved jobs are not woken here: each ruin-and-recreate round
    gives them first claim on freed room, and re-trying their ejects after every move cost far
    more than it found (with the capacity-only pre-check in eject, this took an overloaded 60-field
    cluster from 2.7 s to about 1 s with the same plan quality)."""
    days = {slot[1] for slot in slots if slot is not None}
    touched = set(moved_job_ids)
    for job_id, slot in state.slot_of_job.items():
        if slot is not None and slot[1] in days:
            touched.add(job_id)
    return [job_id for job_id in state.context.job_order if job_id in touched]


def _improve_by_day_swap(state: _PlanState) -> list[str] | None:
    """Swap everything two machine-days hold (one may be empty): for example the big field on
    Tuesday trades places with the three small ones on Monday. Single-job moves cannot do this,
    because every step in between overfills a day."""
    context = state.context
    current_value = state.totals
    slots = context.working_slots
    changed = state.changed_slots
    for first_index, first_slot in enumerate(slots):
        first_jobs = state.jobs_in_slot.get(first_slot, [])
        if any(job_id in context.pinned_slot_by_job for job_id in first_jobs):
            continue
        first_changed = first_slot in changed
        for second_slot in slots[first_index + 1 :]:
            if not first_changed and second_slot not in changed:
                continue  # neither day changed since the last full check: still not worth it
            second_jobs = state.jobs_in_slot.get(second_slot, [])
            if not first_jobs and not second_jobs:
                continue
            if any(job_id in context.pinned_slot_by_job for job_id in second_jobs):
                continue
            if not all(state.may_use(job_id, second_slot) for job_id in first_jobs):
                continue
            if not all(state.may_use(job_id, first_slot) for job_id in second_jobs):
                continue
            moves = [(job_id, second_slot) for job_id in first_jobs] + [(job_id, first_slot) for job_id in second_jobs]
            value = state.reassign(moves, commit=False)
            if value is not None and value < current_value:
                state.reassign(moves, commit=True)
                return _touched_jobs(state, [first_slot, second_slot], [job_id for job_id, _slot in moves])
    changed.clear()
    return None


def _descend(state: _PlanState, active_job_ids: list[str], rank: dict[str, int]) -> None:
    """Improving moves until none is left: job moves for the active jobs (a "don't look" queue),
    then machine-day swaps; a successful swap wakes the jobs it touched and the loop goes on."""
    pinned = state.context.pinned_slot_by_job
    active = {job_id for job_id in active_job_ids if job_id not in pinned}
    while True:
        while active:
            job_id = min(active, key=rank.__getitem__)
            active.discard(job_id)
            touched = _improve_job(state, job_id)
            if touched is not None:
                active.update(job_id for job_id in touched if job_id not in pinned)
        touched = _improve_by_day_swap(state)
        if touched is None:
            return
        active.update(job_id for job_id in touched if job_id not in pinned)


def _ruin_and_recreate(state: _PlanState, rng: random.Random) -> list[str]:
    """Pull out a group of related jobs and put them back in their best places."""
    context = state.context
    problem = context.problem
    movable = context.movable_job_ids
    if not movable:
        return []
    largest_ruin = min(RUIN_MAX_JOBS, len(movable), max(RUIN_SMALL_INSTANCE_JOBS, len(movable) // 4))
    ruin_size = rng.randint(min(RUIN_MIN_JOBS, largest_ruin), largest_ruin)
    # Jobs in trouble: their field is unserved, late, or off its promise.
    in_trouble = [job_id for job_id in movable if state.field_in_trouble(context.job_by_id[job_id].field_id)]
    if in_trouble and rng.random() < 0.5:
        # Clear room where a job in trouble wants to be (inside its promise, else from its ready
        # day), not around the day it was pushed to.
        seed_job_id = in_trouble[rng.randrange(len(in_trouble))]
        wanted = context.promise_slots_by_job[seed_job_id] or context.slots_by_job[seed_job_id]
        seed_day = wanted[rng.randrange(len(wanted))][1] if wanted else problem.horizon_end
    else:
        seed_job_id = movable[rng.randrange(len(movable))]
        seed_slot = state.slot_of_job[seed_job_id]
        seed_day = problem.horizon_end if seed_slot is None else seed_slot[1]
    seed_village = context.job_by_id[seed_job_id].village_id

    def relatedness(job_id: str) -> float:
        slot = state.slot_of_job[job_id]
        day = problem.horizon_end if slot is None else slot[1]
        minutes = problem.travel.minutes(seed_village, context.job_by_id[job_id].village_id)
        return (abs(day - seed_day) * RUIN_DAY_WEIGHT_MINUTES + minutes) * (1 + 0.5 * rng.random())

    trouble_first = set(in_trouble)
    breaking = [job_id for job_id in in_trouble if state.field_broken(context.job_by_id[job_id].field_id)]
    if breaking and rng.random() < WINDOW_RUIN_SHARE:
        # A promise is breaking: clear every job on the days around its window and re-pack them,
        # most constrained first. This is bin packing with time windows, and re-packing the whole
        # crowded stretch at once is what finds room that job-by-job moves cannot.
        target_job_id = breaking[rng.randrange(len(breaking))]
        window_days = {slot[1] for slot in context.promise_slots_by_job[target_job_id]}
        days = window_days | {day - 1 for day in window_days} | {day + 1 for day in window_days}
        removed = [
            job_id
            for job_id in movable
            if job_id == target_job_id or (state.slot_of_job[job_id] is not None and state.slot_of_job[job_id][1] in days)
        ]
        order_kind = "tightest"
    else:
        scored = sorted((relatedness(job_id), index, job_id) for index, job_id in enumerate(movable))
        removed = [job_id for _score, _index, job_id in scored[:ruin_size]]
        if seed_job_id not in removed:
            removed[-1] = seed_job_id
        order_kind = rng.choice(("urgent", "urgent", "largest", "tightest", "random"))
    changed_slots: list[Slot | None] = []
    for job_id in removed:
        if state.slot_of_job[job_id] is not None:
            changed_slots.append(state.slot_of_job[job_id])
            state.reassign([(job_id, None)], commit=True)

    # Put back every unserved job, not only the removed ones. Jobs that were in trouble before this
    # round go first: otherwise the removed jobs reclaim the freed room and a stranded field with a
    # late burn deadline never gets a turn. The rest go in the order picked for the round: urgent
    # (promise, then burn deadline, with a little noise), largest, tightest (fewest legal slots), or random.
    unserved = [job_id for job_id in movable if state.slot_of_job[job_id] is None]
    noise = {job_id: rng.random() for job_id in unserved}

    def reinsert_key(job_id: str) -> tuple[int, float, float]:
        # In a tightest-first re-pack the constraints alone decide the order: putting the job in
        # trouble first would let it take the scarce day that a tighter promise needs.
        stranded_first = 0 if job_id in trouble_first and order_kind != "tightest" else 1
        promise_day, burn_deadline, _order, _part = context.construction_key(job_id)
        acres = context.job_by_id[job_id].acres
        if order_kind == "largest":  # big jobs first packs tight days best
            return (stranded_first, -acres, noise[job_id])
        if order_kind == "tightest":  # fewest legal slots first, then big jobs
            return (stranded_first, len(context.promise_slots_by_job[job_id]), -acres + noise[job_id] / 10)
        if order_kind == "random":
            return (stranded_first, noise[job_id], 0.0)
        return (stranded_first, promise_day, burn_deadline + 2 * noise[job_id])

    for job_id in sorted(unserved, key=reinsert_key):
        _insert(state, job_id, best_by_objective=True, best_fit=order_kind == "tightest")
        changed_slots.append(state.slot_of_job[job_id])
    return _touched_jobs(state, changed_slots, unserved)


def _late_acceptance(state: _PlanState, rng: random.Random, rank: dict[str, int], rounds: int) -> ObjectiveValue:
    """Ruin and recreate with late acceptance; leaves the best plan seen in `state`.

    A round's result is kept if it is no worse than the current plan or than the plan
    LATE_ACCEPTANCE_LENGTH rounds ago. Accepting "worse than now but better than a while ago" lets
    the search climb out of a local optimum; the best plan seen is kept separately and returned.
    """
    current = state.snapshot()
    current_value = state.totals
    best, best_value = current, current_value
    history = [current_value] * LATE_ACCEPTANCE_LENGTH
    for round_index in range(rounds):
        touched = _ruin_and_recreate(state, rng)
        _descend(state, touched, rank)
        candidate_value = state.totals
        slot_in_history = round_index % LATE_ACCEPTANCE_LENGTH
        if candidate_value <= current_value or candidate_value <= history[slot_in_history]:
            current, current_value = state.snapshot(), candidate_value
            if candidate_value <= best_value:
                best, best_value = current, candidate_value
        else:
            state.restore(current)
        history[slot_in_history] = current_value
    state.restore(best)
    return best_value


def plan_by_search(
    problem: Problem, seed: int = 1, rounds: int = DEFAULT_ROUNDS, check_breaks_exactly: bool = True
) -> SearchResult:
    """Plan with the search. If the best plan found breaks a promise and check_breaks_exactly is
    on, CP-SAT is asked for the fewest promises any plan must break; when it can do better (or
    proves the search right), the search continues from CP-SAT's plan and the better plan wins."""
    started = time.perf_counter()
    context = _Context(problem)
    state = _PlanState(context)

    # 1. Earliest-burn-deadline construction (deterministic, no seed).
    for job_id in sorted(context.job_order, key=context.construction_key):
        pinned_slot = context.pinned_slot_by_job.get(job_id)
        if pinned_slot is not None:
            if state.reassign([(job_id, pinned_slot)], commit=False) is None:
                raise ImpossiblePinError(context.job_by_id[job_id].field_id, pinned_slot[0], pinned_slot[1])
            state.reassign([(job_id, pinned_slot)], commit=True)
        else:
            _insert(state, job_id, best_by_objective=False)
    construction_value = state.totals

    # 2. Descent from the construction, every job active.
    rng = random.Random(seed)
    shuffled = list(context.job_order)
    rng.shuffle(shuffled)
    rank = {job_id: index for index, job_id in enumerate(shuffled)}
    _descend(state, context.job_order, rank)
    descent_value = state.totals

    # 3. Ruin and recreate.
    best_value = _late_acceptance(state, rng, rank, rounds)

    # 4. Promises would break: an exact answer to "how few must break?" (OR-Tools imported only now).
    exact_check = "not needed"
    breaks_proven_minimal: bool | None = None
    if best_value.broken_promises > 0 and check_breaks_exactly:
        from .model import fewest_broken_promises

        answer = fewest_broken_promises(problem, seconds=min(problem.settings.time_limit_seconds, EXACT_CHECK_SECONDS))
        if answer is None:
            exact_check = "unavailable"
        else:
            exact_plan, proven = answer
            search_best = state.snapshot()
            restart = _PlanState(context)
            placed_all = True
            for job_id, slot in sorted(exact_plan.day_machine_by_job.items()):
                if restart.reassign([(job_id, slot)], commit=False) is None:
                    placed_all = False  # cannot happen with straight-line travel; skip the job if it does
                    continue
                restart.reassign([(job_id, slot)], commit=True)
            restart.moves_evaluated += state.moves_evaluated
            restart.moves_applied += state.moves_applied
            _descend(restart, context.job_order, rank)
            restart_value = _late_acceptance(restart, rng, rank, max(1, rounds // 2))
            exact_count = len(exact_plan.broken_field_ids)
            if restart_value < best_value:
                exact_check = "improved"
                state, best_value = restart, restart_value
            else:
                exact_check = "confirmed"
                state.moves_evaluated, state.moves_applied = restart.moves_evaluated, restart.moves_applied
                state.restore(search_best)
            breaks_proven_minimal = proven and placed_all and best_value.broken_promises == exact_count

    assignment = Assignment(status="feasible", method="search")
    for job_id in context.job_order:
        slot = state.slot_of_job[job_id]
        if slot is None:
            assignment.unserved_job_ids.add(job_id)
        else:
            assignment.day_machine_by_job[job_id] = slot
    assignment.broken_field_ids = {field_id for field_id in problem.jobs_by_field if state.field_broken(field_id)}
    assignment.mode = "minimal_break" if assignment.broken_field_ids else "normal"
    assignment.breaks_proven_minimal = breaks_proven_minimal
    assignment.burn_pass_objective = best_value.late_fields
    wall_seconds = round(time.perf_counter() - started, 3)
    assignment.wall_seconds = wall_seconds
    stats = SearchStats(
        seed=seed,
        rounds=rounds,
        moves_evaluated=state.moves_evaluated,
        moves_applied=state.moves_applied,
        construction=construction_value,
        after_descent=descent_value,
        final=best_value,
        exact_check=exact_check,
        wall_seconds=wall_seconds,
    )
    return SearchResult(assignment=assignment, objective=best_value, stats=stats)
