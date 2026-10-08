from __future__ import annotations

import json
import subprocess
import sys

from conftest import make_request, machine
from vaari_engine.contract import ExplainRequest
from vaari_engine.explain import explain
from vaari_engine.rates import WorkLog, learn_rate


def test_explain_reports_breakdown_and_full_days():
    request = make_request(field_count=3, machine_count=2, seed=7)
    today = request["today"]
    tomorrow = today + 1
    for field in request["fields"]:
        field.update({"readyDay": today, "acres": 3.0, "villageId": "balian", "waitingLimitDays": 8})
    # Two promises fill machine m1 tomorrow; m2 is down tomorrow.
    request["fields"][0]["promise"] = {"kind": "firm", "day": tomorrow}
    request["fields"][1]["promise"] = {"kind": "firm", "day": tomorrow}
    request["machines"][1] = machine("m2", down_days=[tomorrow])
    explain_request = ExplainRequest.model_validate({**request, "fieldId": "f02", "currentDay": today + 2})
    response = explain(explain_request)
    codes = [reason.code for reason in response.reasons]
    assert response.earlier_possible is False
    assert "MACHINE_DOWN" in codes
    assert "DAYS_FULL" in codes
    assert "PROMISES_HELD" in codes
    assert "BEFORE_BURN_DEADLINE" in codes


def test_explain_field_not_ready():
    request = make_request(field_count=2, seed=8)
    request["fields"][0]["readyDay"] = request["today"] + 3
    response = explain(ExplainRequest.model_validate({**request, "fieldId": "f00", "currentDay": request["today"] + 3}))
    assert response.reasons[0].code == "FIELD_NOT_READY"


def test_rate_prior_spans_sources_and_learns():
    prior = learn_rate([])
    # Prior spans 5.3 to 12 acres per 8-hour day; promise rate is below plan rate.
    assert 5.3 / 8 <= prior.promise_acres_per_hour < prior.plan_acres_per_hour <= 12 / 8
    slow = learn_rate([WorkLog(acres=4.0, hours=8.0)] * 10)
    assert slow.promise_acres_per_hour < prior.promise_acres_per_hour
    assert slow.observations == 10


def test_cli_round_trip():
    request = make_request(field_count=4, seed=9)
    completed = subprocess.run(
        [sys.executable, "-m", "vaari_engine", "solve"],
        input=json.dumps(request),
        capture_output=True,
        text=True,
        check=True,
    )
    body = json.loads(completed.stdout)
    assert body["solver"]["mode"] == "normal"
    assert "fieldDays" in body and "routes" in body
