"""The search planner: hard rules, determinism, and its gap to the true optimum.

These are the stage's must-pass checks: every promise kept in every feasible plan, no field before
it is ready, capacity never exceeded, the same plan for the same seed, and a comparison with brute
force on 200 tiny random instances (the average gap is printed).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from brute_force import brute_force, tiny_request
from conftest import machine, make_request
from test_invariants import adopt_promises, assert_capacity_and_readiness, assert_promises_kept
from vaari_engine.contract import SolveRequest
from vaari_engine.objective import evaluate
from vaari_engine.problem import ImpossiblePinError, Problem
from vaari_engine.search import plan_by_search
from vaari_engine.solve import solve

INSTANCES = 200


def search_request(**kwargs) -> dict:
    request = make_request(**kwargs)
    request["settings"]["method"] = "search"
    return request


@pytest.fixture(scope="module")
def tiny_results():
    """The 200 tiny instances, each with its brute-force optimum and the search's answer."""
    results = []
    for seed in range(INSTANCES):
        request = tiny_request(seed)
        problem = Problem(SolveRequest.model_validate(request))
        optimum = brute_force(problem)
        assert optimum is not None, f"instance {seed}: promises come from a feasible plan, so one must exist"
        results.append((seed, request, problem, optimum, plan_by_search(problem, seed=1)))
    return results


def test_every_promise_kept_on_tiny_instances(tiny_results):
    # Each instance's promises come from a feasible plan, so a plan keeping all of them exists.
    for seed, request, problem, _optimum, result in tiny_results:
        assert result.objective.broken_promises == 0, f"instance {seed} broke a promise although a plan keeps all"
        response = solve(SolveRequest.model_validate(request), problem=problem, assignment=result.assignment)
        assert_promises_kept(request, response)
        assert_capacity_and_readiness(request, response)


def test_search_matches_brute_force(tiny_results, capsys):
    """Compare with the exact optimum and print the gap, level by level."""
    matched = 0
    worse_on_level = [0] * 8
    gap_totals = [0] * 8
    optimum_totals = [0] * 8
    for seed, _request, problem, (optimum, _plan), result in tiny_results:
        found = result.objective
        # The incremental bookkeeping must agree with a from-scratch evaluation.
        assert evaluate(problem, result.assignment) == found, f"instance {seed}: objective bookkeeping drifted"
        # Nothing can beat the optimum; if it does, the oracle (or a hard rule) is wrong.
        assert found >= optimum, f"instance {seed}: search {found} beat brute force {optimum}"
        if found == optimum:
            matched += 1
        else:
            first_difference = next(level for level in range(8) if found[level] != optimum[level])
            worse_on_level[first_difference] += 1
        for level in range(8):
            gap_totals[level] += found[level] - optimum[level]
            optimum_totals[level] += optimum[level]

    def percent(level: int) -> str:
        return f"{100 * gap_totals[level] / optimum_totals[level]:.2f}%" if optimum_totals[level] else "n/a"

    summary = (
        f"\n  brute force vs search on {INSTANCES} tiny instances (3-5 fields, 1-2 machines, 3-4 days):"
        f"\n    matched the exact optimum: {matched}/{INSTANCES}"
        f"\n    first level that differs when not: "
        + ", ".join(
            f"{name} {count}"
            for name, count in zip(
                ("broken", "broken slack", "late", "unserved", "wheat", "travel", "fairness", "waiting"),
                worse_on_level,
            )
            if count
        )
        + f"\n    average gap per instance: late fields +{gap_totals[2] / INSTANCES:.3f},"
        f" unserved +{gap_totals[3] / INSTANCES:.3f},"
        f" wheat +{gap_totals[4] / 1000 / INSTANCES:.2f} kg ({percent(4)}),"
        f" travel +{gap_totals[5] / 1000 / INSTANCES:.3f} km ({percent(5)}),"
        f" fairness +{gap_totals[6] / INSTANCES:.3f} days"
    )
    with capsys.disabled():  # show the gap in `npm test` output, not only on failure
        print(summary)
    # Regression guards, set just under what the planner reaches today (198/200, never worse on
    # promises, burn deadlines or unserved fields).
    assert worse_on_level[0] == worse_on_level[1] == worse_on_level[2] == worse_on_level[3] == 0
    assert matched >= 195


def test_promises_kept_when_replanning_larger_clusters():
    # Promises from the first plan are feasible by construction; the re-plan must keep every one.
    for seed in range(1, 6):
        request = search_request(field_count=30, machine_count=3, seed=seed)
        first = solve(SolveRequest.model_validate(request))
        promised = adopt_promises(request, first)
        second = solve(SolveRequest.model_validate(promised))
        assert second.solver.mode == "normal"
        assert second.objective.broken_promises == 0
        assert_promises_kept(promised, second)
        assert_capacity_and_readiness(promised, second)


def test_readiness_capacity_rain_and_down_days():
    for seed in range(1, 8):
        request = search_request(field_count=24, machine_count=3, seed=seed, rain_days=[33])
        request["machines"][1] = machine("m2", down_days=[31, 32])
        request["machines"][1]["rate"] = {"promiseAcresPerHour": 0.7, "planAcresPerHour": 0.9}
        response = solve(SolveRequest.model_validate(request))
        assert_capacity_and_readiness(request, response)
        assert all(route.day != 33 for route in response.routes), "sowing on a rain day"
        assert not any(route.machine_id == "m2" and route.day in (31, 32) for route in response.routes)


def test_same_seed_same_plan_in_process():
    request = SolveRequest.model_validate(search_request(field_count=30, machine_count=3, seed=4))

    def plan_without_clock(seed: int) -> dict:
        dumped = solve(request.model_copy(update={"settings": request.settings.model_copy(update={"search_seed": seed})})).model_dump()
        dumped["solver"].pop("wall_seconds")
        return dumped

    assert plan_without_clock(7) == plan_without_clock(7)


def test_same_seed_same_plan_across_processes():
    """Set iteration order changes with PYTHONHASHSEED; the plan must not."""
    request = json.dumps(search_request(field_count=30, machine_count=3, seed=4))
    outputs = []
    for hash_seed in ("1", "2"):
        completed = subprocess.run(
            [sys.executable, "-m", "vaari_engine", "solve"],
            input=request,
            capture_output=True,
            text=True,
            check=True,
            env={**os.environ, "PYTHONHASHSEED": hash_seed},
        )
        body = json.loads(completed.stdout)
        body["solver"].pop("wallSeconds")
        outputs.append(body)
    assert outputs[0] == outputs[1]


def test_unserved_only_when_nothing_fits():
    # One 8-hour machine, three small fields ready tomorrow: serving them all is possible, so the
    # plan serves them all even though leaving one out would save travel.
    request = search_request(field_count=3, machine_count=1, seed=11)
    for field in request["fields"]:
        field.update({"readyDay": request["today"] + 1, "acres": 1.0})
    response = solve(SolveRequest.model_validate(request))
    assert response.unserved_field_ids == []


def test_pins_hold_and_impossible_pins_are_refused():
    request = search_request(field_count=10, machine_count=2, seed=3)
    field = request["fields"][0]
    pin_day = max(field["readyDay"], request["today"] + 1) + 2
    request["pins"] = [{"fieldId": field["id"], "machineId": "m2", "day": pin_day}]
    response = solve(SolveRequest.model_validate(request))
    assert {(item.machine_id, item.day) for item in response.assignments if item.field_id == field["id"]} == {("m2", pin_day)}

    request["rainDays"] = [pin_day]
    with pytest.raises(ImpossiblePinError):
        solve(SolveRequest.model_validate(request))


def test_minimal_break_is_proven_fewest():
    # Four firm promises for tomorrow on one machine: only two fit (about 3.6 h each).
    request = search_request(field_count=4, machine_count=1, seed=2)
    tomorrow = request["today"] + 1
    for field in request["fields"]:
        field.update({"readyDay": request["today"], "acres": 3.0, "villageId": "balian"})
        field["promise"] = {"kind": "firm", "day": tomorrow}
    response = solve(SolveRequest.model_validate(request))
    assert response.solver.mode == "minimal_break"
    assert response.solver.breaks_proven_minimal is True
    assert sum(item.broken for item in response.promises) == 2
    assert_promises_kept(request, response)


def test_breaks_the_most_patient_farmer_first():
    request = search_request(field_count=3, machine_count=1, seed=4)
    tomorrow = request["today"] + 1
    for index, field in enumerate(request["fields"]):
        field.update({"readyDay": request["today"], "acres": 3.0, "villageId": "balian"})
        field["promise"] = {"kind": "firm", "day": tomorrow}
        field["waitingLimitDays"] = [2, 9, 3][index]
    response = solve(SolveRequest.model_validate(request))
    assert {item.field_id for item in response.promises if item.broken} == {"f01"}


def test_search_never_imports_or_tools():
    """OR-Tools costs about 0.4 s to import; the everyday search path must not touch it."""
    script = (
        "import json, sys\n"
        "from vaari_engine.contract import SolveRequest\n"
        "from vaari_engine.solve import solve\n"
        f"solve(SolveRequest.model_validate(json.loads({json.dumps(json.dumps(search_request(field_count=20, seed=2)))})))\n"
        "print('ortools' in sys.modules)\n"
    )
    completed = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
    assert completed.stdout.strip() == "False"


def test_cpsat_falls_back_to_search_when_it_finds_nothing(monkeypatch):
    from ortools.sat.python import cp_model

    monkeypatch.setattr(cp_model.CpSolver, "solve", lambda self, model, *args: cp_model.UNKNOWN)
    request = make_request(field_count=8, machine_count=2, seed=5)
    response = solve(SolveRequest.model_validate(request))
    assert response.solver.status == "fallback"
    assert response.solver.method == "search"
    assert_capacity_and_readiness(request, response)
