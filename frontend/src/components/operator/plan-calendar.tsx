"use client";

/**
 * Picking a day of the plan's next week, two ways. DayStrip: the seven days in a row (Today page),
 * each with its fields, how full the machines are and a rain or burn-risk mark. DayList: the same
 * days as a vertical list (Plan page). Both report the picked ISO date.
 * Load = minutes the working machines are busy over the minutes they can work that day.
 */
import { AlertTriangle, CloudRain } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import type { PlanDay } from "@/shared";
import { useDates } from "@/lib/dates";
import { EASE_OUT, RISE, SLIDE, STAGGER } from "../dashboard/motion";

export function dayLoad(day: PlanDay): number {
  const working = day.machines.filter((machine) => !machine.down);
  const capacity = working.reduce((sum, machine) => sum + machine.capacityMinutes, 0);
  const busy = working.reduce((sum, machine) => sum + machine.busyMinutes, 0);
  return capacity === 0 ? 0 : Math.min(1, busy / capacity);
}

function dayLabel(t: ReturnType<typeof useTranslations>, dates: ReturnType<typeof useDates>, day: PlanDay): string {
  const parts = [dates.full(day.date), t("dayFields", { count: day.fields }), t("dayLoad", { pct: Math.round(dayLoad(day) * 100) })];
  if (day.rain) parts.push(t("dayRain"));
  if (day.atRisk > 0) parts.push(t("dayAtRisk", { count: day.atRisk }));
  return parts.join(", ");
}

export function DayStrip({ days, selected, onSelect }: { days: PlanDay[]; selected: string; onSelect: (date: string) => void }) {
  const t = useTranslations("schedule");
  const dates = useDates();
  const highlightId = useId();
  return (
    <div role="group" aria-label={t("pickDay")} className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="grid min-w-[28rem] grid-cols-7 gap-1.5">
        {days.slice(0, DAYS_SHOWN).map((day) => {
          const active = day.date === selected;
          const load = dayLoad(day);
          return (
            <button
              key={day.date}
              type="button"
              aria-pressed={active}
              aria-label={dayLabel(t, dates, day)}
              onClick={() => onSelect(day.date)}
              className={`relative flex min-h-[5.5rem] flex-col items-center gap-1 rounded-control border px-1 pb-2 pt-2 text-center transition-colors duration-200 ${
                active ? "border-transparent" : "border-line bg-surface hover:border-wheat-deep/40"
              }`}
            >
              {/* The selection slides from day to day (one shared element, not a flash). */}
              {active ? <motion.span layoutId={`day-strip-${highlightId}`} transition={SLIDE} aria-hidden className={SELECTED_TILE} /> : null}
              <span className={`relative text-xs ${active ? "text-wheat-deep" : "text-ink-muted"}`}>{dates.weekdayShort(day.date)}</span>
              <span className="relative text-lg font-semibold leading-none tabular">{dates.dayOfMonth(day.date)}</span>
              <span className={`relative text-[11px] tabular ${active ? "text-wheat-deep" : "text-ink-muted"}`}>{t("dayFieldsShort", { count: day.fields })}</span>
              <LoadBar load={load} active={active} className="relative mt-auto w-8" />
              <span aria-hidden className="relative flex h-3.5 items-center gap-1">
                {day.rain ? <CloudRain className="size-3.5" strokeWidth={2} /> : null}
                {day.atRisk > 0 ? <AlertTriangle className="size-3.5 text-ember-deep" strokeWidth={2} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The selected day, in the platform's wheat: a soft fill and a fine wheat edge, in both themes. */
const SELECTED_TILE = "absolute inset-0 rounded-control bg-wheat-soft ring-1 ring-inset ring-wheat-deep/40";

/** How full the working machines are that day; the fill grows in when the day appears. */
function LoadBar({ load, active, className = "" }: { load: number; active: boolean; className?: string }) {
  return (
    <span aria-hidden className={`block h-1 overflow-hidden rounded-full ${active ? "bg-wheat-deep/20" : "bg-line"} ${className}`}>
      <motion.span
        className="block h-full rounded-full bg-wheat-deep"
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(load * 100)}%` }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
    </span>
  );
}

/** How many days the operator's pickers show: a week ahead is what an operator plans by. */
export const DAYS_SHOWN = 7;

/**
 * The plan's next seven days as a vertical list (the Plan page): weekday and date, the fields and
 * acres that day, how full the machines are, and a rain or burn-risk mark. One row is the day the
 * machines' lanes show; picking another row shows that day.
 */
export function DayList({ days, selected, onSelect }: { days: PlanDay[]; selected: string; onSelect: (date: string) => void }) {
  const t = useTranslations("schedule");
  const dates = useDates();
  const highlightId = useId();
  return (
    <motion.ul role="list" aria-label={t("pickDay")} className="space-y-1" variants={STAGGER} initial="hidden" animate="shown">
      {days.slice(0, DAYS_SHOWN).map((day) => {
        const active = day.date === selected;
        return (
          <motion.li key={day.date} variants={RISE}>
            <button
              type="button"
              aria-pressed={active}
              aria-label={dayLabel(t, dates, day)}
              onClick={() => onSelect(day.date)}
              className="group relative flex min-h-14 w-full items-center gap-4 rounded-control px-3 py-2 text-left"
            >
              {active ? (
                <motion.span layoutId={`day-list-${highlightId}`} transition={SLIDE} aria-hidden className={SELECTED_TILE} />
              ) : (
                <span aria-hidden className="absolute inset-0 rounded-control transition-colors duration-200 group-hover:bg-paper" />
              )}
              <span className="relative w-11 shrink-0 text-center leading-tight">
                <span className={`block text-xs transition-colors ${active ? "text-wheat-deep" : "text-ink-muted"}`}>{dates.weekdayShort(day.date)}</span>
                <span className="block text-lg font-semibold tabular">{dates.dayOfMonth(day.date)}</span>
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="block text-sm font-medium">{day.fields > 0 ? t("dayFieldsAcres", { fields: day.fields, acres: day.acres }) : t("dayNothing")}</span>
                <LoadBar load={dayLoad(day)} active={active} className="mt-1.5 w-full" />
              </span>
              <span aria-hidden className="relative flex w-10 shrink-0 items-center justify-end gap-1.5">
                {day.rain ? <CloudRain className="size-4" strokeWidth={2} /> : null}
                {day.atRisk > 0 ? <AlertTriangle className="size-4 text-ember-deep" strokeWidth={2} /> : null}
              </span>
            </button>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
