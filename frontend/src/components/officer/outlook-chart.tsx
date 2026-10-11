"use client";

/**
 * The officer's main chart: over the plan's ten days, the acres becoming ready each day (booked,
 * solid; expected but not booked yet, the same hue lighter and striped) against the acres the
 * working machines can sow (a 2px step line, labelled on the chart). One axis: acres. Why it
 * exists: it shows the day the harvest outruns the machines, which is when fields wait past their
 * last day. Two sentences above it say the same in words (computed here from the numbers, never
 * written by a model); hovering or focusing a day reads all of its numbers; a hidden table has
 * every value. A FORECAST, labelled with its assumptions under the chart.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { OfficerOverview } from "@/shared";
import { useDates } from "@/lib/dates";
import { LegendKey } from "@/components/dashboard/kit";

type Outlook = OfficerOverview["outlook"];

const STRIPES = "repeating-linear-gradient(135deg, var(--color-outlook-expected) 0 3px, color-mix(in srgb, var(--color-outlook-expected) 40%, transparent) 3px 6px)";

/** A round step for about three gridlines: 1, 2 or 5 times a power of ten. */
function niceStep(max: number): number {
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= rough) ?? power * 10;
}

const whole = (acres: number) => Math.round(acres);

/** The two sentences above the chart: when the harvest peaks against the machines, and when fields wait most. */
export function outlookSummary(outlook: Outlook): {
  peak: Outlook["days"][number];
  ratio: number;
  busiest: Outlook["days"][number];
} | null {
  if (outlook.days.length === 0) return null;
  const ready = (day: Outlook["days"][number]) => day.readyBookedAcres + day.readyExpectedAcres;
  const peak = outlook.days.reduce((best, day) => (ready(day) > ready(best) ? day : best));
  const busiest = outlook.days.reduce((best, day) => (day.waitingAcres > best.waitingAcres ? day : best));
  return {
    peak,
    ratio: peak.capacityAcres > 0 ? Math.round((ready(peak) / peak.capacityAcres) * 10) / 10 : 0,
    busiest,
  };
}

export function OutlookChart({ outlook }: { outlook: Outlook }) {
  const t = useTranslations("officer");
  const dates = useDates();
  const [active, setActive] = useState<number | null>(null);
  const { days } = outlook;
  const top = Math.max(1, ...days.map((day) => Math.max(day.readyBookedAcres + day.readyExpectedAcres, day.capacityAcres)));
  const step = niceStep(top);
  const ceiling = Math.ceil((top * 1.08) / step) * step;
  const ticks = Array.from({ length: Math.floor(ceiling / step) + 1 }, (_, index) => index * step);
  const share = (acres: number) => (acres / ceiling) * 100;
  const summary = outlookSummary(outlook);
  const peakIndex = summary ? days.indexOf(summary.peak) : -1;
  const shown = active !== null ? days[active] : null;
  // The capacity step line, in a 0-1000 x 0-100 box stretched over the columns.
  const columnWidth = 1000 / Math.max(1, days.length);
  const capacityPath = days
    .map((day, index) => {
      const y = 100 - share(day.capacityAcres);
      return `${index === 0 ? "M" : "L"}${(index * columnWidth).toFixed(1)},${y.toFixed(2)} L${((index + 1) * columnWidth).toFixed(1)},${y.toFixed(2)}`;
    })
    .join(" ");
  const lastCapacity = days.length > 0 ? days[days.length - 1]!.capacityAcres : 0;

  return (
    <div>
      {summary ? (
        <p className="max-w-3xl text-[15px] leading-relaxed">
          {t("outlookPeak", {
            date: dates.weekdayShort(summary.peak.date) + " " + dates.dayMonth(summary.peak.date),
            acres: whole(summary.peak.readyBookedAcres + summary.peak.readyExpectedAcres),
            capacity: whole(summary.peak.capacityAcres),
            ratio: summary.ratio,
          })}{" "}
          <span className="text-ink-muted">
            {t("outlookBacklog", {
              date: dates.weekdayShort(summary.busiest.date) + " " + dates.dayMonth(summary.busiest.date),
              acres: whole(summary.busiest.waitingAcres),
            })}
          </span>
        </p>
      ) : null}

      <p aria-live="polite" className="mt-4 min-h-5 text-sm text-ink-muted">
        {shown ? (
          <>
            <span className="font-medium text-ink">{dates.short(shown.date)}</span> ·{" "}
            {t("outlookReadout", {
              booked: whole(shown.readyBookedAcres),
              expected: whole(shown.readyExpectedAcres),
              capacity: whole(shown.capacityAcres),
              waiting: whole(shown.waitingAcres),
            })}
          </>
        ) : (
          <>
            <span className="sm:hidden">{t("outlookHintTouch")}</span>
            <span className="hidden sm:inline">{t("outlookHint")}</span>
          </>
        )}
      </p>

      <div className="mt-8 flex gap-2">
        {/* Acre gridline labels, in the page's type at any width. */}
        <div aria-hidden className="relative h-60 w-10 shrink-0 text-right text-[11px] text-ink-muted tabular">
          <span className="absolute -top-5 right-0 whitespace-nowrap">{t("outlookUnit")}</span>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${share(tick)}%` }}>
              {tick}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          {/* The plot alone (h-60): gridlines, bars, the capacity line and its label share one box. */}
          <div className="relative h-60">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {ticks.map((tick) => (
                <span key={tick} className={`absolute inset-x-0 border-t ${tick === 0 ? "border-line-strong" : "border-line border-dashed"}`} style={{ bottom: `${share(tick)}%` }} />
              ))}
            </div>
            <div
              role="group"
              aria-label={t("outlookLabel")}
              className="relative grid h-60 items-end gap-1.5 sm:gap-3"
              style={{
                gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
              }}
            >
              {days.map((day, index) => {
                const total = day.readyBookedAcres + day.readyExpectedAcres;
                return (
                  <div
                    key={day.date}
                    tabIndex={0}
                    role="img"
                    aria-label={`${dates.short(day.date)}: ${t("outlookReadout", { booked: whole(day.readyBookedAcres), expected: whole(day.readyExpectedAcres), capacity: whole(day.capacityAcres), waiting: whole(day.waitingAcres) })}`}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive((current) => (current === index ? null : current))}
                    className={`relative flex h-full flex-col items-center justify-end rounded-t-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ink ${active === index ? "bg-ink/5" : ""}`}
                  >
                    {index === peakIndex && total > 0 ? <span className="mb-1 text-xs font-semibold tabular">{whole(total)}</span> : null}
                    <div className="flex w-full max-w-9 flex-col items-stretch gap-0.5" style={{ height: `${share(total)}%` }}>
                      {day.readyExpectedAcres > 0 ? (
                        <span
                          aria-hidden
                          className="block rounded-t-[4px]"
                          style={{
                            flexGrow: day.readyExpectedAcres,
                            background: STRIPES,
                            minHeight: 2,
                          }}
                        />
                      ) : null}
                      {day.readyBookedAcres > 0 ? (
                        <span
                          aria-hidden
                          className={`block ${day.readyExpectedAcres > 0 ? "" : "rounded-t-[4px]"}`}
                          style={{
                            flexGrow: day.readyBookedAcres,
                            background: "var(--color-outlook-booked)",
                            minHeight: 2,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <svg aria-hidden viewBox="0 0 1000 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <path d={capacityPath} fill="none" className="stroke-ink" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            <span
              aria-hidden
              className="pointer-events-none absolute right-0 rounded-chip bg-surface/90 px-1.5 text-[11px] font-medium text-ink"
              style={{ bottom: `calc(${share(lastCapacity)}% + 4px)` }}
            >
              {t("outlookCapacityLabel")}
            </span>
          </div>
          <div
            aria-hidden
            className="mt-2 grid gap-1.5 text-center sm:gap-3"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {days.map((day) => (
              <span key={day.date} className="leading-tight">
                <span className="block text-[11px] text-ink-muted">{dates.weekdayShort(day.date)}</span>
                <span className="block text-xs font-medium tabular">{dates.dayOfMonth(day.date)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <LegendKey colour="var(--color-outlook-booked)" label={t("outlookLegendBooked")} />
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: STRIPES }} />
          {t("outlookLegendExpected")}
        </span>
        <LegendKey colour="var(--color-ink)" shape="line" label={t("outlookLegendCapacity")} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        {t("outlookAssumptions", {
          acresPerMachine: outlook.assumptions.acresPerMachineSeason,
          rate: outlook.assumptions.acresPerMachineDay,
          minDays: outlook.assumptions.waitingLimitMinDays,
          maxDays: outlook.assumptions.waitingLimitMaxDays,
        })}
      </p>

      {/* sr-only on a wrapper: a table ignores the 1px width and would widen the page on phones. */}
      <div className="sr-only">
        <table>
          <caption>{t("outlookTitle")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("tableDay")}</th>
              <th scope="col">{t("outlookLegendBooked")}</th>
              <th scope="col">{t("outlookLegendExpected")}</th>
              <th scope="col">{t("outlookLegendCapacity")}</th>
              <th scope="col">{t("outlookColPlanned")}</th>
              <th scope="col">{t("outlookColWaiting")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{dates.short(day.date)}</th>
                <td>{whole(day.readyBookedAcres)}</td>
                <td>{whole(day.readyExpectedAcres)}</td>
                <td>{whole(day.capacityAcres)}</td>
                <td>{whole(day.plannedAcres)}</td>
                <td>{whole(day.waitingAcres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
