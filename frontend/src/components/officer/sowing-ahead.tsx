"use client";

/**
 * "Sowing ahead": how many fields the approved plans put on each of the next ten days, all
 * centres together. One series, so no legend: the title names it. Columns (HTML, so the type stays
 * the page's size at any width) grow from one baseline with 4px rounded tops; the busiest day
 * carries its number, the rest show theirs on hover or focus, and a hidden table has every value.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { OfficerOverview } from "@/shared";
import { useDates } from "@/lib/dates";

export function SowingAhead({ days }: { days: OfficerOverview["sowingAhead"] }) {
  const t = useTranslations("officer");
  const dates = useDates();
  const [active, setActive] = useState<number | null>(null);
  const maxFields = Math.max(1, ...days.map((day) => day.fields));
  const busiest = days.reduce((best, day, index) => (day.fields > (days[best]?.fields ?? -1) ? index : best), 0);
  const total = days.reduce((sum, day) => sum + day.fields, 0);
  const shown = active !== null ? days[active] : null;

  return (
    <div>
      <p aria-live="polite" className="min-h-5 text-sm text-ink-muted">
        {shown ? (
          <>
            <span className="font-medium text-ink tabular">{t("aheadFields", { count: shown.fields })}</span> · {t("aheadAcres", { acres: shown.acres })} · {dates.short(shown.date)}
          </>
        ) : total === 0 ? (
          t("aheadEmpty")
        ) : (
          t("aheadHint")
        )}
      </p>
      <div role="group" aria-label={t("aheadLabel", { total })} className="mt-4 grid h-48 grid-cols-10 items-end gap-1.5 border-b border-line-strong sm:gap-3">
        {days.map((day, index) => (
          <div
            key={day.date}
            tabIndex={0}
            role="img"
            aria-label={`${dates.short(day.date)}: ${t("aheadFields", { count: day.fields })}, ${t("aheadAcres", { acres: day.acres })}`}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive((current) => (current === index ? null : current))}
            onFocus={() => setActive(index)}
            onBlur={() => setActive((current) => (current === index ? null : current))}
            className={`flex h-full flex-col items-center justify-end rounded-t-[6px] outline-none ${active === index ? "bg-ink/5" : ""}`}
          >
            {index === busiest && day.fields > 0 ? <span className="mb-1 text-xs font-semibold tabular">{day.fields}</span> : null}
            <span
              aria-hidden
              className={`w-full max-w-6 rounded-t-[4px] ${day.fields > 0 ? (active === index ? "bg-wheat" : "bg-wheat-deep") : "bg-line-strong"}`}
              style={{ height: day.fields > 0 ? `${(day.fields / maxFields) * 82}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-2 grid grid-cols-10 gap-1.5 text-center sm:gap-3">
        {days.map((day) => (
          <span key={day.date} className="leading-tight">
            <span className="block text-[11px] text-ink-muted">{dates.weekdayShort(day.date)}</span>
            <span className="block text-xs font-medium tabular">{dates.dayOfMonth(day.date)}</span>
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t("aheadTitle")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("tableDay")}</th>
            <th scope="col">{t("tableFields")}</th>
            <th scope="col">{t("tableAcres")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{dates.short(day.date)}</th>
              <td>{day.fields}</td>
              <td>{day.acres}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
