"use client";

/**
 * /dashboard for an agriculture officer: the district at a glance, set like an analytics page
 * rather than a wall of cards. The title and one plain sentence answer first (machines, promises,
 * fields at burn risk and where); one strip of key numbers; then where: the map of booked villages
 * beside a table of the villages to watch, what the approved plans sow over the next ten days,
 * every machine centre, the real fire season from NASA FIRMS, and what the simulator found.
 * Aggregates only (GET /officer/overview): no farmer's name or phone ever reaches this page.
 * Bookings are simulated and labelled so.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FlaskConical } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { officerOverviewSchema, proofResultsSchema, type OfficerOverview } from "@/shared";
import { DashHeader, Meter, MetricStrip, Panel } from "@/components/dashboard/kit";
import { FireSeasonChart } from "@/components/fire-season-chart";
import { CentresTable } from "@/components/officer/centres-table";
import { DistrictMap, MapLegend } from "@/components/officer/district-map";
import { SowingAhead } from "@/components/officer/sowing-ahead";
import { VillagesWatch } from "@/components/officer/villages-watch";
import { Button, Skeleton, StateMessage } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { reductionVsQueue } from "@/lib/proof";

/** The officer's one-line answer, built from counts only (code decides every number). */
function OneLineAnswer({ overview }: { overview: OfficerOverview }) {
  const t = useTranslations("officer");
  const { totals } = overview;
  const riskVillages = overview.villages.filter((village) => village.burnRisk > 0).slice(0, 3).map((village) => village.name);
  const waitingCentres = overview.centres.filter((centre) => centre.draftWaiting).length;
  return (
    <>
      {t("answerMachines", { centres: totals.centres, working: totals.machinesWorking, total: totals.machinesTotal })}{" "}
      {t("answerPromises", { open: totals.promisesOpen, onTrack: totals.promisesOnTrack })}{" "}
      <span className={totals.burnRisk > 0 ? "font-medium text-ember-deep" : ""}>
        {totals.burnRisk > 0 ? t("answerRiskIn", { count: totals.burnRisk, villages: riskVillages.join(", ") }) : t("answerNoRisk")}
      </span>
      {waitingCentres > 0 ? ` ${t("answerDrafts", { count: waitingCentres })}` : ""}
    </>
  );
}

/** What the season simulator found, from the same results file as /proof (simulated, labelled). */
function ProofCard() {
  const t = useTranslations("officer");
  const proof = useQuery({
    queryKey: ["proof"],
    queryFn: () => api("public/proof", proofResultsSchema, {}, { redirectOn401: false }),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const fewer = proof.data ? reductionVsQueue(proof.data.scenarios.base.totals.fieldsLate, "vaari") : null;
  return (
    <section aria-labelledby="officer-proof-title" className="flex h-full flex-col rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="officer-proof-title" className="text-base font-semibold">
          {t("proofTitle")}
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
          <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
          {t("simulatedShort")}
        </span>
      </div>
      {proof.isPending ? (
        <Skeleton className="mt-4 h-24" />
      ) : proof.isSuccess && fewer !== null && fewer > 0 ? (
        <>
          <p className="mt-6 text-5xl font-semibold leading-none tracking-tight text-wheat-deep tabular">{t("proofFigure", { pct: fewer })}</p>
          <p className="mt-3 text-ink-muted">{t("proofBody", { runs: proof.data.runs, centres: proof.data.scenarios.base.centres })}</p>
        </>
      ) : (
        <p className="mt-4 text-ink-muted">{t("proofUnavailable")}</p>
      )}
      <Link href="/dashboard/proof" className="mt-auto inline-flex min-h-11 items-center gap-2 pt-4 font-medium text-wheat-deep underline decoration-wheat-deep/40 underline-offset-4 hover:decoration-wheat-deep">
        {t("proofLink")}
        <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
      </Link>
    </section>
  );
}

export function OfficerOverviewView() {
  const t = useTranslations("officer");
  const tc = useTranslations("common");
  const dates = useDates();
  const overview = useQuery({ queryKey: ["officer-overview"], queryFn: () => api("officer/overview", officerOverviewSchema), refetchInterval: 15_000 });

  if (overview.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only" role="status">
          {tc("loading")}
        </span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (overview.isError) {
    return <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => overview.refetch()}>{tc("retry")}</Button>} />;
  }

  const data = overview.data;
  const { totals } = data;
  const districtNames = data.districts.map((district) => district.name).join(" · ");
  const centreNames = new Map(data.centres.map((centre) => [centre.id, centre.name]));
  const allOnTrack = totals.promisesOnTrack === totals.promisesOpen;

  return (
    <>
      <DashHeader
        context={districtNames ? t("context", { districts: districtNames }) : undefined}
        title={t("title", { date: dates.full(data.today) })}
        description={data.centres.length > 0 ? <OneLineAnswer overview={data} /> : t("intro")}
      />

      {data.centres.length === 0 ? (
        <div className="mt-6">
          <StateMessage title={t("noCentresTitle")} body={t("noCentresBody")} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <MetricStrip
              label={t("metricsLabel")}
              columns="xl:grid-cols-6"
              metrics={[
                {
                  label: t("kpiOnTrack"),
                  value: `${totals.promisesOnTrack}/${totals.promisesOpen}`,
                  tone: allOnTrack ? "good" : "risk",
                  visual: <Meter value={totals.promisesOnTrack} max={Math.max(1, totals.promisesOpen)} tone={allOnTrack ? "good" : "risk"} label={t("kpiOnTrack")} />,
                },
                { label: t("kpiRisk"), value: String(totals.burnRisk), tone: totals.burnRisk > 0 ? "risk" : "neutral", sub: totals.tight > 0 ? t("kpiTight", { count: totals.tight }) : undefined, hint: t("kpiRiskHint") },
                { label: t("kpiWaiting"), value: String(totals.waitingForDate), tone: totals.waitingForDate > 0 ? "warn" : "neutral", hint: t("kpiWaitingHint") },
                { label: t("kpiMachines"), value: `${totals.machinesWorking}/${totals.machinesTotal}`, sub: t("kpiCentres", { count: totals.centres }) },
                { label: t("kpiKept"), value: String(totals.promisesKept), sub: t("kpiSown", { count: totals.fieldsSown }) },
                { label: t("kpiBroken"), value: String(totals.promisesBroken), tone: totals.promisesBroken > 0 ? "risk" : "neutral" },
              ]}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel id="officer-map-title" title={t("mapTitle")} action={<span className="text-xs text-ink-muted">{t("mapSource")}</span>}>
              <DistrictMap overview={data} />
              <div className="mt-2 border-t border-line pt-3">
                <MapLegend />
              </div>
            </Panel>
            <Panel id="officer-villages-title" title={t("villagesTitle")} action={<span className="text-xs text-ink-muted">{t("villagesServed", { villages: totals.villages })}</span>} bodyClassName="">
              <VillagesWatch villages={data.villages} centreNames={centreNames} />
            </Panel>
          </div>

          <Panel className="mt-6" id="officer-ahead-title" title={t("aheadTitle")} action={<span className="text-xs text-ink-muted">{t("aheadOptimum", { date: dates.dayMonth(data.optimumLastDate) })}</span>}>
            <SowingAhead days={data.sowingAhead} />
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
        </>
      )}

      <div className="mt-6 grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <FireSeasonChart compact />
        <ProofCard />
      </div>
      <p className="mt-6 text-xs text-ink-muted">{t("footnote")}</p>
    </>
  );
}
