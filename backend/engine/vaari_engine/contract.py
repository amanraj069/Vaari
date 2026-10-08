"""The engine's JSON contract.

Why it exists: the web, the API and the engine must agree on one shape for a planning problem
and its answer. These models mirror `shared/src/engine.ts` (Zod) field for field, and both sides
validate the golden fixtures in `shared/fixtures`. Days are integers counted from the season
start date, so the solver never handles calendars or time zones.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ContractModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Village(ContractModel):
    id: str
    name: str
    lat: float
    lon: float


class Base(ContractModel):
    lat: float
    lon: float


class MachineRate(ContractModel):
    # Promises use a cautious low quantile so they hold on slow days; tomorrow's route uses the median.
    promise_acres_per_hour: Annotated[float, Field(gt=0)]
    plan_acres_per_hour: Annotated[float, Field(gt=0)]


class Machine(ContractModel):
    id: str
    name: str
    hours_per_day: Annotated[float, Field(gt=0, le=16)]
    rate: MachineRate
    down_days: list[int] = []


class FirmPromise(ContractModel):
    kind: Literal["firm"]
    day: int


class WindowPromise(ContractModel):
    kind: Literal["window"]
    start_day: int
    end_day: int


Promise = Annotated[FirmPromise | WindowPromise, Field(discriminator="kind")]


class FieldRequest(ContractModel):
    id: str
    village_id: str
    acres: Annotated[float, Field(gt=0, le=100)]
    ready_day: int
    waiting_limit_days: Annotated[int, Field(ge=0, le=30)]
    # Position in the phone queue (first come, first served); used for the fairness guard.
    request_order: int
    promise: Promise | None = None
    # Day this field held in the previous plan; moving it costs a little so re-plans stay calm.
    previous_day: int | None = None


class Pin(ContractModel):
    """An operator's manual move (drag a field to a lane and day). Treated as a hard constraint."""

    field_id: str
    machine_id: str
    day: int


class Settings(ContractModel):
    fairness_k_days: int = 2
    firm_within_days: int = 2
    window_half_width_days: int = 1
    road_factor: float = 1.3  # assumed: straight line to road distance
    road_speed_kmh: float = 20.0  # assumed: tractor with implement on village roads
    setup_minutes_per_field: int = 15  # assumed
    day_start_minute: int = 8 * 60  # assumed: 08:00
    time_limit_seconds: float = 10.0
    wheat_loss_kg_per_acre_per_week: float = 150.0  # PAU Package of Practices, Rabi 2025-26


class SolveRequest(ContractModel):
    season_start_date: str
    today: int
    horizon_days: Annotated[int, Field(ge=1, le=14)] = 10
    # Last day of the wheat sowing optimum as a day index (PAU: first fortnight of November).
    optimum_last_day: int | None = None
    base: Base
    villages: list[Village]
    machines: list[Machine]
    fields: list[FieldRequest]
    rain_days: list[int] = []
    pins: list[Pin] = []
    settings: Settings = Settings()


class ExplainRequest(SolveRequest):
    field_id: str
    # The day the field currently holds; the engine asks "could it be earlier?".
    current_day: int


class Stop(ContractModel):
    field_id: str
    village_id: str
    part: int
    parts: int
    acres: float
    arrive_minute: int
    start_minute: int
    end_minute: int
    travel_minutes_before: int
    # Stretch stops are pulled forward from a later day using the median rate; their promise
    # still stands, so finishing them early is a bonus, not a commitment.
    stretch: bool = False


class Route(ContractModel):
    machine_id: str
    day: int
    stops: list[Stop]
    travel_km: float
    end_minute: int
    capacity_minute: int


class Assignment(ContractModel):
    field_id: str
    machine_id: str
    day: int
    part: int
    parts: int


class PromiseOut(ContractModel):
    field_id: str
    # None only when a broken promise's field could not be re-planned inside the horizon.
    promise: Promise | None
    previous: Promise | None = None
    changed: bool
    broken: bool


class Metrics(ContractModel):
    fields_total: int
    fields_planned: int
    fields_unserved: int
    fields_past_burn_deadline: int
    promises_held: int
    promises_broken: int
    wheat_loss_kg: float
    travel_km: float
    max_delay_vs_queue_days: int
    fields_beyond_fairness_k: int


class SolverInfo(ContractModel):
    status: Literal["optimal", "feasible", "fallback"]
    mode: Literal["normal", "minimal_break"]
    wall_seconds: float
    burn_pass_objective: int | None
    cost_pass_objective: int | None


class SolveResponse(ContractModel):
    plan_start_day: int
    field_days: dict[str, int]
    unserved_field_ids: list[str]
    assignments: list[Assignment]
    routes: list[Route]
    promises: list[PromiseOut]
    queue_days: dict[str, int | None]
    metrics: Metrics
    solver: SolverInfo


ReasonCode = Literal[
    "EARLIEST_PLAN_DAY",
    "FIELD_NOT_READY",
    "RAIN",
    "MACHINE_DOWN",
    "DAYS_FULL",
    "PROMISES_HELD",
    "EARLIER_DEADLINES_AHEAD",
    "ROUTE_GROUPING",
    "BEFORE_BURN_DEADLINE",
]


class Reason(ContractModel):
    code: ReasonCode
    days: list[int] = []
    machine_ids: list[str] = []
    count: int | None = None


class ExplainResponse(ContractModel):
    field_id: str
    current_day: int
    earlier_possible: bool
    reasons: list[Reason]
