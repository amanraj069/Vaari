/**
 * "When the fires come": real NASA FIRMS detections per day over the Sangrur box, October and
 * November, 2024 and 2025 pooled, with PAU's best wheat-sowing fortnight (1-15 November) shaded.
 * It shows the point of the product in one picture: the fires peak in the very weeks wheat has to
 * go in. Every number here is computed from src/data/fire-season.json (scripts/fire-season.mjs).
 */
import { useTranslations } from "next-intl";
import fireSeason from "@/data/fire-season.json";

// Days after 1 October. 1-15 November is PAU's sowing optimum (OPTIMUM_LAST_DATE is 15 November).
const FIRST_DAY = 0;
const LAST_DAY = 60; // 30 November
const OPTIMUM_FIRST = 31;
const OPTIMUM_LAST = 45;
const TICKS = [0, 14, 31, 45, 60];
const SEASON_YEAR = 2025; // any year: only the day and month are shown

function isoForDay(day: number): string {
  return new Date(Date.UTC(SEASON_YEAR, 9, 1 + day)).toISOString().slice(0, 10);
}

export function fireSeasonFacts() {
  const counts = new Map(fireSeason.days.map(([day, count]) => [day!, count!]));
  const shown = Array.from({ length: LAST_DAY - FIRST_DAY + 1 }, (_, index) => ({ day: FIRST_DAY + index, count: counts.get(FIRST_DAY + index) ?? 0 }));
  const peak = shown.reduce((best, entry) => (entry.count > best.count ? entry : best), shown[0]!);
  const inOptimum = fireSeason.days.filter(([day]) => day! >= OPTIMUM_FIRST && day! <= OPTIMUM_LAST).reduce((sum, [, count]) => sum + count!, 0);
  return {
    shown,
    peak,
    total: fireSeason.detections,
    inOptimum,
    optimumShare: Math.round((inOptimum / fireSeason.detections) * 100),
  };
}

/** framed=false drops the card border and fill, for use inside another card (the landing's evidence panel). */
export function FireSeasonChart({ framed = true }: { framed?: boolean }) {
  const t = useTranslations("landing");
  const td = useTranslations("dates");
  const monthsShort = td.raw("monthsShort") as string[];
  const label = (day: number) => {
    const date = new Date(`${isoForDay(day)}T00:00:00Z`);
    return td("dayMonth", { day: date.getUTCDate(), month: monthsShort[date.getUTCMonth()]! });
  };
  const facts = fireSeasonFacts();
  const span = LAST_DAY - FIRST_DAY + 1;
  const barWidth = 10;
  const height = 160;
  const maxCount = facts.peak.count;
  const percent = (day: number) => `${((day - FIRST_DAY) / span) * 100}%`;

  return (
    <figure className={framed ? "rounded-card border border-line bg-surface/80 p-5 sm:p-6" : "p-5 sm:p-8"}>
      <figcaption>
        <h3 className="font-display text-2xl">{t("chartTitle")}</h3>
        <p className="mt-1 text-ink-muted">{t("chartBody")}</p>
      </figcaption>
      <div className="relative mt-6">
        <div
          aria-hidden
          className="chart-band absolute inset-y-0 rounded-chip border border-dashed border-field/60 bg-field/15"
          style={{ left: percent(OPTIMUM_FIRST), width: `${((OPTIMUM_LAST - OPTIMUM_FIRST + 1) / span) * 100}%` }}
        />
        <svg
          role="img"
          aria-label={t("chartLabel", { total: facts.total, peakDate: label(facts.peak.day), peakCount: facts.peak.count, share: facts.optimumShare })}
          viewBox={`0 0 ${span * barWidth} ${height}`}
          preserveAspectRatio="none"
          className="relative block h-40 w-full sm:h-48"
        >
          {facts.shown.map(({ day, count }) => {
            const barHeight = (count / maxCount) * (height - 4);
            // --bar staggers the bars' rise when the chart scrolls into view (InViewState, globals.css).
            return <rect key={day} x={(day - FIRST_DAY) * barWidth + 1.5} y={height - barHeight} width={barWidth - 3} height={barHeight} rx={1.5} className="chart-bar fill-ember" style={{ ["--bar" as string]: day - FIRST_DAY }} />;
          })}
        </svg>
        <div aria-hidden className="relative mt-2 h-5 text-xs text-ink-muted">
          {TICKS.map((day, index) => (
            <span
              key={day}
              className="absolute whitespace-nowrap tabular"
              style={index === 0 ? { left: 0 } : index === TICKS.length - 1 ? { right: 0 } : { left: percent(day), transform: "translateX(-50%)" }}
            >
              {label(day)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm bg-ember" />
          {t("chartLegendFires")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm border border-dashed border-field/60 bg-field/15" />
          {t("chartLegendOptimum")}
        </span>
      </div>
      <p className="mt-4 text-sm text-ink-muted">{t("chartSource")}</p>
    </figure>
  );
}
