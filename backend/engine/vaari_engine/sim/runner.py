"""`npm run simulate -- --runs 200 --seed 1`: play many seeded seasons and write data/sim/results.json.

Why it exists: the proof page reads only this file. Every number in it comes from these runs, each
summarised as a median with the 10th-90th percentile spread. The same seed always writes the same
file: seasons come from a fixed-arithmetic RNG, the planner is seeded, runs are combined in run
order (whatever order the worker processes finish in), and nothing time-dependent is written.

Scenarios: the base season; direct transfers (the phone queue given CEEW's best practice, its most
generous form); and a capacity shortfall (half the machines; no policy can save everyone). Sweeps
over the inputs that could change the answer: acres booked per machine, how long farmers wait, how
much sooner a farmer with no date gives up, and how often a phone-queue rental comes back late. A
job identical to another (a sweep point equal to the base season) is played once, and a change that
touches only the phone queue replays only the phone queue on the same season (Vaari and nearest
village next would play exactly as before). Each scenario also compares every policy with the phone
queue season by season (better, same or worse) and sums farmers, acres, straw and PM2.5 over all
seasons. One season is kept for the page's replay: the run with
the median gap between the phone queue and Vaari, so the replay is typical, not the best case.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import dataclasses

from ..cluster import default_data_dir, load_reference_data
from .district import load_boundaries
from .metrics import METRICS, Constants, paired_with_queue, season_metrics, summarise, totals
from .policies import POLICIES, Outcome, play
from .season import Assumptions, Season, centres_of, generate_season, load_assumptions

SCHEMA_VERSION = 4
# Inputs that change only how the phone queue works: other policies are not replayed for them.
PHONE_QUEUE_ONLY = {"phoneQueueReturnsToChc", "phoneQueueLateReturnChance"}

# Loaded once per worker process.
_assumptions: Assumptions | None = None
_reference: tuple[list[dict], dict] | None = None


def _context() -> tuple[Assumptions, tuple[list[dict], dict]]:
    global _assumptions, _reference
    if _assumptions is None or _reference is None:
        _assumptions = load_assumptions()
        _reference = load_reference_data()
    return _assumptions, _reference


def _season(job: dict[str, Any]) -> Season:
    """One centre's season (the district's first centre, the fire hotspot): what the sweeps replay."""
    assumptions, reference = _context()
    return generate_season(assumptions, job["seed"], job["season"], job["run"], overrides=job["overrides"], reference=reference)


def _merge_seasons(seasons: list[Season]) -> Season:
    """The district as one season: every centre's farmers and machines (weather is shared)."""
    return dataclasses.replace(
        seasons[0],
        fields=[item for season in seasons for item in season.fields],
        machines=[item for season in seasons for item in season.machines],
        breakdowns=[item for season in seasons for item in season.breakdowns],
        villages=[item for season in seasons for item in season.villages],
        first_day=min(season.first_day for season in seasons),
        last_day=max(season.last_day for season in seasons),
    )


def _merge_outcomes(outcomes: list[Outcome]) -> Outcome:
    """One policy across every centre: field ids are unique per centre, so the dicts simply join."""
    vaari = outcomes[0].promises_kept is not None
    return Outcome(
        policy=outcomes[0].policy,
        sown_day={key: value for outcome in outcomes for key, value in outcome.sown_day.items()},
        burned={field_id for outcome in outcomes for field_id in outcome.burned},
        burned_day={key: value for outcome in outcomes for key, value in outcome.burned_day.items()},
        burned_acres={key: value for outcome in outcomes for key, value in outcome.burned_acres.items()},
        acres_sown=sum(outcome.acres_sown for outcome in outcomes),
        km=sum(outcome.km for outcome in outcomes),
        promises_kept=sum(outcome.promises_kept or 0 for outcome in outcomes) if vaari else None,
        promises_broken=sum(outcome.promises_broken or 0 for outcome in outcomes) if vaari else None,
        first_promise={key: value for outcome in outcomes for key, value in outcome.first_promise.items()},
        days_without_date={key: value for outcome in outcomes for key, value in outcome.days_without_date.items()},
    )


def _district(job: dict[str, Any]) -> tuple[Season, dict[str, Outcome]]:
    """One season of the whole district: every centre plays its own farmers under each policy."""
    assumptions, reference = _context()
    seasons: list[Season] = []
    played: dict[str, list[Outcome]] = {policy: [] for policy in POLICIES}
    for centre in centres_of(assumptions, reference, job.get("centres")):
        season = generate_season(assumptions, job["seed"], job["season"], job["run"], overrides=job["overrides"], reference=reference, centre=centre)
        seasons.append(season)
        for policy, outcome in _play_all(season, job["seed"]).items():
            played[policy].append(outcome)
    return _merge_seasons(seasons), {policy: _merge_outcomes(outcomes) for policy, outcomes in played.items()}


def _play_all(season: Season, seed: int) -> dict[str, Outcome]:
    assumptions, _ = _context()
    planner = assumptions.raw["planner"]
    return {policy: play(season, policy, seed, planner["searchRounds"], planner["horizonDays"]) for policy in POLICIES}


def _run_job(job: dict[str, Any]) -> list[dict[str, dict[str, float | None]]]:
    """One season under all three policies, then the same season again for each phone-queue-only
    variant (only the phone queue replayed). Returns every measure for every policy, main first."""
    assumptions, _ = _context()
    constants = Constants.from_assumptions(assumptions)
    planner = assumptions.raw["planner"]
    if job.get("scope") == "district":
        assert not job["variants"], "the district plays no phone-queue-only variants"
        district, outcomes = _district(job)
        return [season_metrics(district, outcomes, constants)]
    season = _season(job)
    outcomes = _play_all(season, job["seed"])
    results = [season_metrics(season, outcomes, constants)]
    for variant in job["variants"]:
        changed = _season({**job, "overrides": {**job["overrides"], **variant}})
        queue = play(changed, "phone_queue", job["seed"], planner["searchRounds"], planner["horizonDays"])
        results.append(season_metrics(changed, {**outcomes, "phone_queue": queue}, constants))
    return results


def _replay(season: Season, outcomes: dict[str, Outcome], why: str, centres: list[dict]) -> dict[str, Any]:
    """Everything the page's season scrubber needs; it derives each day's picture from these."""

    def promise_view(field_id: str) -> dict[str, Any] | None:
        promise = outcomes["vaari"].first_promise.get(field_id)
        if promise is None:
            return None
        return promise.model_dump(by_alias=True)

    sown_days = [day for outcome in outcomes.values() for day in outcome.sown_day.values() if day is not None]
    return {
        "scenario": season.scenario,
        "run": season.run,
        "why": why,
        "firstDay": season.first_day,
        "lastDay": max([*sown_days, *(item.burn_deadline for item in season.fields)]),
        "optimumLastDay": season.optimum_last_day,
        "machines": len(season.machines),
        "centres": centres,
        "boundaries": {key: load_boundaries()[key] for key in ("state", "districts")},
        "villages": season.villages,
        "rainDays": sorted(season.rain_days),
        "breakdowns": [{"machine": item.machine_id, "startDay": item.start_day, "days": item.days} for item in season.breakdowns],
        "fields": [
            {
                "id": item.id,
                "villageId": item.village_id,
                "acres": item.acres,
                "requestDay": item.request_day,
                "readyDay": item.ready_day,
                "burnDeadline": item.burn_deadline,
                "sownDay": {policy: outcomes[policy].sown_day[item.id] for policy in POLICIES},
                "burnedDay": {policy: outcomes[policy].burned_day.get(item.id) for policy in POLICIES},
                "firstPromise": promise_view(item.id),
            }
            for item in season.fields
        ],
    }


def _job_key(job: dict[str, Any]) -> str:
    return json.dumps(job, sort_keys=True)


def simulate(runs: int, seed: int, workers: int, sweep_runs: int, log=lambda message: None, centres: int | None = None) -> dict[str, Any]:
    """`centres` overrides the number of machine centres (tests and quick looks use a few)."""
    assumptions = load_assumptions()
    raw = assumptions.raw
    # Every scenario and sweep plays the SAME seasons (season key "season"), changed only by its overrides.
    # Scenarios play the whole district; sweeps replay the district's first centre (the hotspot).
    job = lambda run, overrides: {"seed": seed, "season": "season", "run": run, "overrides": overrides, "scope": "centre"}  # noqa: E731
    district_job = lambda run, overrides: {"seed": seed, "season": "season", "run": run, "overrides": overrides, "scope": "district", "centres": centres}  # noqa: E731
    scenario_jobs: dict[str, list[dict[str, Any]]] = {}
    for name, scenario in raw["scenarios"].items():
        overrides = {key: value for key, value in scenario.items() if key != "about"}
        scenario_jobs[name] = [district_job(run, overrides) for run in range(runs)]
    sweep_jobs = [
        {value: [job(run, {sweep["parameter"]: value}) for run in range(sweep_runs)] for value in sweep["values"]} for sweep in raw["sweeps"]
    ]
    # A sweep point equal to the base input is the base season itself: same job, played once.
    base_inputs = {sweep["parameter"]: assumptions.input(sweep["parameter"]).get("value") for sweep in raw["sweeps"]}
    for sweep, by_value in zip(raw["sweeps"], sweep_jobs):
        for value, jobs in by_value.items():
            if value == base_inputs[sweep["parameter"]]:
                by_value[value] = [job(run, {}) for run in range(sweep_runs)]

    every_job = [item for jobs in scenario_jobs.values() for item in jobs] + [item for by_value in sweep_jobs for jobs in by_value.values() for item in jobs]
    # Group by everything but the phone-queue-only inputs: one season played, its variants on top.
    groups: dict[str, dict[str, Any]] = {}
    for item in every_job:
        main = {key: value for key, value in item["overrides"].items() if key not in PHONE_QUEUE_ONLY}
        variant = {key: value for key, value in item["overrides"].items() if key in PHONE_QUEUE_ONLY}
        group = groups.setdefault(_job_key({**item, "overrides": main}), {**item, "overrides": main, "variants": []})
        if variant and variant not in group["variants"]:
            group["variants"].append(variant)
    unique_jobs = list(groups.values())
    started = time.perf_counter()
    played: dict[str, dict[str, dict[str, float | None]]] = {}
    with ProcessPoolExecutor(max_workers=workers) as pool:
        # map() yields in job order, whichever process finishes first: the file never depends on scheduling.
        for index, outcome_list in enumerate(pool.map(_run_job, unique_jobs, chunksize=1)):
            group = unique_jobs[index]
            base_job = {key: value for key, value in group.items() if key != "variants"}
            played[_job_key(base_job)] = outcome_list[0]
            for variant, result in zip(group["variants"], outcome_list[1:]):
                played[_job_key({**base_job, "overrides": {**base_job["overrides"], **variant}})] = result
            if (index + 1) % max(1, len(unique_jobs) // 20) == 0 or index + 1 == len(unique_jobs):
                log(f"  {index + 1}/{len(unique_jobs)} seasons played ({time.perf_counter() - started:.0f} s)")
    results_of = lambda jobs: [played[_job_key(item)] for item in jobs]  # noqa: E731

    reference = load_reference_data()
    placed = centres_of(assumptions, reference, centres)
    scenarios_out: dict[str, Any] = {}
    for name, jobs in scenario_jobs.items():
        # The district's size in its first season: generated, not played.
        first = _merge_seasons(
            [generate_season(assumptions, seed, "season", 0, overrides=jobs[0]["overrides"], reference=reference, centre=centre) for centre in placed]
        )
        scenarios_out[name] = {
            "about": raw["scenarios"][name]["about"],
            "centres": len(placed),
            "villages": sum(len(centre.villages) for centre in placed),
            "machines": len(first.machines),
            "fieldsPerSeason": len(first.fields),
            "results": summarise(results_of(jobs), POLICIES),
            "pairedWithQueue": paired_with_queue(results_of(jobs), POLICIES),
            "totals": totals(results_of(jobs), POLICIES),
        }
    base_runs = results_of(scenario_jobs["base"])
    sweeps_out = []
    for sweep, by_value in zip(raw["sweeps"], sweep_jobs):
        points = []
        for value, jobs in by_value.items():
            summary = summarise(results_of(jobs), POLICIES)
            points.append({"value": value, "results": {key: summary[key] for key in ("fieldsLate", "fieldsLatePct")}})
        sweeps_out.append({"parameter": sweep["parameter"], "about": sweep["about"], "base": base_inputs[sweep["parameter"]], "centre": placed[0].base["name"], "points": points})

    # The replay: the base run with the median gap (phone queue late minus Vaari late), lowest run first.
    gaps = sorted((run["phone_queue"]["fieldsLate"] - run["vaari"]["fieldsLate"], index) for index, run in enumerate(base_runs))  # type: ignore[operator]
    gap, replay_run = gaps[(len(gaps) - 1) // 2]
    replay_season, replay_outcomes = _district(scenario_jobs["base"][replay_run])
    replay = _replay(
        replay_season,
        replay_outcomes,
        f"the season with the median difference in farmers not reached by their last waiting day between the phone queue and Vaari ({gap:g}) of {runs} seasons",
        [{**centre.base, "machines": centre.machines} for centre in placed],
    )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "simulated": True,
        "generatedBy": f"npm run simulate -- --runs {runs} --seed {seed}" + (f" --centres {centres}" if centres else ""),
        "seed": seed,
        "runs": runs,
        "sweepRuns": sweep_runs,
        "seasonStartDate": "2026-10-01",
        "policies": list(POLICIES),
        "metrics": METRICS,
        "assumptions": raw,
        "scenarios": scenarios_out,
        "sweeps": sweeps_out,
        "replay": replay,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="npm run simulate --", description="Play seeded simulated seasons under three policies and write data/sim/results.json.")
    parser.add_argument("--runs", type=int, default=50, help="district seasons (default 50)")
    parser.add_argument("--centres", type=int, default=None, help="machine centres in the district (default: data/sim/assumptions.json); fewer for a quick look")
    parser.add_argument("--seed", type=int, default=1, help="seed (default 1); the same seed writes the same file")
    parser.add_argument("--sweep-runs", type=int, default=None, help="seasons per sweep value (default: --runs)")
    # Half the cores by default: a full run takes minutes and should not make a laptop unusable.
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2), help="processes (default: half the cores); does not change the result")
    parser.add_argument("--out", type=Path, default=default_data_dir() / "sim" / "results.json", help="where to write (default data/sim/results.json)")
    arguments = parser.parse_args(argv)
    if arguments.runs < 1:
        parser.error("--runs must be at least 1")
    sweep_runs = arguments.sweep_runs if arguments.sweep_runs is not None else arguments.runs
    log = lambda message: print(message, file=sys.stderr, flush=True)  # noqa: E731
    log(f"Simulating every scenario and sweep in data/sim/assumptions.json, {arguments.runs} seasons each, under 3 policies (seed {arguments.seed}), on {arguments.workers} processes...")
    started = time.perf_counter()
    results = simulate(arguments.runs, arguments.seed, arguments.workers, sweep_runs, log, centres=arguments.centres)
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(results, indent=1, ensure_ascii=False) + "\n")
    base = results["scenarios"]["base"]["results"]["fieldsLate"]
    log(f"Wrote {arguments.out} in {time.perf_counter() - started:.0f} s. Fields past the last waiting day (median, base season):")
    for policy in POLICIES:
        cell = base[policy]
        log(f"  {policy:<12} {cell['median']:g}  (10th-90th percentile {cell['p10']:g}-{cell['p90']:g})")
    return 0
