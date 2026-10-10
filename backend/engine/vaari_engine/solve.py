"""Solve end to end: assignment, routes, promises, metrics, objective.

Why it exists: this is the one function the API, the CLI and the simulator call. It runs the chosen
planner (CP-SAT or the search) and turns its assignment into what people see: each machine's
ordered day, and each farmer's promise (a firm date within the next two days, otherwise a window
that narrows as the day approaches). Both planners are scored on the same lexicographic objective.
OR-Tools is imported only when CP-SAT runs, so the search path starts in a fraction of a second.
"""

from __future__ import annotations

from .contract import (
    Assignment as AssignmentOut,
    FirmPromise,
    Metrics,
    PromiseOut,
    SolveRequest,
    SolveResponse,
    SolverInfo,
    WindowPromise,
)
from .objective import evaluate, to_contract
from .problem import Assignment, Problem, wheat_loss_kg
from .route import build_routes
from .search import plan_by_search


def shape_new_promise(problem: Problem, field_day: int, ready_day: int, burn_deadline: int, first_day: int | None = None) -> FirmPromise | WindowPromise:
    """A new promise for a field planned on `field_day` (its last part's day). A field split over
    several days is sown from `first_day`: the window must start no later than that, or the plan
    that made the promise would already break it (firm promises are "on or before", so the last
    day covers every part)."""
    firm_until = problem.request.today + problem.settings.firm_within_days
    if field_day <= firm_until:
        return FirmPromise(kind="firm", day=field_day)
    half_width = problem.settings.window_half_width_days
    window_start = max(ready_day, field_day - half_width, problem.plan_start)
    if first_day is not None:
        window_start = min(window_start, first_day)
    # A window never reaches past the last day the farmer said they can wait (unless the
    # planned day itself is already past it, which the operator sees as burn risk).
    window_end = min(field_day + half_width, max(field_day, burn_deadline))
    if window_start == window_end:
        return FirmPromise(kind="firm", day=field_day)
    return WindowPromise(kind="window", start_day=window_start, end_day=window_end)


def assign_with_chosen_method(problem: Problem) -> Assignment:
    if problem.settings.method == "search":
        return plan_by_search(problem, seed=problem.settings.search_seed).assignment
    from .model import assign  # imports OR-Tools (about 0.4 s), so only when CP-SAT is asked for

    return assign(problem)


def solve(request: SolveRequest, problem: Problem | None = None, assignment: Assignment | None = None) -> SolveResponse:
    """Plan a request. A caller that already ran a planner may pass its problem and assignment."""
    problem = problem or Problem(request)
    assignment = assignment or assign_with_chosen_method(problem)

    field_days: dict[str, int] = {}
    first_days: dict[str, int] = {}
    unserved_field_ids: list[str] = []
    for field in request.fields:
        jobs = problem.jobs_by_field[field.id]
        if any(job.job_id in assignment.unserved_job_ids for job in jobs):
            unserved_field_ids.append(field.id)
            continue
        part_days = [assignment.day_machine_by_job[job.job_id][1] for job in jobs]
        field_days[field.id] = max(part_days)
        first_days[field.id] = min(part_days)

    firm_until = request.today + problem.settings.firm_within_days
    promises: list[PromiseOut] = []
    for field in request.fields:
        field_day = field_days.get(field.id)
        previous = field.promise
        if field.id in assignment.broken_field_ids:
            new_promise = (
                shape_new_promise(problem, field_day, field.ready_day, field.ready_day + field.waiting_limit_days, first_days.get(field.id))
                if field_day is not None
                else None
            )
            promises.append(PromiseOut(field_id=field.id, promise=new_promise, previous=previous, changed=True, broken=True))
        elif previous is None:
            if field_day is not None:
                promises.append(
                    PromiseOut(
                        field_id=field.id,
                        promise=shape_new_promise(problem, field_day, field.ready_day, field.ready_day + field.waiting_limit_days, first_days.get(field.id)),
                        previous=None,
                        changed=True,
                        broken=False,
                    )
                )
        elif isinstance(previous, WindowPromise) and field_day is not None and field_day <= firm_until:
            # The window narrows to a firm date once it is within the firm range.
            promises.append(
                PromiseOut(
                    field_id=field.id,
                    promise=FirmPromise(kind="firm", day=field_day),
                    previous=previous,
                    changed=True,
                    broken=False,
                )
            )
        else:
            promises.append(PromiseOut(field_id=field.id, promise=previous, previous=previous, changed=False, broken=False))

    routes = build_routes(problem, assignment.day_machine_by_job)

    fields_past_deadline = 0
    for field in request.fields:
        burn_deadline = field.ready_day + field.waiting_limit_days
        field_day = field_days.get(field.id)
        if field_day is not None and field_day > burn_deadline:
            fields_past_deadline += 1
        elif field_day is None and burn_deadline < problem.horizon_end:
            fields_past_deadline += 1

    max_delay = 0
    beyond_k = 0
    for field_id, field_day in field_days.items():
        queue_day = problem.queue_day_by_field.get(field_id)
        if queue_day is None:
            continue
        max_delay = max(max_delay, field_day - queue_day)
        if field_day - queue_day > problem.settings.fairness_k_days:
            beyond_k += 1

    total_wheat_loss = sum(
        wheat_loss_kg(problem, job.acres, assignment.day_machine_by_job[job.job_id][1])
        for job in problem.jobs
        if job.job_id in assignment.day_machine_by_job
    )

    metrics = Metrics(
        fields_total=len(request.fields),
        fields_planned=len(field_days),
        fields_unserved=len(unserved_field_ids),
        fields_past_burn_deadline=fields_past_deadline,
        promises_held=sum(1 for promise in promises if promise.promise is not None and not promise.broken and promise.previous is not None),
        promises_broken=sum(1 for promise in promises if promise.broken),
        wheat_loss_kg=round(total_wheat_loss, 1),
        travel_km=round(sum(route.travel_km for route in routes), 1),
        max_delay_vs_queue_days=max_delay,
        fields_beyond_fairness_k=beyond_k,
    )

    assignments_out = [
        AssignmentOut(
            field_id=job.field_id,
            machine_id=assignment.day_machine_by_job[job.job_id][0],
            day=assignment.day_machine_by_job[job.job_id][1],
            part=job.part,
            parts=job.parts,
        )
        for job in problem.jobs
        if job.job_id in assignment.day_machine_by_job
    ]

    return SolveResponse(
        plan_start_day=problem.plan_start,
        field_days=field_days,
        unserved_field_ids=unserved_field_ids,
        assignments=assignments_out,
        routes=routes,
        promises=promises,
        queue_days=problem.queue_day_by_field,
        metrics=metrics,
        objective=to_contract(evaluate(problem, assignment)),
        solver=SolverInfo(
            status=assignment.status,  # type: ignore[arg-type]
            mode=assignment.mode,  # type: ignore[arg-type]
            method=assignment.method,  # type: ignore[arg-type]
            travel_source=problem.travel.source,
            breaks_proven_minimal=assignment.breaks_proven_minimal,
            wall_seconds=assignment.wall_seconds,
            burn_pass_objective=assignment.burn_pass_objective,
            cost_pass_objective=assignment.cost_pass_objective,
        ),
    )
