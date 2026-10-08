"""Stage 1 of planning: CP-SAT assigns every job to a (machine, day), or leaves it unserved.

Why it exists: this is where Vaari decides who goes first. Promises are hard constraints. The
objective is lexicographic, solved in passes:
  1. minimise fields sown after their burn deadline (the farmer would have burned by then);
  2. with that fixed, minimise wheat lost, travel, fairness slack, unserved fields and churn.
If promises cannot all be held (a breakdown, rain), minimal-break mode first decides the fewest
promises to break, preferring those with the most slack before their burn deadline.
"""

from __future__ import annotations

import time

from ortools.sat.python import cp_model

from .problem import Assignment, ImpossiblePinError, Problem, promise_bounds, promise_latest_day, wheat_loss_kg
from .search import plan_by_search

# Pass-2 weights (cost units). Wheat loss is in kilograms; the rest are scaled against it.
UNSERVED_WEIGHT = 50_000  # per job, plus per-acre below: leaving a field unplanned is the worst outcome
UNSERVED_WEIGHT_PER_ACRE = 2_000
FAIRNESS_SLACK_WEIGHT = 3_000  # per day pushed beyond the phone-queue day + k
EARLINESS_WEIGHT_PER_ACRE_DAY = 2  # sooner is safer, all else equal
TRAVEL_WEIGHT_PER_KM = 10
CHURN_WEIGHT_PER_DAY = 30  # moving a field from its previous planned day
BREAK_WEIGHT = 1_000  # minimal-break: per promise broken (slack before burn deadline is subtracted)
BROKEN_EARLINESS_WEIGHT_PER_ACRE_DAY = 200  # a farmer whose promise broke gets the earliest new date


class _AssignmentModel:
    """One CP-SAT model; built afresh for each pass so each pass can fix the previous result."""

    def __init__(self, problem: Problem, soft_promises: bool, fixed_broken: set[str] | None) -> None:
        self.problem = problem
        self.fixed_broken = fixed_broken or set()
        self.model = cp_model.CpModel()
        self.x: dict[tuple[str, str, int], cp_model.IntVar] = {}
        self.unserved: dict[str, cp_model.IntVar] = {}
        self.visits: dict[tuple[str, int, str], cp_model.IntVar] = {}
        self.broken: dict[str, cp_model.IntVar] = {}
        self.late_field: dict[str, cp_model.IntVar] = {}
        self.x_by_job: dict[str, list[tuple[int, cp_model.IntVar]]] = {}
        self.jobs_by_id = {job.job_id: job for job in problem.jobs}
        pinned = {(pin.field_id): (pin.machine_id, pin.day) for pin in problem.request.pins}

        promised_field_ids = {job.field_id for job in problem.jobs if job.promise is not None}
        for field_id in sorted(promised_field_ids):
            if soft_promises:
                self.broken[field_id] = self.model.new_bool_var(f"broken[{field_id}]")
            elif fixed_broken is not None and field_id in fixed_broken:
                self.broken[field_id] = self.model.new_constant(1)

        for job in problem.jobs:
            job_vars = []
            for day in problem.candidate_days(job):
                for machine in problem.machines:
                    if not problem.machine_works(machine, day):
                        continue
                    variable = self.model.new_bool_var(f"x[{job.job_id},{machine.id},{day}]")
                    self.x[(job.job_id, machine.id, day)] = variable
                    self.x_by_job.setdefault(job.job_id, []).append((day, variable))
                    job_vars.append(variable)
            unserved = self.model.new_bool_var(f"unserved[{job.job_id}]")
            self.unserved[job.job_id] = unserved
            # Each job is sown exactly once or marked unserved.
            self.model.add_exactly_one(job_vars + [unserved])

            if job.promise is not None:
                earliest, latest = promise_bounds(job.promise)
                outside = [
                    variable
                    for day, variable in self.x_by_job.get(job.job_id, [])
                    if day > latest or (earliest is not None and day < earliest)
                ]
                broken = self.broken.get(job.field_id)
                if broken is None:
                    # Promise is hard: the job must be sown inside it.
                    for variable in outside:
                        self.model.add(variable == 0)
                    self.model.add(unserved == 0)
                else:
                    for variable in outside:
                        self.model.add(variable == 0).only_enforce_if(broken.Not())
                    self.model.add(unserved == 0).only_enforce_if(broken.Not())

            if job.field_id in pinned:
                pin_machine_id, pin_day = pinned[job.field_id]
                pin_variable = self.x.get((job.job_id, pin_machine_id, pin_day))
                if pin_variable is None:
                    raise ImpossiblePinError(job.field_id, pin_machine_id, pin_day)
                else:
                    self.model.add(pin_variable == 1)

        # A machine-day pays a round trip for each village it visits.
        visit_members: dict[tuple[str, int, str], list[cp_model.IntVar]] = {}
        for (job_id, machine_id, day), variable in self.x.items():
            village_id = self.jobs_by_id[job_id].village_id
            key = (machine_id, day, village_id)
            if key not in self.visits:
                self.visits[key] = self.model.new_bool_var(f"visit[{machine_id},{day},{village_id}]")
            self.model.add_implication(variable, self.visits[key])
            visit_members.setdefault(key, []).append(variable)
        # And a visit only happens if something in that village is sown (tightens the relaxation).
        for key, members in visit_members.items():
            self.model.add(self.visits[key] <= sum(members))

        # Capacity: sowing minutes (cautious rate) plus travel bound fit in the working day.
        jobs_by_id = self.jobs_by_id
        terms_by_machine_day: dict[tuple[str, int], list[cp_model.LinearExprT]] = {}
        for (job_id, machine_id, day), variable in self.x.items():
            machine = problem.machine_by_id[machine_id]
            minutes = problem.work_minutes(jobs_by_id[job_id].acres, machine, use_plan_rate=False)
            terms_by_machine_day.setdefault((machine_id, day), []).append(minutes * variable)
        for (machine_id, day, village_id), visit in self.visits.items():
            terms_by_machine_day.setdefault((machine_id, day), []).append(
                problem.round_trip_minutes[village_id] * visit
            )
        for (machine_id, day), terms in terms_by_machine_day.items():
            machine = problem.machine_by_id[machine_id]
            self.model.add(sum(terms) <= problem.capacity_minutes(machine))

        # A field is late if any part is sown after its burn deadline, or left unserved when the
        # deadline falls inside the horizon.
        for job in problem.jobs:
            late_terms = [variable for day, variable in self.x_by_job.get(job.job_id, []) if day > job.burn_deadline]
            if job.burn_deadline < problem.horizon_end:
                late_terms.append(self.unserved[job.job_id])
            if not late_terms:
                continue
            if job.field_id not in self.late_field:
                self.late_field[job.field_id] = self.model.new_bool_var(f"late[{job.field_id}]")
            for term in late_terms:
                self.model.add_implication(term, self.late_field[job.field_id])

    def break_objective(self) -> cp_model.LinearExprT:
        terms = []
        for field_id, broken in self.broken.items():
            job = self.problem.jobs_by_field[field_id][0]
            assert job.promise is not None
            slack_days = max(0, min(BREAK_WEIGHT - 1, job.burn_deadline - promise_latest_day(job.promise)))
            terms.append((BREAK_WEIGHT - slack_days) * broken)
        return sum(terms)

    def burn_objective(self) -> cp_model.LinearExprT:
        return sum(self.late_field.values())

    def cost_objective(self) -> cp_model.LinearExprT:
        problem = self.problem
        jobs_by_id = self.jobs_by_id
        fairness_k = problem.settings.fairness_k_days
        terms: list[cp_model.LinearExprT] = []
        for (job_id, _machine_id, day), variable in self.x.items():
            job = jobs_by_id[job_id]
            coefficient = round(wheat_loss_kg(problem, job.acres, day))
            earliness_weight = EARLINESS_WEIGHT_PER_ACRE_DAY
            if job.field_id in self.fixed_broken:
                earliness_weight = BROKEN_EARLINESS_WEIGHT_PER_ACRE_DAY
            coefficient += round(earliness_weight * job.acres * (day - problem.plan_start))
            queue_day = problem.queue_day_by_field.get(job.field_id)
            if queue_day is not None:
                coefficient += FAIRNESS_SLACK_WEIGHT * max(0, day - queue_day - fairness_k)
            if job.previous_day is not None:
                coefficient += CHURN_WEIGHT_PER_DAY * abs(day - job.previous_day)
            if coefficient:
                terms.append(coefficient * variable)
        for job_id, unserved in self.unserved.items():
            job = jobs_by_id[job_id]
            terms.append(round(UNSERVED_WEIGHT + UNSERVED_WEIGHT_PER_ACRE * job.acres) * unserved)
        for (_machine_id, _day, village_id), visit in self.visits.items():
            terms.append(round(TRAVEL_WEIGHT_PER_KM * problem.round_trip_km[village_id]) * visit)
        return sum(terms)

    def hint_from(self, solver: cp_model.CpSolver, previous: "_AssignmentModel") -> None:
        for key, variable in self.x.items():
            if key in previous.x:
                self.model.add_hint(variable, solver.value(previous.x[key]))

    def read(self, solver: cp_model.CpSolver, result: Assignment) -> None:
        result.day_machine_by_job.clear()
        result.unserved_job_ids.clear()
        for (job_id, machine_id, day), variable in self.x.items():
            if solver.value(variable):
                result.day_machine_by_job[job_id] = (machine_id, day)
        for job_id, unserved in self.unserved.items():
            if solver.value(unserved):
                result.unserved_job_ids.add(job_id)


def _new_solver(seconds: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.5, seconds)
    solver.parameters.num_workers = 8
    solver.parameters.random_seed = 7  # deterministic plans for identical inputs
    # Stop within 0.5% of the proven optimum: the cost pass rarely closes the last bit of the gap
    # in interactive time, and a 0.5% difference in cost units is a fraction of one acre-day.
    solver.parameters.relative_gap_limit = 0.005
    return solver


def assign(problem: Problem) -> Assignment:
    started = time.perf_counter()
    result = Assignment()
    time_budget = problem.settings.time_limit_seconds
    fixed_broken: set[str] | None = None

    # Pass 1 with promises hard. INFEASIBLE means promises cannot all be held.
    burn_model = _AssignmentModel(problem, soft_promises=False, fixed_broken=None)
    burn_model.model.minimize(burn_model.burn_objective())
    burn_solver = _new_solver(time_budget / 2)
    burn_status = burn_solver.solve(burn_model.model)

    if burn_status == cp_model.INFEASIBLE:
        result.mode = "minimal_break"
        break_model = _AssignmentModel(problem, soft_promises=True, fixed_broken=None)
        break_model.model.minimize(break_model.break_objective())
        break_solver = _new_solver(time_budget / 3)
        break_status = break_solver.solve(break_model.model)
        if break_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return _finish(_fallback(problem, result.mode), started)
        fixed_broken = {field_id for field_id, broken in break_model.broken.items() if break_solver.value(broken)}
        result.broken_field_ids = fixed_broken
        result.breaks_proven_minimal = break_status == cp_model.OPTIMAL
        burn_model = _AssignmentModel(problem, soft_promises=False, fixed_broken=fixed_broken)
        burn_model.model.minimize(burn_model.burn_objective())
        burn_solver = _new_solver(time_budget / 3)
        burn_status = burn_solver.solve(burn_model.model)

    if burn_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Timed out without any plan: fall back to the search planner, flagged as such.
        return _finish(_fallback(problem, result.mode), started)

    late_fields = round(burn_solver.objective_value)
    result.burn_pass_objective = late_fields
    burn_model.read(burn_solver, result)
    result.status = "optimal" if burn_status == cp_model.OPTIMAL else "feasible"

    # Pass 2: fix the number of late fields, then minimise cost.
    cost_model = _AssignmentModel(problem, soft_promises=False, fixed_broken=fixed_broken)
    cost_model.model.add(cost_model.burn_objective() <= late_fields)
    cost_model.model.minimize(cost_model.cost_objective())
    cost_model.hint_from(burn_solver, burn_model)
    cost_solver = _new_solver(time_budget / 2)
    cost_status = cost_solver.solve(cost_model.model)
    if cost_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        cost_model.read(cost_solver, result)
        result.cost_pass_objective = round(cost_solver.objective_value)
        if cost_status == cp_model.FEASIBLE:
            result.status = "feasible"
    else:
        result.status = "feasible"
    return _finish(result, started)


def _finish(result: Assignment, started: float) -> Assignment:
    result.wall_seconds = round(time.perf_counter() - started, 3)
    return result


def fewest_broken_promises(problem: Problem, seconds: float) -> tuple[Assignment, bool] | None:
    """CP-SAT's answer to one question: what is the fewest promises any plan must break?

    Returns a plan that breaks that few (preferring the farmers who can wait longest) and whether
    CP-SAT proved it, or None if it found no plan in time. The search planner asks this only when
    its own best plan would break a promise: packing promises into crowded days is exactly where
    an exact method beats local search. The capacity here uses the round-trip travel bound, which
    is never shorter than a real route, so the plan is also valid for the search's exact routes.
    """
    break_model = _AssignmentModel(problem, soft_promises=True, fixed_broken=None)
    break_model.model.minimize(break_model.break_objective())
    solver = _new_solver(seconds)
    solver.parameters.relative_gap_limit = 0.0  # prove the count, not just come close
    status = solver.solve(break_model.model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    result = Assignment(status="feasible", method="cpsat")
    break_model.read(solver, result)
    result.broken_field_ids = {field_id for field_id, broken in break_model.broken.items() if solver.value(broken)}
    return result, status == cp_model.OPTIMAL


def _fallback(problem: Problem, mode: str) -> Assignment:
    """CP-SAT found no plan in time: use the search planner's plan, flagged as a fallback."""
    fallback = plan_by_search(problem, seed=problem.settings.search_seed, check_breaks_exactly=False).assignment
    fallback.status = "fallback"
    if mode == "minimal_break":
        fallback.mode = mode
    return fallback
