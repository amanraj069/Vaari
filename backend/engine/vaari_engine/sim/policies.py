"""Three ways to run a CHC's machines, played day by day on one simulated season.

Why it exists: the comparison is only fair if every policy meets the same farmers, breakdowns and
rain, and works under the same physics. Each evening a policy decides tomorrow's work; the next day
each machine works at its TRUE speed (drawn from the real 5.3-12 acres/day range, unknown to the
planners) until its working day, including the drive back to the CHC, is used up. What does not fit
waits for a later day. Rain stops everyone; a breakdown stops one machine. A farmer whose field is
not sown by their last waiting day burns the stubble and leaves the queue (CEEW: uncertainty over
the machine is why farmers burn); they sow with an ordinary drill the next day (assumed), and the
CHC loses that booking. The same rule holds under every policy: a farmer holding a promised date
waits their full limit, one without gives up `days_sooner_without_date` days sooner (0 in the base
season, so the promise itself earns Vaari nothing there).

- phone_queue: first come, first served, run as CEEW describes most CHCs: a rental desk. The next
  free machine goes from the CHC to the earliest caller whose field is ready and comes back before
  the next rental (the 'Direct transfers' season lets it go straight on instead). A rental may come
  back late (`phone_queue_late_return_chance`, 0 in the base season): the machine is gone for the
  rest of that day.
- nearest: nearest village next, a driver-run service. After each field the machine goes straight
  on to the ready field closest to where it is.
- vaari: every evening the search planner plans the next ten days with every promise as a hard
  constraint, on machine speeds learned from the work done so far (the product's own `learn_rate`);
  tomorrow's routes are driven, and a machine with time left goes on to the most urgent ready field
  of the plan ("early if time allows", as on the operator's lanes). Promises are made, firmed, kept
  or broken as in the product, and the operator is assumed to approve each evening's plan.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..contract import Base, FieldRequest, FirmPromise, Machine, MachineRate, Settings, SolveRequest, Village, WindowPromise
from ..geo import StraightLineTravel
from ..problem import BASE_ID, Problem
from ..rates import WorkLog, learn_rate
from ..search import plan_by_search
from ..solve import solve
from .season import Season, SimField, SimMachine

POLICIES = ("phone_queue", "nearest", "vaari")
# Less than this is not worth driving to (a few minutes of sowing).
MIN_SOWING_ACRES = 0.05
DONE_EPSILON_ACRES = 0.01

Promise = FirmPromise | WindowPromise


def last_day(promise: Promise) -> int:
    return promise.day if isinstance(promise, FirmPromise) else promise.end_day


@dataclass
class Outcome:
    policy: str
    sown_day: dict[str, int | None]  # the day the CHC sowed the field's last acre (None: never)
    burned: set[str]  # farmers who gave up waiting and burned (their field left the queue)
    burned_day: dict[str, int]  # the last day each of them waited
    burned_acres: dict[str, float]  # the acres still unsown when they gave up (burned)
    acres_sown: float
    km: float
    promises_kept: int | None = None  # Vaari only: the baselines promise nothing
    promises_broken: int | None = None
    first_promise: dict[str, Promise] = field(default_factory=dict)
    # Days each farmer waited after harvest without holding a promised date or window (the
    # baselines never give one, so for them it is every waiting day).
    days_without_date: dict[str, int] = field(default_factory=dict)


class _MachineDay:
    """One machine's working day: where it is, the minutes used, and the work it can still fit."""

    def __init__(self, machine: SimMachine, travel: StraightLineTravel, setup_minutes: int) -> None:
        self.machine = machine
        self.travel = travel
        self.setup_minutes = setup_minutes
        self.capacity = machine.hours_per_day * 60
        self.clock = 0.0
        self.location = BASE_ID
        self.km = 0.0
        self.done = False

    def sow(self, village_id: str, wanted_acres: float) -> float:
        """Drive to the village and sow as much as fits before driving home. Returns acres sown."""
        drive_there = self.travel.minutes(self.location, village_id)
        drive_home = self.travel.minutes(village_id, BASE_ID)
        sowing_minutes = self.capacity - self.clock - drive_there - self.setup_minutes - drive_home
        sown = min(wanted_acres, max(0.0, sowing_minutes) / 60 * self.machine.acres_per_hour)
        if sown < min(MIN_SOWING_ACRES, wanted_acres - 1e-9) or sown <= 0:
            self.done = True
            return 0.0
        self.km += self.travel.road_km(self.location, village_id)
        self.clock += drive_there + self.setup_minutes + sown / self.machine.acres_per_hour * 60
        self.location = village_id
        if sown < wanted_acres - 1e-9:
            self.done = True  # out of time; the rest waits
        return sown

    def go_home(self) -> None:
        """Drive back to the CHC (between rentals at a rental desk, or at the end of the day)."""
        if self.location != BASE_ID:
            self.clock += self.travel.minutes(self.location, BASE_ID)
            self.km += self.travel.road_km(self.location, BASE_ID)
            self.location = BASE_ID


class _Simulation:
    def __init__(self, season: Season, policy: str, seed: int, search_rounds: int, horizon_days: int) -> None:
        self.season = season
        self.policy = policy
        self.seed = seed
        self.search_rounds = search_rounds
        self.horizon_days = horizon_days
        points = {BASE_ID: (season.base["lat"], season.base["lon"])}
        points.update({village["id"]: (village["lat"], village["lon"]) for village in season.villages})
        self.travel = StraightLineTravel(points, season.road_factor, season.road_speed_kmh)
        self.field_by_id = {item.id: item for item in season.fields}
        self.remaining = {item.id: item.acres for item in season.fields}
        self.sown_day: dict[str, int | None] = {item.id: None for item in season.fields}
        self.burned: set[str] = set()
        self.burned_day: dict[str, int] = {}
        self.burned_acres: dict[str, float] = {}
        # Each evening, after any plan: the days on which a waiting farmer holds no promise.
        self.no_date_days: dict[str, list[int]] = {item.id: [] for item in season.fields}
        self.logs: dict[str, list[WorkLog]] = {machine.id: [] for machine in season.machines}
        self.km = 0.0
        self.acres_sown = 0.0
        # Vaari's promises: the one each field holds now, and the first it was given (for the replay).
        self.promise: dict[str, Promise | None] = {item.id: None for item in season.fields}
        self.first_promise: dict[str, Promise] = {}
        self.planned_day: dict[str, int] = {}
        self.kept = 0
        self.broken = 0

    def run(self) -> Outcome:
        season = self.season
        for evening in range(season.first_day, season.last_day):
            tomorrow = evening + 1
            routes = self._plan_vaari(evening) if self.policy == "vaari" else {}
            for item in season.fields:
                if item.ready_day <= tomorrow and self.sown_day[item.id] is None and item.id not in self.burned and self.promise[item.id] is None:
                    self.no_date_days[item.id].append(tomorrow)
            if tomorrow not in season.rain_days:
                working = [machine for machine in season.machines if not season.machine_down(machine.id, tomorrow)]
                if self.policy == "vaari":
                    self._drive_routes(tomorrow, working, routes, evening)
                else:
                    self._dispatch(tomorrow, working, evening)
            # End of the day: a farmer whose last waiting day this was, still unsown, burns and leaves.
            for item in season.fields:
                if self.sown_day[item.id] is not None or item.id in self.burned:
                    continue
                if season.gives_up_after(item, holds_promise=self.promise[item.id] is not None) <= tomorrow:
                    self.burned.add(item.id)
                    self.burned_day[item.id] = tomorrow
                    self.burned_acres[item.id] = self.remaining[item.id]
                    self.remaining[item.id] = 0.0
                    if self.promise[item.id] is not None:
                        self.broken += 1
                        self.promise[item.id] = None
            if all(day is not None or item_id in self.burned for item_id, day in self.sown_day.items()):
                break
        vaari = self.policy == "vaari"
        # A waiting day counts until the day the farmer is sown (that day excluded) or gives up.
        ends = {item.id: self.sown_day[item.id] if self.sown_day[item.id] is not None else self.burned_day.get(item.id, season.last_day) for item in season.fields}
        days_without_date = {field_id: sum(1 for day in days if day < ends[field_id]) for field_id, days in self.no_date_days.items()}
        return Outcome(
            policy=self.policy,
            sown_day=self.sown_day,
            burned=self.burned,
            burned_day=self.burned_day,
            burned_acres=self.burned_acres,
            acres_sown=self.acres_sown,
            km=self.km,
            promises_kept=self.kept if vaari else None,
            promises_broken=self.broken if vaari else None,
            first_promise=self.first_promise,
            days_without_date=days_without_date,
        )

    def _record(self, simulated: SimField, machine: SimMachine, acres: float, day: int) -> None:
        self.remaining[simulated.id] -= acres
        self.acres_sown += acres
        # Pure sowing time, as an operator's work log would show it; Vaari learns speed from these.
        self.logs[machine.id].append(WorkLog(acres=acres, hours=acres / machine.acres_per_hour))
        if self.remaining[simulated.id] <= DONE_EPSILON_ACRES:
            self.remaining[simulated.id] = 0.0
            self.sown_day[simulated.id] = day
            held = self.promise[simulated.id]
            if held is not None:
                if day <= last_day(held):
                    self.kept += 1
                else:
                    self.broken += 1
                self.promise[simulated.id] = None

    def _dispatch(self, day: int, working: list[SimMachine], evening: int) -> None:
        """The baselines: the next free machine takes the next field by the policy's rule."""
        pending = [
            item
            for item in self.season.fields
            if item.request_day <= evening and item.ready_day <= day and self.remaining[item.id] > 0
        ]
        machine_days = [_MachineDay(machine, self.travel, self.season.setup_minutes) for machine in working]
        rental_desk = self.policy == "phone_queue" and self.season.phone_queue_returns_to_chc
        taken: set[str] = set()
        while True:
            free = [machine_day for machine_day in machine_days if not machine_day.done]
            if not free:
                break
            current = min(free, key=lambda machine_day: (machine_day.clock, machine_day.machine.id))
            choices = [item for item in pending if item.id not in taken]
            if not choices:
                current.done = True
                continue
            if self.policy == "phone_queue":
                chosen = min(choices, key=lambda item: item.request_order)
            else:
                chosen = min(choices, key=lambda item: (self.travel.minutes(current.location, item.village_id), item.request_order))
            if rental_desk:
                current.go_home()  # the last rental comes back to the CHC before the next one goes out
            sown = current.sow(chosen.village_id, self.remaining[chosen.id])
            if sown > 0:
                taken.add(chosen.id)
                self._record(chosen, current.machine, sown, day)
                if self.policy == "phone_queue" and self.season.rental_returns_late(chosen.id, day):
                    current.done = True  # the farmer keeps the machine for the rest of the day
        for machine_day in machine_days:
            machine_day.go_home()
            self.km += machine_day.km

    def _drive_routes(self, day: int, working: list[SimMachine], routes: dict[str, list[tuple[str, float]]], evening: int) -> None:
        """Vaari: each machine drives its planned route in order, at its true speed. With time left,
        it goes on to the most urgent ready field of the plan that no machine has today."""
        on_routes = {field_id for route in routes.values() for field_id, _acres in route}
        taken: set[str] = set()
        for machine in working:
            machine_day = _MachineDay(machine, self.travel, self.season.setup_minutes)
            for field_id, acres in routes.get(machine.id, []):
                wanted = min(acres, self.remaining[field_id])
                if wanted <= 0:
                    continue
                sown = machine_day.sow(self.field_by_id[field_id].village_id, wanted)
                if sown > 0:
                    taken.add(field_id)
                    self._record(self.field_by_id[field_id], machine, sown, day)
                if machine_day.done:
                    break
            while not machine_day.done:
                extra = [
                    item
                    for item in self.season.fields
                    if item.request_day <= evening
                    and item.ready_day <= day
                    and self.remaining[item.id] > 0
                    and item.id not in on_routes
                    and item.id not in taken
                ]
                if not extra:
                    break
                chosen = min(extra, key=lambda item: (self.planned_day.get(item.id, 10**6), item.burn_deadline, item.request_order))
                sown = machine_day.sow(chosen.village_id, self.remaining[chosen.id])
                if sown <= 0:
                    break
                taken.add(chosen.id)
                self._record(chosen, machine, sown, day)
            machine_day.go_home()
            self.km += machine_day.km

    def _plan_vaari(self, evening: int) -> dict[str, list[tuple[str, float]]]:
        """The evening plan: promises hard, speeds learned, breakdowns and rain known one day ahead."""
        season = self.season
        tomorrow = evening + 1
        # A promise whose last day has passed with the field unsown is broken.
        for field_id, held in self.promise.items():
            if held is not None and last_day(held) < tomorrow and self.sown_day[field_id] is None:
                self.broken += 1
                self.promise[field_id] = None
        active = [item for item in season.fields if item.request_day <= evening and self.remaining[item.id] > 0]
        if not active:
            return {}
        machines = []
        for machine in season.machines:
            rate = learn_rate(self.logs[machine.id])
            machines.append(
                Machine(
                    id=machine.id,
                    name=machine.name,
                    hours_per_day=machine.hours_per_day,
                    rate=MachineRate(promise_acres_per_hour=rate.promise_acres_per_hour, plan_acres_per_hour=rate.plan_acres_per_hour),
                    down_days=season.known_down_days(machine.id, evening),
                )
            )
        request = SolveRequest(
            season_start_date="2026-10-01",
            today=evening,
            horizon_days=self.horizon_days,
            optimum_last_day=season.optimum_last_day,
            base=Base(lat=season.base["lat"], lon=season.base["lon"]),
            villages=[Village(**village) for village in season.villages],
            machines=machines,
            fields=[
                FieldRequest(
                    id=item.id,
                    village_id=item.village_id,
                    acres=round(self.remaining[item.id], 3),
                    ready_day=item.ready_day,
                    waiting_limit_days=item.waiting_limit_days,
                    request_order=item.request_order,
                    promise=self.promise[item.id],
                    previous_day=self.planned_day.get(item.id),
                )
                for item in active
            ],
            rain_days=season.known_rain_days(evening),
            settings=Settings(
                method="search",
                search_seed=self.seed,
                road_factor=season.road_factor,
                road_speed_kmh=season.road_speed_kmh,
                setup_minutes_per_field=season.setup_minutes,
            ),
        )
        problem = Problem(request)
        # No CP-SAT check here: it is time-limited, so it could make two runs of one seed differ.
        result = plan_by_search(problem, seed=self.seed, rounds=self.search_rounds, check_breaks_exactly=False)
        response = solve(request, problem, result.assignment)
        for item in response.promises:
            if item.broken:
                self.broken += 1
            if item.promise is not None and item.field_id not in self.first_promise:
                self.first_promise[item.field_id] = item.promise
            self.promise[item.field_id] = item.promise
        self.planned_day = dict(response.field_days)
        routes: dict[str, list[tuple[str, float]]] = {}
        for route in response.routes:
            if route.day == tomorrow:
                routes[route.machine_id] = [(stop.field_id, stop.acres) for stop in route.stops]
        return routes


def play(season: Season, policy: str, seed: int, search_rounds: int, horizon_days: int) -> Outcome:
    return _Simulation(season, policy, seed, search_rounds, horizon_days).run()
