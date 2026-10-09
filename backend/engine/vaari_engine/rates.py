"""Machine speed learned from work logs.

Why it exists: sources disagree on Super Seeder speed (CEEW interviews: about 5.3 acres in an
8-hour day; The Tribune, Jalandhar, 2019, reporting an agriculture department camp: 10-12 a day,
https://www.tribuneindia.com/news/archive/jalandhar/news-detail-863925). Each machine starts from a cautious prior that
spans that range and narrows as the operator logs real work. Promises use the 20th percentile so
they hold on slow days; tomorrow's route uses the median so machines are not left idle.
"""

from __future__ import annotations

from dataclasses import dataclass

PRIOR_LOW_ACRES_PER_DAY = 5.3  # CEEW operator interviews (8-hour day)
PRIOR_HIGH_ACRES_PER_DAY = 12.0  # The Tribune, Jalandhar (2019), agriculture department camp: 10-12 a day, upper end
PRIOR_REFERENCE_HOURS = 8.0
PRIOR_PSEUDO_OBSERVATIONS = 5  # assumed: how much the prior weighs against real logs
PROMISE_QUANTILE = 0.2
PLAN_QUANTILE = 0.5


@dataclass(frozen=True)
class WorkLog:
    acres: float
    hours: float


@dataclass(frozen=True)
class LearnedRate:
    promise_acres_per_hour: float
    plan_acres_per_hour: float
    observations: int  # real logs only, prior excluded


def quantile(sorted_values: list[float], probability: float) -> float:
    """Linear interpolation between closest ranks (same as numpy's default)."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = probability * (len(sorted_values) - 1)
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    fraction = position - lower_index
    return sorted_values[lower_index] + (sorted_values[upper_index] - sorted_values[lower_index]) * fraction


def learn_rate(work_logs: list[WorkLog]) -> LearnedRate:
    prior_step = (PRIOR_HIGH_ACRES_PER_DAY - PRIOR_LOW_ACRES_PER_DAY) / (PRIOR_PSEUDO_OBSERVATIONS - 1)
    samples = [
        (PRIOR_LOW_ACRES_PER_DAY + index * prior_step) / PRIOR_REFERENCE_HOURS
        for index in range(PRIOR_PSEUDO_OBSERVATIONS)
    ]
    usable_logs = [log for log in work_logs if log.hours > 0 and log.acres > 0]
    samples.extend(log.acres / log.hours for log in usable_logs)
    samples.sort()
    return LearnedRate(
        promise_acres_per_hour=quantile(samples, PROMISE_QUANTILE),
        plan_acres_per_hour=quantile(samples, PLAN_QUANTILE),
        observations=len(usable_logs),
    )
