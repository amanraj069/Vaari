"""Answers "why this date?" from the solver itself.

Why it exists: Vaari's rule is that code decides and the language model only explains. To explain
a date, we ask CP-SAT whether the field could be sown on any earlier day while every machine's
hours, breakdowns, rain and every other farmer's promise still hold. Each of those constraints is
switched on by an assumption literal. If the answer is "no", CP-SAT returns a set of assumptions
that together make it impossible; we shrink that set and it becomes the reasons list. If the
answer is "yes", the field was placed later on purpose, and the reason is the farmers ahead of it
with earlier burn deadlines. The output is codes and numbers, never prose.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from .contract import ExplainRequest, ExplainResponse, Reason
from .problem import Problem, promise_bounds

CORE_SHRINK_LIMIT = 40  # literals; above this we report the unshrunk core
SHRINK_STEP_SECONDS = 1.0


def _solve_with(model: cp_model.CpModel, literals: list[cp_model.IntVar], seconds: float) -> tuple[int, cp_model.CpSolver]:
    model.clear_assumptions()
    model.add_assumptions(literals)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_workers = 1  # assumption cores are reported by the single-worker search
    status = solver.solve(model)
    return status, solver


def explain(request: ExplainRequest) -> ExplainResponse:
    problem = Problem(request)
    target_field_id = request.field_id
    current_day = request.current_day
    target_field = problem.field_by_id[target_field_id]
    target_jobs = problem.jobs_by_field[target_field_id]
    burn_deadline = target_field.ready_day + target_field.waiting_limit_days
    reasons: list[Reason] = []

    if current_day <= burn_deadline:
        reasons.append(Reason(code="BEFORE_BURN_DEADLINE", days=[burn_deadline], count=burn_deadline - current_day))

    if current_day <= problem.plan_start:
        reasons.insert(0, Reason(code="EARLIEST_PLAN_DAY", days=[problem.plan_start]))
        return ExplainResponse(field_id=target_field_id, current_day=current_day, earlier_possible=False, reasons=reasons)

    earliest_try = max(target_field.ready_day, problem.plan_start)
    if earliest_try > current_day - 1:
        reasons.insert(0, Reason(code="FIELD_NOT_READY", days=[target_field.ready_day]))
        return ExplainResponse(field_id=target_field_id, current_day=current_day, earlier_possible=False, reasons=reasons)

    earlier_days = [day for day in problem.plan_days if earliest_try <= day < current_day]
    model = cp_model.CpModel()
    labels: dict[int, tuple[str, str, int]] = {}  # literal index -> (kind, machine id or field id, day)
    literals: list[cp_model.IntVar] = []

    def new_literal(kind: str, subject: str, day: int) -> cp_model.IntVar:
        literal = model.new_bool_var(f"assume[{kind},{subject},{day}]")
        labels[literal.index] = (kind, subject, day)
        literals.append(literal)
        return literal

    rain_literal = {day: new_literal("rain", "", day) for day in earlier_days if day in problem.rain_days}
    down_literal = {
        (machine.id, day): new_literal("down", machine.id, day)
        for machine in problem.machines
        for day in earlier_days
        if day in machine.down_days
    }
    capacity_literal = {
        (machine.id, day): new_literal("capacity", machine.id, day) for machine in problem.machines for day in earlier_days
    }

    # Only fields that compete for the earlier days matter: the target, and every other field
    # whose promise could place it on one of those days.
    x: dict[tuple[str, str, int], cp_model.IntVar] = {}
    visits: dict[tuple[str, int, str], cp_model.IntVar] = {}
    promise_literal_by_field: dict[str, cp_model.IntVar] = {}
    competing_jobs = list(target_jobs)
    for job in problem.jobs:
        if job.field_id == target_field_id or job.promise is None:
            continue
        competing_jobs.append(job)

    for job in competing_jobs:
        is_target = job.field_id == target_field_id
        job_vars = []
        for day in problem.plan_days:
            if day < job.ready_day:
                continue
            if is_target and day not in earlier_days:
                continue
            for machine in problem.machines:
                variable = model.new_bool_var(f"x[{job.job_id},{machine.id},{day}]")
                x[(job.job_id, machine.id, day)] = variable
                job_vars.append(variable)
                if day in rain_literal:
                    model.add(variable == 0).only_enforce_if(rain_literal[day])
                elif day in problem.rain_days:
                    model.add(variable == 0)
                if (machine.id, day) in down_literal:
                    model.add(variable == 0).only_enforce_if(down_literal[(machine.id, day)])
                elif day in machine.down_days:
                    model.add(variable == 0)
        if is_target:
            model.add_exactly_one(job_vars)
        else:
            assert job.promise is not None
            # The other farmer's promise is held only while its literal is assumed.
            if job.field_id not in promise_literal_by_field:
                promise_literal_by_field[job.field_id] = new_literal("promise", job.field_id, 0)
            promise_literal = promise_literal_by_field[job.field_id]
            earliest, latest = promise_bounds(job.promise)
            inside = [
                x[(job.job_id, machine.id, day)]
                for machine in problem.machines
                for day in problem.plan_days
                if (job.job_id, machine.id, day) in x and day <= latest and (earliest is None or day >= earliest)
            ]
            model.add_at_most_one(job_vars)
            model.add(sum(inside) == 1).only_enforce_if(promise_literal)

    jobs_by_id = {job.job_id: job for job in problem.jobs}
    for (job_id, machine_id, day), variable in x.items():
        village_id = jobs_by_id[job_id].village_id
        key = (machine_id, day, village_id)
        if key not in visits:
            visits[key] = model.new_bool_var(f"visit[{machine_id},{day},{village_id}]")
        model.add_implication(variable, visits[key])

    terms_by_machine_day: dict[tuple[str, int], list[cp_model.LinearExprT]] = {}
    for (job_id, machine_id, day), variable in x.items():
        minutes = problem.work_minutes(jobs_by_id[job_id].acres, problem.machine_by_id[machine_id], use_plan_rate=False)
        terms_by_machine_day.setdefault((machine_id, day), []).append(minutes * variable)
    for (machine_id, day, village_id), visit in visits.items():
        terms_by_machine_day.setdefault((machine_id, day), []).append(problem.round_trip_minutes[village_id] * visit)
    for (machine_id, day), terms in terms_by_machine_day.items():
        limit = problem.capacity_minutes(problem.machine_by_id[machine_id])
        if (machine_id, day) in capacity_literal:
            model.add(sum(terms) <= limit).only_enforce_if(capacity_literal[(machine_id, day)])
        else:
            model.add(sum(terms) <= limit)

    status, solver = _solve_with(model, literals, seconds=5.0)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Possible with every promise held, so the solver chose to serve others first.
        ahead = [
            other
            for other in problem.request.fields
            if other.id != target_field_id
            and other.previous_day is not None
            and other.previous_day < current_day
            and other.ready_day + other.waiting_limit_days <= burn_deadline
        ]
        if ahead:
            reasons.insert(0, Reason(code="EARLIER_DEADLINES_AHEAD", count=len(ahead)))
        else:
            reasons.insert(0, Reason(code="ROUTE_GROUPING"))
        return ExplainResponse(field_id=target_field_id, current_day=current_day, earlier_possible=True, reasons=reasons)

    if status != cp_model.INFEASIBLE:
        reasons.insert(0, Reason(code="DAYS_FULL", days=earlier_days))
        return ExplainResponse(field_id=target_field_id, current_day=current_day, earlier_possible=False, reasons=reasons)

    core_indices = list(solver.sufficient_assumptions_for_infeasibility())
    core = [literal for literal in literals if literal.index in core_indices]
    if len(core) <= CORE_SHRINK_LIMIT:
        # Deletion filter: drop each assumption that is not needed for infeasibility.
        position = 0
        while position < len(core):
            trial = core[:position] + core[position + 1 :]
            trial_status, _ = _solve_with(model, trial, seconds=SHRINK_STEP_SECONDS)
            if trial_status == cp_model.INFEASIBLE:
                core = trial
            else:
                position += 1

    core_labels = [labels[literal.index] for literal in core]
    rain_days = sorted({day for kind, _subject, day in core_labels if kind == "rain"})
    down_pairs = sorted({(subject, day) for kind, subject, day in core_labels if kind == "down"})
    full_days = sorted({day for kind, _subject, day in core_labels if kind == "capacity"})
    full_machines = sorted({subject for kind, subject, _day in core_labels if kind == "capacity"})
    promise_count = sum(1 for kind, _subject, _day in core_labels if kind == "promise")

    core_reasons: list[Reason] = []
    if rain_days:
        core_reasons.append(Reason(code="RAIN", days=rain_days))
    if down_pairs:
        core_reasons.append(
            Reason(
                code="MACHINE_DOWN",
                days=sorted({day for _machine_id, day in down_pairs}),
                machine_ids=sorted({machine_id for machine_id, _day in down_pairs}),
            )
        )
    if full_days:
        core_reasons.append(Reason(code="DAYS_FULL", days=full_days, machine_ids=full_machines))
    if promise_count:
        core_reasons.append(Reason(code="PROMISES_HELD", count=promise_count))
    return ExplainResponse(
        field_id=target_field_id,
        current_day=current_day,
        earlier_possible=False,
        reasons=core_reasons + reasons,
    )
