"""The objective by hand, the swappable travel source, the seeded cluster and the `plan` command."""

from __future__ import annotations

import json
import math
import subprocess
import sys

import pytest
from pydantic import ValidationError

from conftest import BASE, VILLAGES, make_request
from vaari_engine.cluster import BOOKING_WINDOW_DAYS_AFTER, BOOKING_WINDOW_DAYS_BEFORE, CLUSTER_RADIUS_KM, seeded_cluster
from vaari_engine.contract import SolveRequest, SolveResponse
from vaari_engine.geo import haversine_km
from vaari_engine.objective import evaluate
from vaari_engine.problem import Assignment, Problem
from vaari_engine.solve import solve


def two_field_problem() -> Problem:
    request = make_request(field_count=2, machine_count=1, seed=1, today=44)  # optimum ends day 45
    request["fields"][0].update({"villageId": "balian", "acres": 2.0, "readyDay": 44, "waitingLimitDays": 2})
    request["fields"][1].update({"villageId": "laddi", "acres": 3.0, "readyDay": 45, "waitingLimitDays": 6})
    return Problem(SolveRequest.model_validate(request))


def test_objective_by_hand():
    problem = two_field_problem()
    # f00 (2 ac, ready 44, last waiting day 46) on day 47; f01 (3 ac) on day 46.
    assignment = Assignment(day_machine_by_job={"f00#1": ("m1", 47), "f01#1": ("m1", 46)})
    value = evaluate(problem, assignment)
    kg_per_acre_day = 150 / 7  # PAU: about 150 kg per acre per week past the optimum
    assert value.broken_promises == 0
    assert value.late_fields == 1  # f00 sown a day after its last waiting day
    assert value.unserved_fields == 0
    expected_grams = round(2.0 * kg_per_acre_day * 2 * 1000) + round(3.0 * kg_per_acre_day * 1 * 1000)
    assert value.wheat_loss_grams == expected_grams
    # Two machine-days, each a round trip to one village.
    expected_metres = round(problem.travel.road_km("base", "balian") * 2 * 1000) + round(
        problem.travel.road_km("base", "laddi") * 2 * 1000
    )
    assert value.travel_meters == expected_metres
    assert value.waiting_centiacre_days == 200 * (47 - 44) + 300 * (46 - 45)


def test_leaving_a_field_unplanned_is_never_the_cheap_option():
    """Why unserved ranks above wheat and travel: otherwise dropping a farmer looks cheapest."""
    problem = two_field_problem()
    served = evaluate(problem, Assignment(day_machine_by_job={"f00#1": ("m1", 45), "f01#1": ("m1", 50)}))
    dropped = evaluate(problem, Assignment(day_machine_by_job={"f00#1": ("m1", 45)}, unserved_job_ids={"f01#1"}))
    assert served.wheat_loss_grams > 0 and served.travel_meters > dropped.travel_meters
    assert served < dropped


def test_given_travel_matrix_replaces_straight_line():
    request = make_request(field_count=6, machine_count=2, seed=3)
    request["settings"]["method"] = "search"
    point_ids = ["base"] + [village["id"] for village in VILLAGES]
    # A road network where every trip takes 45 minutes and 9 km (as a route matrix service might say).
    request["travelMatrix"] = {
        "source": "amazon-location",
        "pointIds": point_ids,
        "km": [[0.0 if origin == destination else 9.0 for destination in point_ids] for origin in point_ids],
        "minutes": [[0 if origin == destination else 45 for destination in point_ids] for origin in point_ids],
    }
    response = solve(SolveRequest.model_validate(request))
    assert response.solver.travel_source == "amazon-location"
    assert response.routes
    for route in response.routes:
        # CHC -> each village once -> CHC: one 9 km leg more than the villages visited.
        villages_visited = len({stop.village_id for stop in route.stops})
        assert math.isclose(route.travel_km, 9.0 * (villages_visited + 1))


def test_travel_matrix_must_be_square_and_cover_every_point():
    request = make_request(field_count=2, seed=1)
    request["travelMatrix"] = {"source": "test", "pointIds": ["base", "balian"], "km": [[0, 1]], "minutes": [[0, 1], [1, 0]]}
    with pytest.raises(ValidationError):
        SolveRequest.model_validate(request)
    request["travelMatrix"] = {"source": "test", "pointIds": ["base", "balian"], "km": [[0, 1], [1, 0]], "minutes": [[0, 1], [1, 0]]}
    with pytest.raises(ValueError, match="no row for"):
        Problem(SolveRequest.model_validate(request))


def test_seeded_cluster_is_reproducible_and_real():
    first, again, other = seeded_cluster(1), seeded_cluster(1), seeded_cluster(2)
    assert first.request == again.request
    assert first.request.fields != other.request.fields
    base = first.request.base
    for village in first.request.villages:
        assert haversine_km(base.lat, base.lon, village.lat, village.lon) <= CLUSTER_RADIUS_KM
    today = first.request.today
    for field in first.request.fields:
        assert today - BOOKING_WINDOW_DAYS_BEFORE <= field.ready_day <= today + BOOKING_WINDOW_DAYS_AFTER
    assert first.base_village_name == "Balian" and len(first.request.machines) == 4


def test_seeded_cluster_plans_in_under_a_second():
    cluster = seeded_cluster(1)
    response = solve(cluster.request)
    assert response.solver.method == "search"
    assert response.solver.wall_seconds < 1.0
    assert response.objective.broken_promises == 0


def run_plan(*arguments: str) -> str:
    completed = subprocess.run(
        [sys.executable, "-m", "vaari_engine", "plan", *arguments], capture_output=True, text=True, check=True
    )
    return completed.stdout


def test_plan_command_prints_a_labelled_plan():
    output = run_plan("--seed", "1")
    assert "SIMULATED" in output
    assert "Super Seeder 1" in output and "Unserved:" in output
    assert "fields past last waiting day" in output and "Planned in" in output


def test_plan_command_replans_around_a_breakdown_with_promises_hard():
    output = run_plan("--seed", "1", "--down", "m2:2026-11-05", "--rain", "2026-11-06")
    assert "Re-plan after Super Seeder 2 breaks down on Thu 5 Nov and rain on Fri 6 Nov" in output
    # This event forces one promise to break; CP-SAT proves that no plan breaks fewer.
    assert "1 broken" in output and "CP-SAT proved no plan could break fewer" in output


def test_plan_command_json_matches_the_contract():
    body = json.loads(run_plan("--seed", "3", "--json"))
    response = SolveResponse.model_validate(body)
    assert response.solver.method == "search"
    assert {route.machine_id for route in response.routes} <= {"m1", "m2", "m3", "m4"}


def test_conftest_base_is_balian():
    # The tiny instances and tests above assume the CHC sits in Balian (zero-distance trips there).
    assert (BASE["lat"], BASE["lon"]) == (VILLAGES[0]["lat"], VILLAGES[0]["lon"])
