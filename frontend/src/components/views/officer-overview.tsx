"use client";

/**
 * /dashboard for an agriculture officer: the map first. The officer decides where machines go
 * across the district's centres, so the page is one sentence (fields at burn risk now, and what
 * lending machines does over the plan's days), then the map of centres, loans and villages at risk
 * beside the list of what to do. Choosing a centre on the map or in the list shows its facts.
 * Everything else (the numbers, the harvest wave, every centre in a table, villages to watch) is
 * on /dashboard/centres. Every number is counted or computed in code from GET /officer/overview
 * (aggregates only: no farmer's name or phone). Bookings, machines and breakdowns are simulated;
 * the outlook is a forecast.
 */
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { OfficerOverview } from "@/shared";
import { DashHeader } from "@/components/dashboard/kit";
import { RISE } from "@/components/dashboard/motion";
import { motion } from "motion/react";
import { DistrictMap, MapLegend, type MapLayer } from "@/components/officer/district-map";
import { DistrictPanel } from "@/components/officer/district-panel";
import { centreState } from "@/components/officer/status";
import { lateAfterLending, useOfficerOverview } from "@/components/officer/use-overview";
import { Button, Skeleton, StateMessage } from "@/components/ui";
import { useDates } from "@/lib/dates";

const whole = (acres: number) => Math.round(acres);

/** The officer's one-line answer, built from counts and the outlook (code decides every number). */
function OneLineAnswer({ overview }: { overview: OfficerOverview }) {
  const t = useTranslations("officer");
  const dates = useDates();
  const { totals, outlook } = overview;
  const riskVillages = overview.villages.filter((village) => village.burnRisk > 0).slice(0, 3).map((village) => village.name);
  const lateCentres = overview.centres.filter((centre) => centreState(centre) === "late").length;
  const lastDate = outlook.days[outlook.days.length - 1]?.date;
  const date = lastDate ? dates.dayMonth(lastDate) : "";
  const after = lateAfterLending(overview);
  const extra = outlook.extraMachines.reduce((sum, item) => sum + item.machines, 0);
  let next: string | null = null;
  if (lastDate) {
    if (lateCentres === 0) next = t("answerOnTime", { date });
    else if (outlook.moves.length > 0 && whole(after) === 0) next = t("answerLendAll", { count: outlook.moves.length, date });
    else if (outlook.moves.length > 0) next = `${t("answerLate", { date, acres: whole(outlook.lateAcres), centres: lateCentres })} ${t("answerLend", { count: outlook.moves.length, acres: whole(after) })}`;
    else next = t("answerLate", { date, acres: whole(outlook.lateAcres), centres: lateCentres });
    if (extra > 0) next += ` ${t("answerAdd", { count: extra })}`;
  }
  return (
    <>
      <span className={totals.burnRisk > 0 ? "font-medium text-ember-deep" : ""}>
        {totals.burnRisk > 0 ? t("answerRiskIn", { count: totals.burnRisk, villages: riskVillages.join(", ") }) : t("answerNoRisk")}
      </span>
      {next ? ` ${next}` : ""}
    </>
  );
}

export function OfficerOverviewView() {
  const t = useTranslations("officer");
  const tc = useTranslations("common");
  const dates = useDates();
  const overview = useOfficerOverview();
  const [layer, setLayer] = useState<MapLayer>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedMove, setHighlightedMove] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Below xl the panel sits under the map: choosing a centre on the map brings its facts into view.
  const chooseOnMap = (centreId: string | null) => {
    setSelectedId(centreId);
    if (centreId && typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  if (overview.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only" role="status">
          {tc("loading")}
        </span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-6 w-2/3" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Skeleton className="h-[560px]" />
          <Skeleton className="h-[560px]" />
        </div>
      </div>
    );
  }
  if (overview.isError) {
    return <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => overview.refetch()}>{tc("retry")}</Button>} />;
  }

  const data = overview.data;
  const districtNames = data.districts.map((district) => district.name).join(" · ");

  return (
    <>
      <DashHeader
        context={districtNames ? t("context", { districts: districtNames, centres: data.centres.length }) : undefined}
        title={t("title", { date: dates.full(data.today) })}
        description={data.centres.length > 0 ? <OneLineAnswer overview={data} /> : t("intro")}
      />

      {data.centres.length === 0 ? (
        <div className="mt-6">
          <StateMessage title={t("noCentresTitle")} body={t("noCentresBody")} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {/* The map card: a slim header (title, what the map shows), then the map with its legend in
              a column beside it from lg up (the district is tall and narrow, so the sides are free),
              under it on phones. The map itself is sized to fit the window (DistrictMap). */}
          <motion.section variants={RISE} aria-labelledby="officer-map-title" className="min-w-0 rounded-card border border-line bg-surface">
            <div className="border-b border-line px-4 py-3.5 sm:px-5">
              <h2 id="officer-map-title" className="text-base font-semibold">
                {t("mapTitle")}
              </h2>
            </div>
            <div className="p-3 sm:p-5 lg:flex lg:items-end lg:gap-5">
              <div className="min-w-0 lg:flex-1">
                <DistrictMap overview={data} layer={layer} selectedId={selectedId} onSelect={chooseOnMap} highlightedMove={highlightedMove} />
              </div>
              <div className="mt-3 border-t border-line pt-1 lg:mt-0 lg:flex lg:w-48 lg:shrink-0 lg:flex-col lg:self-stretch lg:border-l lg:border-t-0 lg:pb-1 lg:pl-5 lg:pt-0">
                {/* By default the map shows all bookings; this filters to critical only (fields at burn risk). */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={layer === "critical"}
                  onClick={() => setLayer(layer === "critical" ? "all" : "critical")}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {t("layerCritical")}
                  <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ${layer === "critical" ? "bg-ink" : "bg-line-strong"}`}>
                    <span className={`absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform duration-200 ${layer === "critical" ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </span>
                </button>
                <div className="mt-2 border-t border-line pt-3 lg:mt-auto lg:border-t-0 lg:pt-0">
                  <MapLegend layer={layer} hasLoans={data.outlook.loans.length > 0} />
                </div>
              </div>
            </div>
          </motion.section>
          {/* Beside the map (xl) the panel is exactly the map card's height and scrolls inside itself,
              so the row always fits the window; below xl it sits under the map at its own height. */}
          <div ref={panelRef} className="relative scroll-mt-20">
            <div className="rounded-card border border-line bg-surface p-3 sm:p-5 xl:absolute xl:inset-0 xl:overflow-y-auto">
              <DistrictPanel overview={data} selectedId={selectedId} onSelect={setSelectedId} onHighlight={setHighlightedMove} />
            </div>
          </div>
        </div>
      )}
      <p className="mt-6 text-xs text-ink-muted">{t("footnote")}</p>
    </>
  );
}
