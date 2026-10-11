"use client";

/**
 * Picking a day of the plan's ten days, two ways. DayStrip: the ten days in a row (Today page),
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
      <div className="grid min-w-[40rem] grid-cols-10 gap-1.5 rounded-card bg-sunken p-1.5 ring-1 ring-inset ring-line">
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
              className={`relative flex min-h-[5.5rem] flex-col items-center gap-1 rounded-control border px-1 pb-2 pt-2 text-center transition-[border-color,translate,box-shadow,color] duration-200 active:translate-y-0 ${
                active ? "border-transparent text-on-solid" : "border-line bg-raised shadow-[0_1px_2px_rgb(27_26_23/0.06)] hover:-translate-y-0.5 hover:border-ink/35 hover:shadow-[0_6px_16px_-12px_rgb(27_26_23/0.5)]"
              }`}
            >
              {/* The selection slides from day to day (one shared element, not a flash). */}
              {active ? <motion.span layoutId={`day-strip-${highlightId}`} transition={SLIDE} aria-hidden className={SELECTED_TILE} /> : null}
              <span className={`relative text-xs ${active ? "text-on-solid/80" : "text-ink-muted"}`}>{dates.weekdayShort(day.date)}</span>
              <span className="relative text-lg font-semibold leading-none tabular">{dates.dayOfMonth(day.date)}</span>
              <span className={`relative text-[11px] tabular ${active ? "text-on-solid/80" : "text-ink-muted"}`}>{t("dayFieldsShort", { count: day.fields })}</span>
              <LoadBar load={load} active={active} className="relative mt-auto w-8" />
              <span aria-hidden className="relative flex h-3.5 items-center gap-1">
                {day.rain ? <CloudRain className="size-3.5" strokeWidth={2} /> : null}
                {day.atRisk > 0 ? <AlertTriangle className={`size-3.5 ${active ? "text-on-solid" : "text-ember-deep"}`} strokeWidth={2} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The selected day: a deep wheat tile with white type (the brand, a step darker), lifted off the white tiles around it. */
const SELECTED_TILE = "absolute inset-0 rounded-control bg-wheat-solid shadow-[0_8px_18px_-10px_rgb(143_98_16/0.7)]";

/** How full the working machines are that day; the fill grows in when the day appears. */
function LoadBar({ load, active = false, className = "" }: { load: number; active?: boolean; className?: string }) {
  return (
    <span aria-hidden className={`block h-1 overflow-hidden rounded-full ${active ? "bg-on-solid/30" : "bg-line"} ${className}`}>
      <motion.span
        className={`block h-full rounded-full ${active ? "bg-on-solid" : "bg-wheat-deep"}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(load * 100)}%` }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
    </span>
  );
}

/** How many days the operator's pickers show: a week ahead is what an operator plans by. */
export const DAYS_SHOWN = 10;

/**
 * The plan's ten days as a vertical list (the Plan page): weekday and date, the fields and
 * acres that day, how full the machines are, and a rain or burn-risk mark. One row is the day the
 * machines' lanes show; picking another row shows that day.
 */
export function DayList({
  days,
  selected,
  onSelect,
  className = "",
}: {
  days: PlanDay[];
  selected: string;
  onSelect: (date: string) => void;
  className?: string;
}) {
  const t = useTranslations("schedule");
  const dates = useDates();
  const highlightId = useId();
  // Rows grow evenly to fill whatever height the parent gives the list (the Plan page matches the lanes card).
  return (
    <motion.ul role="list" aria-label={t("pickDay")} className={`flex flex-col gap-1 ${className}`} variants={STAGGER} initial="hidden" animate="shown">
      {days.slice(0, DAYS_SHOWN).map((day) => {
        const active = day.date === selected;
        return (
          <motion.li key={day.date} variants={RISE} className="flex flex-1">
            <button
              type="button"
              aria-pressed={active}
              aria-label={dayLabel(t, dates, day)}
              onClick={() => onSelect(day.date)}
              className="group relative flex min-h-14 w-full flex-1 items-center gap-4 rounded-control px-3 py-2 text-left"
            >
              {active ? (
                <motion.span layoutId={`day-list-${highlightId}`} transition={SLIDE} aria-hidden className={SELECTED_TILE} />
              ) : (
                <span aria-hidden className="absolute inset-0 rounded-control transition-colors duration-200 group-hover:bg-sunken" />
              )}
              <span className="relative w-11 shrink-0 text-center leading-tight">
                <span className={`block text-xs transition-colors ${active ? "text-on-solid/80" : "text-ink-muted"}`}>{dates.weekdayShort(day.date)}</span>
                <span className={`block text-lg font-semibold tabular ${active ? "text-on-solid" : ""}`}>{dates.dayOfMonth(day.date)}</span>
              </span>
              <span className="relative min-w-0 flex-1">
                <span className={`block text-sm font-medium ${active ? "text-on-solid" : ""}`}>{day.fields > 0 ? t("dayFieldsAcres", { fields: day.fields, acres: day.acres }) : t("dayNothing")}</span>
                <LoadBar load={dayLoad(day)} active={active} className="mt-1.5 w-full" />
              </span>
              <span aria-hidden className="relative flex w-10 shrink-0 items-center justify-end gap-1.5">
                {day.rain ? <CloudRain className={`size-4 ${active ? "text-on-solid" : ""}`} strokeWidth={2} /> : null}
                {day.atRisk > 0 ? <AlertTriangle className={`size-4 ${active ? "text-on-solid" : "text-ember-deep"}`} strokeWidth={2} /> : null}
              </span>
            </button>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
