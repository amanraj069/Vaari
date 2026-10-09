"""What one simulated season says about each policy, and how many seasons are summarised.

Why it exists: the proof page reports the same measures for every policy, each as a median with
the 10th to 90th percentile over all runs, never one run. A farmer who burned (not sown by their
last waiting day) sows with an ordinary drill the next day (assumed); their wheat timing and their
delay are counted from that day, and the CHC earns nothing for that field.

Air: a farmer who gives up burns the acres still unsown. Straw burned = those acres x the straw
per acre Punjab reports to the NGT; PM2.5 = straw x the share that actually combusts (IPCC
default) x the PM2.5 emitted per kg of rice straw burned (Gadde et al.), the method a Punjab study
used (all in data/sim/assumptions.json, `constants`, with sources).
"""

from __future__ import annotations

from dataclasses import dataclass

from ..rates import quantile
from .policies import Outcome
from .season import Assumptions, Season

# Key, unit, and which direction is better (the page uses these to label columns).
METRICS: list[dict[str, str]] = [
    {"key": "fieldsLate", "unit": "fields", "better": "lower"},
    {"key": "fieldsLatePct", "unit": "percent", "better": "lower"},
    {"key": "medianWaitDays", "unit": "days", "better": "lower"},
    {"key": "daysWithoutDate", "unit": "days", "better": "lower"},
    {"key": "acresBurned", "unit": "acres", "better": "lower"},
    {"key": "strawBurnedTonnes", "unit": "tonnes", "better": "lower"},
    {"key": "pm25Kg", "unit": "kg", "better": "lower"},
    {"key": "acresAfterOptimum", "unit": "acres", "better": "lower"},
    {"key": "wheatLostKg", "unit": "kg", "better": "lower"},
    {"key": "promisesKeptPct", "unit": "percent", "better": "higher"},
    {"key": "kmDriven", "unit": "km", "better": "lower"},
    {"key": "acresPerMachine", "unit": "acres", "better": "higher"},
    {"key": "incomePerMachineRupees", "unit": "rupees", "better": "higher"},
    {"key": "worstDelayVsQueueDays", "unit": "days", "better": "lower"},
]


@dataclass(frozen=True)
class Constants:
    """The sourced conversions the measures use (data/sim/assumptions.json, `constants`)."""

    wheat_kg_per_acre_week: float
    rent_per_acre: float
    straw_tonnes_per_acre: float
    combustion_factor: float
    pm25_grams_per_kg: float

    @classmethod
    def from_assumptions(cls, assumptions: Assumptions) -> Constants:
        return cls(
            wheat_kg_per_acre_week=float(assumptions.constant("wheatLossKgPerAcrePerWeek")),
            rent_per_acre=float(assumptions.constant("rentRupeesPerAcre")),
            straw_tonnes_per_acre=float(assumptions.constant("strawTonnesPerAcre")),
            combustion_factor=float(assumptions.constant("burnCombustionFactor")),
            pm25_grams_per_kg=float(assumptions.constant("pm25GramsPerKgStrawBurned")),
        )


def season_metrics(season: Season, outcomes: dict[str, Outcome], constants: Constants) -> dict[str, dict[str, float | None]]:
    """Every measure for every policy, for one season."""
    optimum = season.optimum_last_day
    wheat_kg_per_acre_week, rent_per_acre = constants.wheat_kg_per_acre_week, constants.rent_per_acre

    def wheat_day(outcome: Outcome) -> dict[str, int]:
        """The day each field was sown: by the CHC, or by the farmer the day after they gave up and burned."""
        return {item.id: outcome.sown_day[item.id] if outcome.sown_day[item.id] is not None else outcome.burned_day[item.id] + 1 for item in season.fields}

    queue_day = wheat_day(outcomes["phone_queue"])
    results: dict[str, dict[str, float | None]] = {}
    for policy, outcome in outcomes.items():
        sown = wheat_day(outcome)
        late = len(outcome.burned)
        after_optimum = [item for item in season.fields if sown[item.id] > optimum]
        promises = None
        if outcome.promises_kept is not None and outcome.promises_broken is not None:
            total = outcome.promises_kept + outcome.promises_broken
            promises = 100 * outcome.promises_kept / total if total else None
        acres_per_machine = outcome.acres_sown / len(season.machines)
        acres_burned = sum(outcome.burned_acres.values())
        # Days each farmer waited after harvest: until the CHC sowed (its last acre), or until they gave up.
        waits = sorted(
            max(0, (outcome.sown_day[item.id] if outcome.sown_day[item.id] is not None else outcome.burned_day[item.id]) - item.ready_day)
            for item in season.fields
        )
        straw_tonnes = acres_burned * constants.straw_tonnes_per_acre
        results[policy] = {
            "fieldsLate": late,
            "fieldsLatePct": 100 * late / len(season.fields),
            "medianWaitDays": quantile(waits, 0.5),
            # The mean over farmers of the days they waited with no promised date or window.
            "daysWithoutDate": sum(outcome.days_without_date.get(item.id, 0) for item in season.fields) / len(season.fields),
            "acresBurned": acres_burned,
            "strawBurnedTonnes": straw_tonnes,
            # tonnes -> kg of straw (x1000), x grams per kg burned, / 1000 -> kg of PM2.5
            "pm25Kg": straw_tonnes * constants.combustion_factor * constants.pm25_grams_per_kg,
            "acresAfterOptimum": sum(item.acres for item in after_optimum),
            "wheatLostKg": sum(item.acres * wheat_kg_per_acre_week / 7 * (sown[item.id] - optimum) for item in after_optimum),
            "promisesKeptPct": promises,
            "kmDriven": outcome.km,
            "acresPerMachine": acres_per_machine,
            "incomePerMachineRupees": acres_per_machine * rent_per_acre,
            # How much later than the phone queue the worst-off farmer was sown (0 for the queue).
            "worstDelayVsQueueDays": max(sown[item.id] - queue_day[item.id] for item in season.fields),
        }
    return results


def spread(values: list[float | None]) -> dict[str, float] | None:
    """Median and the 10th to 90th percentile; None when the measure does not apply."""
    present = sorted(value for value in values if value is not None)
    if not present:
        return None
    return {
        "median": round(quantile(present, 0.5), 2),
        "p10": round(quantile(present, 0.1), 2),
        "p90": round(quantile(present, 0.9), 2),
    }


def summarise(per_run: list[dict[str, dict[str, float | None]]], policies: tuple[str, ...]) -> dict[str, dict[str, dict[str, float] | None]]:
    return {
        metric["key"]: {policy: spread([run[policy][metric["key"]] for run in per_run]) for policy in policies}
        for metric in METRICS
    }


# Measures compared season by season with the phone queue, and those also summed over all seasons.
PAIRED_METRICS = ["fieldsLate", "medianWaitDays", "pm25Kg", "wheatLostKg", "kmDriven", "incomePerMachineRupees"]
TOTAL_METRICS = ["fieldsLate", "acresBurned", "strawBurnedTonnes", "pm25Kg"]


def paired_with_queue(per_run: list[dict[str, dict[str, float | None]]], policies: tuple[str, ...]) -> dict[str, dict[str, dict[str, float] | None]]:
    """Every policy against the phone queue on the SAME seasons: the share of seasons it did better,
    the same, or worse, and the spread of the difference (policy minus phone queue)."""
    better_is_lower = {metric["key"]: metric["better"] == "lower" for metric in METRICS}
    out: dict[str, dict[str, dict[str, float] | None]] = {}
    for key in PAIRED_METRICS:
        out[key] = {}
        for policy in policies:
            if policy == "phone_queue":
                continue
            differences = [run[policy][key] - run["phone_queue"][key] for run in per_run]  # type: ignore[operator]
            sign = 1 if better_is_lower[key] else -1
            better = sum(1 for difference in differences if sign * difference < -1e-9)
            worse = sum(1 for difference in differences if sign * difference > 1e-9)
            difference = spread(differences)
            assert difference is not None
            out[key][policy] = {
                "betterPct": round(100 * better / len(differences), 2),
                "samePct": round(100 * (len(differences) - better - worse) / len(differences), 2),
                "worsePct": round(100 * worse / len(differences), 2),
                "differenceMedian": difference["median"],
                "differenceP10": difference["p10"],
                "differenceP90": difference["p90"],
            }
    return out


def totals(per_run: list[dict[str, dict[str, float | None]]], policies: tuple[str, ...]) -> dict[str, dict[str, float]]:
    """Sums over every season (farmers, acres, straw, PM2.5 add up; medians of a ratio would not)."""
    return {key: {policy: round(sum(run[policy][key] or 0 for run in per_run), 2) for policy in policies} for key in TOTAL_METRICS}
