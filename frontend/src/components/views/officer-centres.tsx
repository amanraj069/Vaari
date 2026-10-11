"use client";

/**
 * /dashboard/centres for an agriculture officer: the detail behind the map. Four numbers, the
 * harvest wave against what the machines can sow over the plan's days (a forecast), every machine
 * centre worst outlook first, and the villages to watch. The same query as the map page, so the
 * two never disagree. Aggregates only: no farmer's name or phone. Simulated, labelled so.
 */
import { useTranslations } from "next-intl";
import { DashHeader, Meter, MetricStrip, Panel } from "@/components/dashboard/kit";
import { CentresTable } from "@/components/officer/centres-table";
import { OutlookChart } from "@/components/officer/outlook-chart";
import { centreState } from "@/components/officer/status";
import { lateAfterLending, useOfficerOverview } from "@/components/officer/use-overview";
import { VillagesWatch } from "@/components/officer/villages-watch";
import { Button, Skeleton, StateMessage } from "@/components/ui";
import { useDates } from "@/lib/dates";

const whole = (acres: number) => Math.round(acres);

export function OfficerCentresView() {
  const t = useTranslations("officer");
  const tc = useTranslations("common");
  const dates = useDates();
  const overview = useOfficerOverview();

  if (overview.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only" role="status">
          {tc("loading")}
        </span>
        <Skeleton className="h-10 w-1/2" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (overview.isError) {
    return <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => overview.refetch()}>{tc("retry")}</Button>} />;
  }

  const data = overview.data;
  const { totals, outlook } = data;
  const centreNames = new Map(data.centres.map((centre) => [centre.id, centre.name]));
  const allOnTrack = totals.promisesOnTrack === totals.promisesOpen;
  // One slipped promise in hundreds is worth seeing, not an alarm: warn above 95% on track.
  const onTrackTone = allOnTrack ? "good" : totals.promisesOnTrack >= 0.95 * totals.promisesOpen ? "warn" : "risk";
  const lastDate = outlook.days[outlook.days.length - 1]?.date;
  const lateCentres = data.centres.filter((centre) => centreState(centre) === "late").length;

  return (
    <>
      <DashHeader title={t("centresPageTitle")} description={t("centresPageIntro", { centres: data.centres.length, villages: totals.villages })} />

      {data.centres.length === 0 ? (
        <div className="mt-6">
          <StateMessage title={t("noCentresTitle")} body={t("noCentresBody")} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <MetricStrip
              label={t("metricsLabel")}
              columns="md:grid-cols-4"
              metrics={[
                { label: t("kpiRisk"), value: String(totals.burnRisk), tone: totals.burnRisk > 0 ? "risk" : "neutral", sub: totals.tight > 0 ? t("kpiTight", { count: totals.tight }) : undefined, hint: t("kpiRiskHint") },
                {
                  label: lastDate ? t("kpiLate", { date: dates.dayMonth(lastDate) }) : t("kpiLateNoDate"),
                  value: String(whole(outlook.lateAcres)),
                  tone: outlook.lateAcres >= 0.5 ? "risk" : "good",
                  sub: lateCentres > 0 ? (outlook.moves.length > 0 ? t("kpiLateLend", { centres: lateCentres, after: whole(lateAfterLending(data)) }) : t("kpiLateCentres", { count: lateCentres })) : t("kpiLateNone"),
                  hint: t("kpiLateHint"),
                },
                {
                  label: t("kpiOnTrack"),
                  value: `${totals.promisesOnTrack}/${totals.promisesOpen}`,
                  tone: onTrackTone,
                  sub: t("kpiSeason", { kept: totals.promisesKept, broken: totals.promisesBroken }),
                  visual: <Meter value={totals.promisesOnTrack} max={Math.max(1, totals.promisesOpen)} tone={onTrackTone} label={t("kpiOnTrack")} />,
                },
                {
                  label: t("kpiMachines"),
                  value: `${totals.machinesWorking}/${totals.machinesTotal}`,
                  sub: outlook.days[0] ? t("kpiCapacity", { centres: totals.centres, acres: whole(outlook.days[0].capacityAcres) }) : t("kpiCentres", { count: totals.centres }),
                },
              ]}
            />
          </div>

          <Panel className="mt-6" id="officer-outlook-title" title={t("outlookTitle")} action={<span className="text-xs text-ink-muted">{t("outlookForecast")}</span>}>
            <OutlookChart outlook={outlook} />
          </Panel>

          <section aria-labelledby="officer-centres-title" className="mt-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="officer-centres-title" className="text-base font-semibold">
                {t("centresTitle")}
              </h2>
              <p className="text-xs text-ink-muted">{t("centresHint")}</p>
            </div>
            <CentresTable centres={data.centres} />
          </section>

          <Panel className="mt-6" id="officer-villages-title" title={t("villagesTitle")} action={<span className="text-xs text-ink-muted">{t("villagesServed", { villages: totals.villages })}</span>} bodyClassName="">
            <VillagesWatch villages={data.villages} centreNames={centreNames} />
          </Panel>
        </>
      )}
      <p className="mt-6 text-xs text-ink-muted">{t("footnote")}</p>
    </>
  );
}
