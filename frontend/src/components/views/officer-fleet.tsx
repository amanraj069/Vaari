"use client";

/**
 * /dashboard/machines for an agriculture officer: the district's machines. How many there are, in
 * each district and at each centre (by kind), how many work tomorrow, how many are in the workshop
 * or on loan, and how loaded each centre's machines are: acres booked with the centre so far this
 * season per machine of its own, against CEEW's break-even of about 105 acres a season for a
 * Super Seeder centre. That load is where a spare machine could come from and where one is
 * stretched. Same query as the map page (GET /officer/overview), so the numbers agree.
 * Aggregates only. Machines and bookings are simulated.
 */
import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { OfficerCentre } from "@/shared";
import { DashHeader, MetricStrip } from "@/components/dashboard/kit";
import { centreState } from "@/components/officer/status";
import { useOfficerOverview } from "@/components/officer/use-overview";
import { Button, Pill, Skeleton, StateMessage } from "@/components/ui";

// CEEW, Custom Hiring Centres for Better Crop Residue Management (2025): break-even near 105 acres a season.
const BREAK_EVEN_ACRES = 105;
const SHOWN = 10;

/** "3 Super Seeders" or "3 Super Seeders · 1 Happy Seeder": only the kinds there are. */
function useKinds() {
  const t = useTranslations("fleet");
  return (superSeeders: number, happySeeders: number) =>
    [superSeeders > 0 ? t("kindSuper", { count: superSeeders }) : null, happySeeders > 0 ? t("kindHappy", { count: happySeeders }) : null].filter(Boolean).join(" · ");
}

const perMachine = (centre: Pick<OfficerCentre, "fleet">) => (centre.fleet.own > 0 ? centre.fleet.acresBookedSeason / centre.fleet.own : 0);

/** Acres per machine as a bar with the break-even marked; the number is always beside it. */
function LoadBar({ acres, scale }: { acres: number; scale: number }) {
  const t = useTranslations("fleet");
  return (
    <div className="flex min-w-36 items-center gap-2">
      <div aria-hidden className="relative h-2 flex-1 rounded-full bg-line">
        <div className="h-full rounded-full bg-ink-muted" style={{ width: `${Math.min(100, (acres / scale) * 100)}%` }} />
        <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `${(BREAK_EVEN_ACRES / scale) * 100}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-sm tabular">{t("acres", { acres: Math.round(acres) })}</span>
    </div>
  );
}

function OutlookPill({ centre }: { centre: OfficerCentre }) {
  const t = useTranslations("officer");
  const state = centreState(centre);
  if (state === "late") return <Pill kind="at_risk">{t("outlookLate", { acres: Math.round(centre.outlook.lateAcres) })}</Pill>;
  if (state === "fragile") return <Pill kind="tight">{t("outlookFragile")}</Pill>;
  return <Pill kind="safe">{t("outlookOnTime")}</Pill>;
}

function Loans({ centre }: { centre: OfficerCentre }) {
  const t = useTranslations("fleet");
  if (centre.fleet.lentOut === 0 && centre.fleet.borrowedIn === 0) return <span className="text-ink-muted">0</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sky">
      <ArrowLeftRight aria-hidden className="size-3.5" strokeWidth={1.75} />
      {[centre.fleet.lentOut > 0 ? t("lent", { count: centre.fleet.lentOut }) : null, centre.fleet.borrowedIn > 0 ? t("borrowed", { count: centre.fleet.borrowedIn }) : null].filter(Boolean).join(" · ")}
    </span>
  );
}

export function OfficerFleetView() {
  const t = useTranslations("fleet");
  const to = useTranslations("officer");
  const tc = useTranslations("common");
  const overview = useOfficerOverview();
  const [showAll, setShowAll] = useState(false);
  const kinds = useKinds();

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

  const { centres } = overview.data;
  const sum = (pick: (centre: OfficerCentre) => number, list = centres) => list.reduce((total, centre) => total + pick(centre), 0);
  const own = sum((centre) => centre.fleet.own);
  const working = sum((centre) => centre.machinesWorking);
  const workshop = sum((centre) => centre.fleet.inWorkshop);
  const onLoan = sum((centre) => centre.fleet.lentOut);
  const sorted = [...centres].sort((left, right) => perMachine(right) - perMachine(left) || left.name.localeCompare(right.name));
  const scale = Math.max(BREAK_EVEN_ACRES * 1.5, ...centres.map(perMachine)) * 1.05;
  const list = showAll ? sorted : sorted.slice(0, SHOWN);
  const districts = [...new Set(centres.map((centre) => centre.district ?? t("outsideDistricts")))].sort();

  return (
    <>
      <DashHeader title={t("title")} description={t("intro", { machines: own, centres: centres.length, working, workshop, loans: onLoan })} />

      {centres.length === 0 ? (
        <div className="mt-6">
          <StateMessage title={to("noCentresTitle")} body={to("noCentresBody")} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <MetricStrip
              label={t("metricsLabel")}
              columns="md:grid-cols-4"
              metrics={[
                { label: t("kpiMachines"), value: String(own), sub: kinds(sum((centre) => centre.fleet.superSeeders), sum((centre) => centre.fleet.happySeeders)) },
                { label: t("kpiWorking"), value: `${working}/${sum((centre) => centre.machinesTotal)}`, tone: working === sum((centre) => centre.machinesTotal) ? "good" : "neutral" },
                { label: t("kpiWorkshop"), value: String(workshop), tone: workshop > 0 ? "warn" : "neutral", sub: t("kpiWorkshopSub") },
                { label: t("kpiLoans"), value: String(onLoan), sub: t("kpiLoansSub") },
              ]}
            />
          </div>

          <section aria-labelledby="fleet-districts-title" className="mt-6">
            <h2 id="fleet-districts-title" className="mb-3 text-base font-semibold">
              {t("byDistrict")}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {districts.map((district) => {
                const here = centres.filter((centre) => (centre.district ?? t("outsideDistricts")) === district);
                const machines = sum((centre) => centre.fleet.own, here);
                const load = machines > 0 ? sum((centre) => centre.fleet.acresBookedSeason, here) / machines : 0;
                return (
                  <li key={district} className="rounded-card border border-line bg-surface p-4 sm:p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{district}</h3>
                      <span className="text-sm text-ink-muted">{t("centresCount", { count: here.length })}</span>
                    </div>
                    <p className="mt-2 text-[26px] font-semibold leading-none tabular">{machines}</p>
                    <p className="mt-1 text-xs text-ink-muted">{t("districtMachines", { working: sum((centre) => centre.machinesWorking, here), workshop: sum((centre) => centre.fleet.inWorkshop, here) })}</p>
                    <div className="mt-4">
                      <p className="mb-1 text-xs text-ink-muted">{t("loadLabel")}</p>
                      <LoadBar acres={load} scale={scale} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="fleet-centres-title" className="mt-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="fleet-centres-title" className="text-base font-semibold">
                {t("byCentre")}
              </h2>
              <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-ink" />
                {t("breakEven", { acres: BREAK_EVEN_ACRES })}
              </p>
            </div>

            {/* Laptop: one row per centre. */}
            <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("byCentre")}>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{t("byCentre")}</caption>
                  <thead className="border-b border-line text-xs text-ink-muted">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-normal">{t("colCentre")}</th>
                      <th scope="col" className="px-4 py-3 font-normal">{t("colMachines")}</th>
                      <th scope="col" className="px-4 py-3 font-normal">{t("colWorking")}</th>
                      <th scope="col" className="hidden px-4 py-3 font-normal lg:table-cell">{t("colLoans")}</th>
                      <th scope="col" className="px-4 py-3 font-normal">{t("colLoad")}</th>
                      <th scope="col" className="hidden px-5 py-3 font-normal xl:table-cell">{t("colOutlook")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.map((centre) => (
                      <tr key={centre.id}>
                        <th scope="row" className="px-5 py-3 font-medium">
                          {centre.name}
                          <span className="block text-xs font-normal text-ink-muted">{centre.district ?? t("outsideDistricts")}</span>
                        </th>
                        <td className="px-4 py-3">
                          <span className="tabular">{centre.fleet.own}</span>
                          <span className="block text-xs text-ink-muted">{kinds(centre.fleet.superSeeders, centre.fleet.happySeeders)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="tabular">{t("ofTotal", { working: centre.machinesWorking, total: centre.machinesTotal })}</span>
                          {centre.fleet.inWorkshop > 0 ? <span className="block text-xs text-wheat-deep">{t("inWorkshop", { count: centre.fleet.inWorkshop })}</span> : null}
                        </td>
                        <td className="hidden px-4 py-3 text-sm lg:table-cell">
                          <Loans centre={centre} />
                        </td>
                        <td className="px-4 py-3">
                          <LoadBar acres={perMachine(centre)} scale={scale} />
                        </td>
                        <td className="hidden px-5 py-3 xl:table-cell">
                          <OutlookPill centre={centre} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phone: name, machines and load per centre, one compact row each. */}
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface md:hidden">
              {list.map((centre) => (
                <li key={centre.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium leading-snug">{centre.name}</p>
                    <OutlookPill centre={centre} />
                  </div>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    {t("phoneLine", { own: centre.fleet.own, working: centre.machinesWorking, total: centre.machinesTotal })}
                    {centre.fleet.lentOut + centre.fleet.borrowedIn > 0 ? (
                      <>
                        {" · "}
                        <Loans centre={centre} />
                      </>
                    ) : null}
                  </p>
                  <div className="mt-2">
                    <LoadBar acres={perMachine(centre)} scale={scale} />
                  </div>
                </li>
              ))}
            </ul>

            {sorted.length > SHOWN ? (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                aria-expanded={showAll}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-wheat-deep underline decoration-wheat-deep/40 underline-offset-4 hover:decoration-wheat-deep"
              >
                {showAll ? t("fewer") : t("all", { count: sorted.length, more: sorted.length - SHOWN })}
              </button>
            ) : null}
          </section>
        </>
      )}
      <p className="mt-6 text-xs text-ink-muted">{t("footnote")}</p>
    </>
  );
}
