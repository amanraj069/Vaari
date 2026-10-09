"""The season simulator: same seed, same seasons and file; the same physics for every policy; and
the measures computed as documented. The proof page shows only what this code writes."""

from __future__ import annotations

import dataclasses
import json

import pytest

from vaari_engine.sim.metrics import Constants, paired_with_queue, season_metrics, spread, totals
from vaari_engine.sim.policies import POLICIES, Outcome, play
from vaari_engine.sim.rng import SplitMix64, derive_seed
from vaari_engine.sim.runner import simulate
from vaari_engine.sim.season import Breakdown, SimField, generate_season, load_assumptions
from vaari_engine.cluster import load_reference_data


@pytest.fixture(scope="module")
def assumptions():
    return load_assumptions()


@pytest.fixture(scope="module")
def reference():
    return load_reference_data()


def test_rng_is_fixed_arithmetic():
    # SplitMix64's published first output for seed 0; any change to the generator breaks this.
    assert SplitMix64(0).next_u64() == 0xE220A8397B1DCDAF
    first, again = SplitMix64(derive_seed(1, "season", 0)), SplitMix64(derive_seed(1, "season", 0))
    assert [first.random() for _ in range(5)] == [again.random() for _ in range(5)]
    assert derive_seed(1, "season", 0) != derive_seed(1, "season", 1)


def test_same_seed_same_season_and_real_inputs(assumptions, reference):
    season = generate_season(assumptions, 1, "season", 3, reference=reference)
    assert season == generate_season(assumptions, 1, "season", 3, reference=reference)
    assert season != generate_season(assumptions, 1, "season", 4, reference=reference)
    window = assumptions.input("seasonWindow")
    speed = assumptions.input("machineAcresPerDay")
    for field in season.fields:
        assert window["firstReadyDay"] <= field.ready_day <= window["lastReadyDay"]
        assert 3 <= field.waiting_limit_days <= 10
        assert field.ready_day - 3 <= field.request_day <= field.ready_day
    for machine in season.machines:
        assert speed["min"] <= machine.acres_per_hour * machine.hours_per_day <= speed["max"]
    # The phone queue's order follows the day each farmer called.
    by_order = sorted(season.fields, key=lambda field: field.request_order)
    assert [field.request_day for field in by_order] == sorted(field.request_day for field in season.fields)


def test_scenarios_and_sweeps_change_only_what_they_name(assumptions, reference):
    base = generate_season(assumptions, 1, "season", 0, reference=reference)
    farmers = lambda season: [(f.id, f.ready_day, f.village_id, f.acres, f.request_day) for f in season.fields]  # noqa: E731
    # Half the machines: the same farmers, and the first two of the same machines with the same breakdowns.
    fewer = generate_season(assumptions, 1, "season", 0, overrides={"machines": 2}, reference=reference)
    assert farmers(fewer) == farmers(base)
    assert fewer.machines == base.machines[:2]
    assert fewer.breakdowns == [item for item in base.breakdowns if item.machine_id in {machine.id for machine in base.machines[:2]}]
    assert fewer.rain_days == base.rain_days
    # Fixed waits: the same farmers, every one waiting exactly that long.
    waits = generate_season(assumptions, 1, "season", 0, overrides={"waitingLimitDays": 4}, reference=reference)
    assert farmers(waits) == farmers(base)
    assert {field.waiting_limit_days for field in waits.fields} == {4}
    # A busier season adds farmers to the same ones; the machines and the weather do not change.
    busier = generate_season(assumptions, 1, "season", 0, overrides={"acresPerMachine": 180}, reference=reference)
    assert set(farmers(base)) < set(farmers(busier))
    assert busier.machines == base.machines
    acres = sum(field.acres for field in busier.fields)
    fleet = len(base.machines)
    assert 180 * fleet <= acres < 180 * fleet + max(assumptions.input("fieldAcres")["values"])
    # The direct-transfers season and the patience sweep change no farmer, only the rules.
    transfers = generate_season(assumptions, 1, "season", 0, overrides={"phoneQueueReturnsToChc": False}, reference=reference)
    assert farmers(transfers) == farmers(base) and base.phone_queue_returns_to_chc and not transfers.phone_queue_returns_to_chc
    patient = generate_season(assumptions, 1, "season", 0, overrides={"daysSoonerWithoutDate": 0}, reference=reference)
    assert farmers(patient) == farmers(base) and patient.days_sooner_without_date == 0 and base.days_sooner_without_date == 2


@pytest.fixture(scope="module")
def played(assumptions, reference):
    season = generate_season(assumptions, 7, "season", 0, overrides={"machines": 2}, reference=reference)
    return season, {policy: play(season, policy, 7, 20, 10) for policy in POLICIES}


def test_every_policy_obeys_the_same_physics(played):
    season, outcomes = played
    for policy, outcome in outcomes.items():
        for field in season.fields:
            day = outcome.sown_day[field.id]
            if field.id in outcome.burned:
                assert day is None, f"{policy}: a farmer who burned was sown later"
                continue
            assert day is not None, f"{policy}: {field.id} neither sown nor burned"
            assert day >= field.ready_day, f"{policy}: sown before ready"
            assert day <= field.burn_deadline, f"{policy}: sown after the farmer would have burned"
            assert day not in season.rain_days, f"{policy}: sown on a rain day"
        # Every completed field's acres, plus any part-sown before a farmer gave up and burned the
        # rest (the CHC was paid for those); never more than the season holds.
        completed = sum(f.acres for f in season.fields if f.id not in outcome.burned)
        assert completed - 0.05 <= outcome.acres_sown <= sum(f.acres for f in season.fields) + 0.05


def _tiny_season(assumptions, reference, fields, **changes):
    """A real season cut down to the given fields, one machine, no breakdowns and no rain."""
    season = generate_season(assumptions, 1, "season", 0, reference=reference)
    return dataclasses.replace(
        season, fields=fields, machines=season.machines[:1], breakdowns=[], rain_days=frozenset(), first_day=min(f.request_day for f in fields), **changes
    )


def test_the_phone_queue_rental_desk_returns_to_the_chc_between_rentals(assumptions, reference):
    season = generate_season(assumptions, 1, "season", 0, reference=reference)
    far = max(season.villages, key=lambda village: (village["lat"] - season.base["lat"]) ** 2 + (village["lon"] - season.base["lon"]) ** 2)
    two = [SimField(id=f"t{index}", village_id=far["id"], acres=1.5, ready_day=30, waiting_limit_days=10, request_day=29, request_order=index) for index in range(2)]
    desk = _tiny_season(assumptions, reference, two)
    transfers = dataclasses.replace(desk, phone_queue_returns_to_chc=False)
    from vaari_engine.geo import StraightLineTravel
    from vaari_engine.problem import BASE_ID

    travel = StraightLineTravel({BASE_ID: (desk.base["lat"], desk.base["lon"]), far["id"]: (far["lat"], far["lon"])}, desk.road_factor, desk.road_speed_kmh)
    one_way = travel.road_km(BASE_ID, far["id"])
    at_desk = play(desk, "phone_queue", 1, 5, 10)
    direct = play(transfers, "phone_queue", 1, 5, 10)
    assert at_desk.sown_day == direct.sown_day == {"t0": 30, "t1": 30}
    # Two round trips from the CHC, against one trip out and back with both fields on the way.
    assert at_desk.km == pytest.approx(4 * one_way)
    assert direct.km == pytest.approx(2 * one_way)


def test_a_farmer_with_no_date_gives_up_sooner_only_when_the_sweep_says_so(assumptions, reference):
    field = SimField(id="t0", village_id="x", acres=2, ready_day=30, waiting_limit_days=6, request_day=29, request_order=0)
    season = dataclasses.replace(generate_season(assumptions, 1, "season", 0, reference=reference), days_sooner_without_date=0)
    assert season.gives_up_after(field, holds_promise=False) == 36
    impatient = dataclasses.replace(season, days_sooner_without_date=2)
    assert impatient.gives_up_after(field, holds_promise=False) == 34
    assert impatient.gives_up_after(field, holds_promise=True) == 36
    assert dataclasses.replace(season, days_sooner_without_date=9).gives_up_after(field, holds_promise=False) == 30
    # Played: with the only machine in the workshop all season, a phone-queue farmer burns on that day.
    village = season.villages[0]["id"]
    lone = [dataclasses.replace(field, village_id=village)]
    stuck = _tiny_season(assumptions, reference, lone, days_sooner_without_date=2)
    stuck = dataclasses.replace(stuck, breakdowns=[Breakdown(stuck.machines[0].id, 1, 119)])
    outcome = play(stuck, "phone_queue", 1, 5, 10)
    assert outcome.burned == {"t0"} and outcome.burned_day == {"t0": 34}


def test_days_without_a_date_are_every_waiting_day_for_the_baselines_and_fewer_with_vaari(played):
    season, outcomes = played
    for policy in ("phone_queue", "nearest"):
        outcome = outcomes[policy]
        for field in season.fields:
            end = outcome.sown_day[field.id] if outcome.sown_day[field.id] is not None else outcome.burned_day[field.id]
            assert outcome.days_without_date[field.id] == max(0, end - field.ready_day), f"{policy}: every waiting day is without a date"
    vaari = outcomes["vaari"]
    queue_total = sum(outcomes["phone_queue"].days_without_date.values())
    assert sum(vaari.days_without_date.values()) < queue_total
    # A farmer who held a promise from before harvest waited no day without a date.
    promised_early = [field for field in season.fields if field.id in vaari.first_promise and field.request_day < field.ready_day]
    assert promised_early and any(vaari.days_without_date[field.id] == 0 for field in promised_early)


def test_only_vaari_makes_promises(played):
    _season, outcomes = played
    assert outcomes["phone_queue"].promises_kept is None and outcomes["nearest"].promises_kept is None
    vaari = outcomes["vaari"]
    assert vaari.promises_kept is not None and vaari.promises_kept > 0
    assert vaari.first_promise


def test_measures_by_hand(assumptions, reference):
    season = generate_season(assumptions, 1, "season", 0, reference=reference)
    one, two = season.fields[0], season.fields[1]
    rest = {field.id: field.ready_day for field in season.fields[2:]}
    optimum = season.optimum_last_day
    queue = Outcome("phone_queue", {one.id: optimum + 2, two.id: one.ready_day, **rest}, set(), {}, {}, acres_sown=100.0, km=10.0)
    vaari = Outcome("vaari", {one.id: optimum + 4, two.id: None, **rest}, {two.id}, {two.id: two.burn_deadline}, {two.id: 2.5}, acres_sown=80.0, km=8.0, promises_kept=3, promises_broken=1)
    constants = Constants(wheat_kg_per_acre_week=150.0, rent_per_acre=2000.0, straw_tonnes_per_acre=2.63, combustion_factor=0.8, pm25_grams_per_kg=12.95)
    metrics = season_metrics(season, {"phone_queue": queue, "vaari": vaari}, constants)
    # Air: the 2.5 acres still unsown when the farmer gave up burn; nothing burns under the queue here.
    assert metrics["vaari"]["acresBurned"] == 2.5
    assert metrics["vaari"]["strawBurnedTonnes"] == pytest.approx(2.5 * 2.63)
    assert metrics["vaari"]["pm25Kg"] == pytest.approx(2.5 * 2.63 * 0.8 * 12.95)  # tonnes x 1000 kg x g/kg / 1000 g
    assert metrics["phone_queue"]["pm25Kg"] == 0
    # Waiting: days from harvest-ready to sown, or to the day the farmer gave up; the median farmer.
    waits = sorted([optimum + 4 - one.ready_day, two.burn_deadline - two.ready_day] + [0] * len(rest))
    assert metrics["vaari"]["medianWaitDays"] == pytest.approx(sorted(waits)[len(waits) // 2] if len(waits) % 2 else (waits[len(waits) // 2 - 1] + waits[len(waits) // 2]) / 2)
    assert metrics["vaari"]["fieldsLate"] == 1
    assert metrics["vaari"]["promisesKeptPct"] == 75.0
    assert metrics["phone_queue"]["promisesKeptPct"] is None
    assert metrics["vaari"]["acresPerMachine"] == 80.0 / len(season.machines)
    assert metrics["vaari"]["incomePerMachineRupees"] == 80.0 / len(season.machines) * 2000
    # Wheat: the late field loses 150/7 kg per acre per day past the optimum; the farmer who
    # burned sows the day after the day they gave up.
    burned_day = two.burn_deadline + 1
    expected = one.acres * 150 / 7 * 4 + (two.acres * 150 / 7 * (burned_day - optimum) if burned_day > optimum else 0)
    assert metrics["vaari"]["wheatLostKg"] == pytest.approx(expected + sum(f.acres * 150 / 7 * (f.ready_day - optimum) for f in season.fields[2:] if f.ready_day > optimum))
    assert metrics["phone_queue"]["worstDelayVsQueueDays"] == 0
    assert metrics["vaari"]["worstDelayVsQueueDays"] >= 2


def test_paired_comparison_counts_seasons_won_tied_and_lost():
    runs = [
        {"phone_queue": {"fieldsLate": 4, "medianWaitDays": 3, "pm25Kg": 100, "wheatLostKg": 10, "kmDriven": 50, "incomePerMachineRupees": 9}, "vaari": {"fieldsLate": 1, "medianWaitDays": 1, "pm25Kg": 20, "wheatLostKg": 10, "kmDriven": 60, "incomePerMachineRupees": 10}},
        {"phone_queue": {"fieldsLate": 2, "medianWaitDays": 2, "pm25Kg": 40, "wheatLostKg": 10, "kmDriven": 50, "incomePerMachineRupees": 9}, "vaari": {"fieldsLate": 2, "medianWaitDays": 2, "pm25Kg": 40, "wheatLostKg": 12, "kmDriven": 40, "incomePerMachineRupees": 8}},
    ]
    paired = paired_with_queue(runs, ("phone_queue", "vaari"))
    assert paired["fieldsLate"]["vaari"]["betterPct"] == 50 and paired["fieldsLate"]["vaari"]["samePct"] == 50 and paired["fieldsLate"]["vaari"]["worsePct"] == 0
    assert paired["kmDriven"]["vaari"]["betterPct"] == 50 and paired["kmDriven"]["vaari"]["worsePct"] == 50
    # Income: higher is better, so 10 against 9 is a season won.
    assert paired["incomePerMachineRupees"]["vaari"]["betterPct"] == 50 and paired["incomePerMachineRupees"]["vaari"]["worsePct"] == 50
    assert "phone_queue" not in paired["fieldsLate"]
    summed = totals([{policy: {**cells, "acresBurned": 1.0, "strawBurnedTonnes": 2.0} for policy, cells in run.items()} for run in runs], ("phone_queue", "vaari"))
    assert summed["fieldsLate"] == {"phone_queue": 6, "vaari": 3} and summed["pm25Kg"] == {"phone_queue": 140, "vaari": 60}


def test_a_late_rental_keeps_the_machine_for_the_rest_of_the_day(assumptions, reference):
    season = generate_season(assumptions, 1, "season", 0, reference=reference)
    village = season.villages[0]["id"]
    two = [SimField(id=f"t{index}", village_id=village, acres=1.5, ready_day=30, waiting_limit_days=10, request_day=29, request_order=index) for index in range(2)]
    on_time = _tiny_season(assumptions, reference, two)
    always_late = dataclasses.replace(on_time, phone_queue_late_return_chance=1.0)
    assert play(on_time, "phone_queue", 1, 5, 10).sown_day == {"t0": 30, "t1": 30}
    # Every rental comes back late: one machine serves one farmer a day.
    assert play(always_late, "phone_queue", 1, 5, 10).sown_day == {"t0": 30, "t1": 31}
    # Driver-run policies are not rentals: no late returns.
    assert play(always_late, "nearest", 1, 5, 10).sown_day == {"t0": 30, "t1": 30}
    # The draw is per rental and seeded: the same rental is late or not on every run.
    half = dataclasses.replace(on_time, phone_queue_late_return_chance=0.5)
    assert [half.rental_returns_late(f"f{index}", 30) for index in range(20)] == [half.rental_returns_late(f"f{index}", 30) for index in range(20)]
    assert 0 < sum(half.rental_returns_late(f"f{index}", 30) for index in range(200)) < 200


def test_spread_is_median_and_10th_90th():
    assert spread(list(range(11))) == {"median": 5.0, "p10": 1.0, "p90": 9.0}
    assert spread([None, None]) is None


def test_breakdowns_are_known_the_evening_before(assumptions, reference):
    season = generate_season(assumptions, 1, "season", 0, reference=reference)
    season = season.__class__(**{**season.__dict__, "breakdowns": [Breakdown("m1", 30, 2)]})
    assert season.known_down_days("m1", 28) == []
    assert season.known_down_days("m1", 29) == [30, 31]
    assert season.machine_down("m1", 31) and not season.machine_down("m1", 32)


def test_simulate_writes_the_same_file_for_the_same_seed():
    first = simulate(runs=2, seed=5, workers=2, sweep_runs=1, centres=2)
    again = simulate(runs=2, seed=5, workers=1, sweep_runs=1, centres=2)
    assert json.dumps(first) == json.dumps(again)
    assert first["schemaVersion"] == 4
    assert first["runs"] == 2 and set(first["scenarios"]) == {"base"}
    # The district: every centre's farmers and machines in one season, on the real outline.
    district = first["scenarios"]["base"]
    assert district["centres"] == 2 and district["machines"] == sum(centre["machines"] for centre in first["replay"]["centres"])
    assert len(first["replay"]["fields"]) == district["fieldsPerSeason"] or first["replay"]["run"] != 0
    assert {item["name"] for item in first["replay"]["boundaries"]["districts"]} == {"Malerkotla", "Sangrur"}
    for metric in first["metrics"]:
        cells = first["scenarios"]["base"]["results"][metric["key"]]
        assert set(cells) == set(POLICIES)
    # The replay is one of the runs, and says why it was chosen.
    assert first["replay"]["run"] in (0, 1)
    assert "median" in first["replay"]["why"]
    assert [sweep["parameter"] for sweep in first["sweeps"]] == ["acresPerMachine", "waitingLimitDays", "daysSoonerWithoutDate", "phoneQueueLateReturnChance"]
    # Late returns touch only the phone queue: the other policies match the base season exactly.
    late = first["sweeps"][3]
    for point in late["points"]:
        for policy in ("nearest", "vaari"):
            assert point["results"]["fieldsLate"][policy] == late["points"][0]["results"]["fieldsLate"][policy]
    # Every scenario compares each policy with the phone queue, season by season, and sums the air measures.
    for scenario in first["scenarios"].values():
        cell = scenario["pairedWithQueue"]["fieldsLate"]["vaari"]
        assert cell["betterPct"] + cell["samePct"] + cell["worsePct"] == pytest.approx(100)
        assert set(scenario["totals"]["pm25Kg"]) == set(POLICIES)
    for sweep, asked in zip(first["sweeps"], first["assumptions"]["sweeps"]):
        assert [point["value"] for point in sweep["points"]] == asked["values"]
    # Sweeps replay one centre (the district's first); points equal to its base inputs are one job.
    load, patience = first["sweeps"][0], first["sweeps"][2]
    assert load["base"] == 140 and patience["base"] == 2 and load["centre"] == patience["centre"]
    at_base = lambda sweep: next(point for point in sweep["points"] if point["value"] == sweep["base"])  # noqa: E731
    assert at_base(load)["results"] == at_base(patience)["results"]
    # Every replayed field says when, if ever, each policy's farmer burned.
    for field in first["replay"]["fields"]:
        for policy in POLICIES:
            assert (field["sownDay"][policy] is None) == (field["burnedDay"][policy] is not None)
