"use client";

/**
 * Every machine centre in one table (cards on phones): machines working tomorrow, promises on
 * track as a meter, fields at burn risk, fields still waiting for a date, promises kept and
 * broken this season, and the state of its plan (approved for a day, a re-plan waiting for the
 * operator, or none yet). Sorted with the most fields at burn risk first.
 */
import { useTranslations } from "next-intl";
import type { OfficerCentre } from "@/shared";
import { useDates } from "@/lib/dates";
import { Pill } from "../ui";

function OnTrackMeter({ onTrack, open }: { onTrack: number; open: number }) {
  const t = useTranslations("officer");
  const share = open === 0 ? 1 : onTrack / open;
  return (
    <div className="min-w-28">
      <p className="text-sm tabular">{t("onTrackOf", { onTrack, open })}</p>
      {/* The track is a lighter step of the fill's own colour, so state reads across the whole bar. */}
      <div aria-hidden className={`mt-1.5 h-1.5 w-full rounded-full ${share < 1 ? "bg-ember-soft" : "bg-field-soft"}`}>
        <div className={`h-full rounded-full ${share < 1 ? "bg-ember" : "bg-field"}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

function PlanState({ centre }: { centre: OfficerCentre }) {
  const t = useTranslations("officer");
  const dates = useDates();
  if (centre.draftWaiting) return <Pill kind="draft">{t("planDraft")}</Pill>;
  if (centre.planDate) return <Pill kind="approved">{t("planApproved", { date: dates.short(centre.planDate) })}</Pill>;
  return <Pill kind="unplanned">{t("planNone")}</Pill>;
}

function RiskCount({ count }: { count: number }) {
  const tr = useTranslations("risk");
  return count > 0 ? (
    <Pill kind="at_risk">
      <span className="tabular">{count}</span> {tr("at_risk")}
    </Pill>
  ) : (
    <span className="text-sm tabular text-ink-muted">0</span>
  );
}

export function CentresTable({ centres }: { centres: OfficerCentre[] }) {
  const t = useTranslations("officer");
  const sorted = [...centres].sort((left, right) => right.burnRisk - left.burnRisk || right.waitingForDate - left.waitingForDate || left.name.localeCompare(right.name));

  return (
    <>
      {/* Laptop: one row per centre. */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("centresTitle")}</caption>
          <thead className="border-b border-line text-xs text-ink-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-normal">{t("colCentre")}</th>
              <th scope="col" className="px-4 py-3 font-normal">{t("colMachines")}</th>
              <th scope="col" className="px-4 py-3 font-normal">{t("colOnTrack")}</th>
              <th scope="col" className="px-4 py-3 font-normal">{t("colRisk")}</th>
              <th scope="col" className="px-4 py-3 font-normal">{t("colWaiting")}</th>
              <th scope="col" className="px-4 py-3 font-normal">{t("colKeptBroken")}</th>
              <th scope="col" className="px-5 py-3 font-normal">{t("colPlan")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((centre) => (
              <tr key={centre.id}>
                <th scope="row" className="px-5 py-4 font-medium">
                  {centre.name}
                  <span className="block text-xs font-normal text-ink-muted">{t("centreVillages", { count: centre.villageCount })}</span>
                </th>
                <td className="px-4 py-4 tabular">
                  {t("machinesOf", { working: centre.machinesWorking, total: centre.machinesTotal })}
                </td>
                <td className="px-4 py-4">
                  <OnTrackMeter onTrack={centre.promisesOnTrack} open={centre.promisesOpen} />
                </td>
                <td className="px-4 py-4">
                  <RiskCount count={centre.burnRisk} />
                </td>
                <td className="px-4 py-4 tabular">{centre.waitingForDate}</td>
                <td className="px-4 py-4 tabular">
                  {centre.promisesKept} / <span className={centre.promisesBroken > 0 ? "text-ember-deep" : ""}>{centre.promisesBroken}</span>
                </td>
                <td className="px-5 py-4">
                  <PlanState centre={centre} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per centre, the same facts with their labels. */}
      <ul className="space-y-3 md:hidden">
        {sorted.map((centre) => (
          <li key={centre.id} className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{centre.name}</p>
              <PlanState centre={centre} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">{t("colMachines")}</dt>
                <dd className="tabular">{t("machinesOf", { working: centre.machinesWorking, total: centre.machinesTotal })}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("colRisk")}</dt>
                <dd>
                  <RiskCount count={centre.burnRisk} />
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-ink-muted">{t("colOnTrack")}</dt>
                <dd>
                  <OnTrackMeter onTrack={centre.promisesOnTrack} open={centre.promisesOpen} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("colWaiting")}</dt>
                <dd className="tabular">{centre.waitingForDate}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("colKeptBroken")}</dt>
                <dd className="tabular">
                  {centre.promisesKept} / {centre.promisesBroken}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
