"use client";

/**
 * Workload: every machine (rows) on every plan day (columns), each cell the hours the machine is
 * busy with the number written in it and the cell's fill one wheat step per band (light under half
 * a day, medium under 80%, full above): one hue, light to dark. A day in the workshop is hatched
 * with a spanner; rain days carry a cloud in the header. Clicking a day picks it, like the day strip.
 */
import { CloudRain, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PlanDay } from "@/shared";
import { useDates } from "@/lib/dates";
import { DAYS_SHOWN } from "./plan-calendar";

const BANDS = [
  { upTo: 0, className: "bg-transparent text-ink-muted" },
  { upTo: 0.5, className: "bg-wheat/20 text-ink" },
  { upTo: 0.8, className: "bg-wheat/50 text-ink" },
  { upTo: Infinity, className: "bg-wheat text-on-wheat" },
];

function band(share: number): string {
  return (BANDS.find((item) => share <= item.upTo) ?? BANDS.at(-1)!).className;
}

export function WorkloadGrid({ days: allDays, selected, onSelect }: { days: PlanDay[]; selected: string; onSelect: (date: string) => void }) {
  const days = allDays.slice(0, DAYS_SHOWN);
  const t = useTranslations("schedule");
  const dates = useDates();
  const machines = days[0]?.machines ?? [];
  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[40rem] table-fixed border-separate border-spacing-[3px] text-xs">
          <caption className="sr-only">{t("workloadCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-28 text-left font-normal text-ink-muted">
                <span className="sr-only">{t("machine")}</span>
              </th>
              {days.map((day) => (
                <th key={day.date} scope="col" className="p-0 font-normal">
                  <button
                    type="button"
                    onClick={() => onSelect(day.date)}
                    aria-pressed={day.date === selected}
                    aria-label={dates.full(day.date)}
                    className={`flex min-h-11 w-full flex-col items-center justify-center rounded-chip py-1 transition-colors duration-200 ${day.date === selected ? "bg-wheat-solid text-on-solid shadow-[0_6px_14px_-8px_rgb(143_98_16/0.7)]" : "text-ink-muted hover:bg-sunken"}`}
                  >
                    <span>{dates.weekdayShort(day.date)}</span>
                    <span className="font-semibold tabular">{dates.dayOfMonth(day.date)}</span>
                    <span aria-hidden className="h-3">{day.rain ? <CloudRain className="size-3" strokeWidth={1.75} /> : null}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machines.map((machine, row) => (
              <tr key={machine.machineId}>
                <th scope="row" className="truncate pr-1 text-left font-normal" title={machine.name}>
                  {machine.name}
                </th>
                {days.map((day) => {
                  const cell = day.machines[row]!;
                  const share = cell.capacityMinutes === 0 ? 0 : cell.busyMinutes / cell.capacityMinutes;
                  const hours = Math.round((cell.busyMinutes / 60) * 10) / 10;
                  const label = cell.down
                    ? t("cellDown", { machine: machine.name, date: dates.short(day.date) })
                    : t("cellBusy", { machine: machine.name, date: dates.short(day.date), hours, of: Math.round(cell.capacityMinutes / 60), fields: cell.fields });
                  return (
                    <td key={day.date} title={label} aria-label={label} className={`h-9 rounded-[6px] text-center tabular ${cell.down ? "hatched text-ink-muted" : band(cell.busyMinutes === 0 ? 0 : share)} ${day.date === selected ? "outline outline-1 outline-ink/40" : ""}`}>
                      {cell.down ? <Wrench aria-hidden className="mx-auto size-3.5" strokeWidth={1.75} /> : cell.busyMinutes === 0 ? "–" : hours}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
        <span>{t("workloadKey")}</span>
        {[
          { className: "bg-wheat/20", label: t("bandLight") },
          { className: "bg-wheat/50", label: t("bandBusy") },
          { className: "bg-wheat", label: t("bandFull") },
        ].map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`size-3 rounded-[3px] border border-line ${item.className}`} />
            {item.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="hatched size-3 rounded-[3px] border border-line" />
          {t("bandDown")}
        </span>
      </div>
    </div>
  );
}
