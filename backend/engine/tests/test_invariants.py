"""The engine correctness checks from CLAUDE.md section 10. These must always pass."""

from __future__ import annotations

import copy

from conftest import make_request, machine
from vaari_engine.contract import FirmPromise, SolveRequest, WindowPromise
from vaari_engine.problem import BASE_ID, Problem
from vaari_engine.solve import solve


def adopt_promises(request: dict, response) -> dict:
    """Write the engine's promises back into the request, as the API does after a plan."""
    next_request = copy.deepcopy(request)
    promise_by_field = {item.field_id: item.promise for item in response.promises if item.promise is not None}
    for field in next_request["fields"]:
        promise = promise_by_field.get(field["id"])
        if promise is not None:
            field["promise"] = promise.model_dump(by_alias=True)
            field["previousDay"] = response.field_days.get(field["id"])
    return next_request


def assert_promises_kept(request: dict, response) -> None:
    for field in request["fields"]:
        promise = field.get("promise")
        if promise is None:
            continue
        broken = {item.field_id for item in response.promises if item.broken}
        if field["id"] in broken:
            continue
        day = response.field_days.get(field["id"])
        assert day is not None, f"promised field {field['id']} left unserved without being reported broken"
        if promise["kind"] == "firm":
            assert day <= promise["day"], f"{field['id']} sown day {day} after firm {promise['day']}"
        else:
            assert promise["startDay"] <= day <= promise["endDay"], f"{field['id']} sown day {day} outside window"


def assert_capacity_and_readiness(request: dict, response) -> None:
    problem = Problem(SolveRequest.model_validate(request))
    fields_by_id = {field["id"]: field for field in request["fields"]}
    # Capacity at the cautious (promise) rate, with the exact route's travel, for core stops.
    for route in response.routes:
        machine = problem.machine_by_id[route.machine_id]
        assert machine.id and route.day not in machine.down_days, "machine scheduled on a down day"
        assert route.day not in problem.rain_days, "sowing scheduled on a rain day"
        core_stops = [stop for stop in route.stops if not stop.stretch]
        work = sum(problem.work_minutes(stop.acres, machine, use_plan_rate=False) for stop in core_stops)
        villages_in_order: list[str] = []
        for stop in core_stops:
            if not villages_in_order or villages_in_order[-1] != stop.village_id:
                villages_in_order.append(stop.village_id)
        travel = 0
        location = BASE_ID
        for village_id in villages_in_order:
            travel += problem.travel.minutes(location, village_id)
            location = village_id
        if villages_in_order:
            travel += problem.travel.minutes(location, BASE_ID)
        assert work + travel <= problem.capacity_minutes(machine), f"capacity exceeded on {route.machine_id} day {route.day}"
        # The timed route (median rate, including stretch) must also end inside the day.
        assert route.end_minute <= route.capacity_minute
        for stop in route.stops:
            assert route.day >= fields_by_id[stop.field_id]["readyDay"], "field sown before it was ready"
    for assignment in response.assignments:
        assert assignment.day >= fields_by_id[assignment.field_id]["readyDay"]


def test_first_plan_respects_readiness_and_capacity(small_request):
    response = solve(SolveRequest.model_validate(small_request))
    assert response.solver.status in ("optimal", "feasible")
    assert response.solver.mode == "normal"
    assert_capacity_and_readiness(small_request, response)
    # Every planned field gets a promise: firm within two days of today, a window later.
    today = small_request["today"]
    for item in response.promises:
        day = response.field_days[item.field_id]
        if day <= today + 2:
            assert isinstance(item.promise, FirmPromise) and item.promise.day == day
        else:
            assert isinstance(item.promise, WindowPromise) and item.promise.start_day <= day <= item.promise.end_day


def test_replan_keeps_every_promise_across_seeds():
    for seed in range(1, 6):
        request = make_request(field_count=14, machine_count=3, seed=seed)
        first = solve(SolveRequest.model_validate(request))
        promised_request = adopt_promises(request, first)
        second = solve(SolveRequest.model_validate(promised_request))
        assert second.solver.mode == "normal"
        assert not any(item.broken for item in second.promises)
        assert_promises_kept(promised_request, second)
        assert_capacity_and_readiness(promised_request, second)


def test_breakdown_replans_without_breaking_when_feasible():
    request = make_request(field_count=4, machine_count=3, seed=3)
    for field in request["fields"]:
        field.update({"readyDay": request["today"], "acres": 1.5, "villageId": "balian"})
    first = solve(SolveRequest.model_validate(request))
    promised_request = adopt_promises(request, first)
    # Four 1.5-acre fields need about 8 machine-hours in total, so two machines can absorb
    # them when m1 breaks down: nothing should break.
    promised_request["machines"][0] = machine("m1", down_days=[request["today"] + 1])
    second = solve(SolveRequest.model_validate(promised_request))
    assert second.solver.mode == "normal", "minimal-break used although a feasible plan exists"
    assert_promises_kept(promised_request, second)
    assert all(route.machine_id != "m1" or route.day != request["today"] + 1 for route in second.routes)


def test_minimal_break_breaks_fewest_and_reports_them():
    request = make_request(field_count=4, machine_count=1, seed=2)
    for field in request["fields"]:
        field["readyDay"] = request["today"]
        field["acres"] = 3.0
        field["villageId"] = "balian"
    tomorrow = request["today"] + 1
    # Four firm promises for tomorrow on one machine cannot all hold (about 3.6 h each).
    for field in request["fields"]:
        field["promise"] = {"kind": "firm", "day": tomorrow}
    response = solve(SolveRequest.model_validate(request))
    assert response.solver.mode == "minimal_break"
    broken = [item for item in response.promises if item.broken]
    kept = [item for item in response.promises if not item.broken]
    assert len(kept) == 2 and len(broken) == 2, "should keep as many promises as capacity allows"
    for item in broken:
        assert item.previous is not None and item.promise is not None
        assert item.promise != item.previous
    assert_promises_kept(request, response)


def test_minimal_break_prefers_promises_with_most_slack():
    request = make_request(field_count=3, machine_count=1, seed=4)
    tomorrow = request["today"] + 1
    for index, field in enumerate(request["fields"]):
        field.update({"readyDay": request["today"], "acres": 3.0, "villageId": "balian"})
        field["promise"] = {"kind": "firm", "day": tomorrow}
        field["waitingLimitDays"] = [2, 9, 3][index]
    response = solve(SolveRequest.model_validate(request))
    broken_ids = {item.field_id for item in response.promises if item.broken}
    assert broken_ids == {"f01"}, "the farmer who can wait longest should be moved"


def test_fairness_guard_reports_delay_vs_queue(small_request):
    response = solve(SolveRequest.model_validate(small_request))
    beyond = 0
    for field_id, day in response.field_days.items():
        queue_day = response.queue_days.get(field_id)
        if queue_day is not None and day - queue_day > 2:
            beyond += 1
    assert response.metrics.fields_beyond_fairness_k == beyond


def test_rain_day_has_no_sowing():
    request = make_request(field_count=8, machine_count=2, seed=5, rain_days=[32])
    response = solve(SolveRequest.model_validate(request))
    assert all(route.day != 32 for route in response.routes)
    assert_capacity_and_readiness(request, response)


def test_large_field_is_split_into_parts():
    request = make_request(field_count=1, machine_count=2, seed=6)
    request["fields"][0]["acres"] = 12.0
    response = solve(SolveRequest.model_validate(request))
    parts = [assignment for assignment in response.assignments if assignment.field_id == "f00"]
    assert len(parts) >= 2
    assert response.field_days["f00"] == max(part.day for part in parts)


def test_new_window_never_passes_burn_deadline():
    request = make_request(field_count=30, machine_count=2, seed=12)
    response = solve(SolveRequest.model_validate(request))
    fields_by_id = {field["id"]: field for field in request["fields"]}
    for item in response.promises:
        if isinstance(item.promise, WindowPromise):
            field = fields_by_id[item.field_id]
            burn_deadline = field["readyDay"] + field["waitingLimitDays"]
            planned = response.field_days[item.field_id]
            assert item.promise.end_day <= max(planned, burn_deadline)


def test_broken_promise_gets_earliest_feasible_new_date():
    request = make_request(field_count=3, machine_count=1, seed=4)
    tomorrow = request["today"] + 1
    for index, field in enumerate(request["fields"]):
        field.update({"readyDay": request["today"], "acres": 3.0, "villageId": "balian", "waitingLimitDays": 9})
        field["promise"] = {"kind": "firm", "day": tomorrow}
    response = solve(SolveRequest.model_validate(request))
    broken = [item for item in response.promises if item.broken]
    assert len(broken) == 1
    # Day after tomorrow has room, so the broken promise moves there and no later.
    assert response.field_days[broken[0].field_id] == tomorrow + 1
