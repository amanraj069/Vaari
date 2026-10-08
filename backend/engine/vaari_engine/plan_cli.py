"""`python -m vaari_engine plan`: plan the seeded, simulated cluster and print it for a person.

Why it exists: one command shows the planner working end to end without the API, a database or
AWS: each machine's day as ordered stops, every farmer's promise, who is left unserved, and the
objective level by level. `--down` and `--rain` replay the re-plan moment: the first plan's promises
become hard constraints, the event happens, and the planner re-plans around it.
"""

from __future__ import annotations

import argparse
import time
from datetime import date

from .cluster import Cluster, date_to_day, day_to_date, seeded_cluster
from .contract import FirmPromise, Machine, SolveRequest, SolveResponse, WindowPromise
from .solve import solve


def _day_label(day: int) -> str:
    when = day_to_date(day)
    return f"{when:%a} {when.day} {when:%b}"


def _clock(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _promise_label(promise: FirmPromise | WindowPromise | None) -> str:
    if promise is None:
        return "no date"
    if isinstance(promise, FirmPromise):
        return f"firm {_day_label(promise.day)}"
    return f"window {_day_label(promise.start_day)} – {_day_label(promise.end_day)}"


def _parse_day(text: str) -> int:
    """A plan day as an ISO date (2026-11-02) or a day index counted from 1 October."""
    try:
        return date_to_day(date.fromisoformat(text).isoformat())
    except ValueError:
        return int(text)


def adopt_promises(request: SolveRequest, response: SolveResponse) -> SolveRequest:
    """What the API stores after a plan: each field now holds its promise and planned day."""
    promise_by_field = {item.field_id: item.promise for item in response.promises if item.promise is not None}
    fields = [
        field.model_copy(
            update={"promise": promise_by_field.get(field.id, field.promise), "previous_day": response.field_days.get(field.id)}
        )
        for field in request.fields
    ]
    return request.model_copy(update={"fields": fields})


def _print_plan(cluster: Cluster, request: SolveRequest, response: SolveResponse) -> None:
    villages = cluster.village_names
    fields_by_id = {field.id: field for field in request.fields}
    promise_by_field = {item.field_id: item.promise for item in response.promises}
    machine_by_id: dict[str, Machine] = {machine.id: machine for machine in request.machines}
    name_width = max(len(name) for name in cluster.machine_names.values())
    village_width = max(len(name) for name in villages.values())
    routes_by_day: dict[int, list] = {}
    for route in response.routes:
        routes_by_day.setdefault(route.day, []).append(route)

    for day in range(response.plan_start_day, response.plan_start_day + request.horizon_days):
        routes = sorted(routes_by_day.get(day, []), key=lambda route: route.machine_id)
        rain = day in request.rain_days
        down = [machine.name for machine in request.machines if day in machine.down_days]
        notes = (["rain: no sowing"] if rain else []) + [f"{name} in the workshop" for name in down]
        if not routes and not notes:
            continue
        print(f"\n{_day_label(day)}" + (f"   ({'; '.join(notes)})" if notes else ""))
        busy = {route.machine_id for route in routes}
        for route in routes:
            stop_villages: list[str] = []
            for stop in route.stops:
                if not stop_villages or stop_villages[-1] != villages[stop.village_id]:
                    stop_villages.append(villages[stop.village_id])
            name = machine_by_id[route.machine_id].name
            print(
                f"  {name:<{name_width}}  {_clock(route.stops[0].arrive_minute)}–{_clock(route.end_minute)}"
                f"  {route.travel_km:5.1f} km  {' → '.join(stop_villages)}"
            )
            for index, stop in enumerate(route.stops, start=1):
                field = fields_by_id[stop.field_id]
                part = f" part {stop.part}/{stop.parts}" if stop.parts > 1 else ""
                if stop.stretch:
                    note = f"early if time allows (holds {_promise_label(promise_by_field.get(stop.field_id))})"
                else:
                    note = _promise_label(promise_by_field.get(stop.field_id))
                    burn_deadline = field.ready_day + field.waiting_limit_days
                    if day > burn_deadline:
                        note += f"  PAST LAST WAITING DAY ({_day_label(burn_deadline)})"
                print(
                    f"    {index:>2}. {stop.field_id}  {villages[stop.village_id]:<{village_width}}  {stop.acres:4.1f} ac{part:<10}"
                    f"  {_clock(stop.arrive_minute)}–{_clock(stop.end_minute)}  {note}"
                )
        idle = [
            machine.name
            for machine in request.machines
            if machine.id not in busy and day not in machine.down_days and not rain
        ]
        if idle:
            print(f"  idle: {', '.join(idle)}")

    unserved = response.unserved_field_ids
    print("\nUnserved: " + ("none" if not unserved else ""))
    for field_id in unserved:
        field = fields_by_id[field_id]
        print(
            f"  {field_id}  {villages[field.village_id]}  {field.acres} ac  ready {_day_label(field.ready_day)},"
            f" waits until {_day_label(field.ready_day + field.waiting_limit_days)}: no machine has room inside the 10 days"
        )


def _print_objective(response: SolveResponse, optimum_last_day: int | None, fairness_k: int) -> None:
    objective = response.objective
    optimum = _day_label(optimum_last_day) if optimum_last_day is not None else "the optimum"
    rows = [
        ("0", "promises broken", f"{objective.broken_promises}", "hard: non-zero only when no plan keeps them all"),
        ("1", "fields past last waiting day", f"{objective.late_fields}", "the farmer would have burned"),
        ("2", "fields unserved", f"{objective.unserved_fields}", ""),
        ("3", "wheat lost", f"{objective.wheat_loss_kg:,.1f} kg", f"acres × 150/7 kg per day sown after {optimum} (PAU)"),
        ("4", "travel", f"{objective.travel_km:,.1f} km", "shortest route of each machine-day"),
        ("5", "fairness slack", f"{objective.fairness_slack_days} days", f"beyond each farmer's phone-queue day + {fairness_k}"),
        ("", "tie-break: waiting", f"{objective.waiting_acre_days:,.1f} acre-days", "since each field was ready"),
    ]
    print("\nObjective (each line outranks every line below it; lower is better)")
    for level, label, value, note in rows:
        print(f"  {level:>1}  {label:<30}{value:>16}   {note}")


def _print_compare(request: SolveRequest, search_response: SolveResponse, cpsat_seconds: float) -> None:
    cpsat_request = request.model_copy(
        update={"settings": request.settings.model_copy(update={"method": "cpsat", "time_limit_seconds": cpsat_seconds})}
    )
    cpsat_response = solve(cpsat_request)
    print(f"\nSame cluster, both planners, one objective (CP-SAT time limit {cpsat_seconds:g} s)")
    print(f"  {'':<30}{'search':>14}{'CP-SAT':>14}")
    for label, key, unit in (
        ("promises broken", "broken_promises", ""),
        ("fields past last waiting day", "late_fields", ""),
        ("fields unserved", "unserved_fields", ""),
        ("wheat lost", "wheat_loss_kg", " kg"),
        ("travel", "travel_km", " km"),
        ("fairness slack", "fairness_slack_days", " d"),
        ("waiting", "waiting_acre_days", " ac-d"),
    ):
        left, right = getattr(search_response.objective, key), getattr(cpsat_response.objective, key)
        print(f"  {label:<30}{f'{left:,.1f}{unit}' if isinstance(left, float) else f'{left}{unit}':>14}"
              f"{f'{right:,.1f}{unit}' if isinstance(right, float) else f'{right}{unit}':>14}")
    print(f"  {'planner time':<30}{f'{search_response.solver.wall_seconds:.2f} s':>14}{f'{cpsat_response.solver.wall_seconds:.2f} s':>14}")
    print(f"  {'CP-SAT status':<30}{'':>14}{cpsat_response.solver.status:>14}")


def run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="npm run plan --",
        description="Plan the seeded, SIMULATED Balian cluster and print each machine's day.",
    )
    parser.add_argument("--seed", type=int, default=1, help="season and search seed (default 1)")
    parser.add_argument("--fields", type=int, default=34, help="number of fields (default 34)")
    parser.add_argument("--machines", type=int, default=4, help="number of machines (default 4)")
    parser.add_argument("--today", default="2026-10-31", help="the simulated today, ISO date (default 2026-10-31)")
    parser.add_argument("--method", choices=("search", "cpsat"), default="search", help="planner (default search)")
    parser.add_argument("--down", action="append", default=[], metavar="MACHINE:DAY",
                        help="after the first plan, a machine breaks on a day (e.g. m2:2026-11-02); re-plans with promises hard")
    parser.add_argument("--rain", action="append", default=[], metavar="DAY",
                        help="after the first plan, rain stops sowing on a day (e.g. 2026-11-03); re-plans with promises hard")
    parser.add_argument("--compare", action="store_true", help="also run CP-SAT on the same cluster and compare objectives")
    parser.add_argument("--cpsat-seconds", type=float, default=2.0, help="CP-SAT time limit for --method cpsat / --compare")
    parser.add_argument("--json", action="store_true", help="print the engine's JSON answer instead of the plan")
    arguments = parser.parse_args(argv)

    started = time.perf_counter()
    cluster = seeded_cluster(arguments.seed, today_date=arguments.today, field_count=arguments.fields,
                             machine_count=arguments.machines)
    request = cluster.request.model_copy(
        update={"settings": cluster.request.settings.model_copy(
            update={"method": arguments.method, "time_limit_seconds": arguments.cpsat_seconds})}
    )
    response = solve(request)

    events: list[str] = []
    if arguments.down or arguments.rain:
        request = adopt_promises(request, response)
        machines = {machine.id: machine for machine in request.machines}
        for item in arguments.down:
            machine_id, _, day_text = item.partition(":")
            if machine_id not in machines or not day_text:
                parser.error(f"--down {item}: expected MACHINE:DAY with MACHINE one of {', '.join(machines)}")
            day = _parse_day(day_text)
            machines[machine_id] = machines[machine_id].model_copy(update={"down_days": [*machines[machine_id].down_days, day]})
            events.append(f"{machines[machine_id].name} breaks down on {_day_label(day)}")
        rain_days = list(request.rain_days)
        for day_text in arguments.rain:
            rain_days.append(_parse_day(day_text))
            events.append(f"rain on {_day_label(rain_days[-1])}")
        request = request.model_copy(update={"machines": list(machines.values()), "rain_days": rain_days})
        first_days = dict(response.field_days)
        response = solve(request)
    elapsed = time.perf_counter() - started

    if arguments.json:
        print(response.model_dump_json(by_alias=True, indent=2))
        return 0

    plan_start, plan_end = response.plan_start_day, response.plan_start_day + request.horizon_days - 1
    planner = (
        f"search (earliest burn deadline + local search, seed {request.settings.search_seed})"
        if response.solver.method == "search" else f"CP-SAT ({response.solver.status})"
    )
    print(f"Vaari plan · seed {arguments.seed}")
    print("SIMULATED season: real villages (OpenStreetMap) and harvest timing (NASA FIRMS); farmers, fields, machines simulated")
    print(f"{cluster.base_village_name} cluster · {len(cluster.village_names)} villages · {len(request.machines)} machines · "
          f"{len(request.fields)} fields · today {_day_label(request.today)} · plan {_day_label(plan_start)} – {_day_label(plan_end)}")
    print(f"Planner: {planner}")
    print(f"Assumed: straight-line distance × {request.settings.road_factor:g} at {request.settings.road_speed_kmh:g} km/h; "
          "each day must fit at the cautious speed, routes are timed at the median")
    if events:
        moved = sum(1 for field_id, day in response.field_days.items() if first_days.get(field_id) not in (None, day))
        broken_items = [item for item in response.promises if item.broken]
        held = sum(1 for item in response.promises if item.previous is not None and not item.broken)
        print(f"\nRe-plan after {' and '.join(events)}: {held} promises held, {len(broken_items)} broken, "
              f"{moved} fields moved to another day")
        if broken_items:
            proof = (
                "CP-SAT proved no plan could break fewer"
                if response.solver.breaks_proven_minimal
                else "not proven minimal (the exact check found no answer in time)"
            )
            print(f"  Broken promises ({proof}); the farmers who can wait longest are moved first:")
            fields_by_id = {field.id: field for field in request.fields}
            for item in broken_items:
                field = fields_by_id[item.field_id]
                print(f"    {item.field_id}  {cluster.village_names[field.village_id]}  {field.acres} ac: "
                      f"{_promise_label(item.previous)} → {_promise_label(item.promise)}"
                      f" (waits until {_day_label(field.ready_day + field.waiting_limit_days)})")

    _print_plan(cluster, request, response)
    _print_objective(response, request.optimum_last_day, request.settings.fairness_k_days)
    print(f"\nPlanned in {response.solver.wall_seconds:.2f} s ({elapsed:.2f} s with building the cluster"
          f"{' and the first plan' if events else ''})")
    if arguments.compare:
        _print_compare(request, response, arguments.cpsat_seconds)
    return 0
