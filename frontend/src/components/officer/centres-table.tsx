"use client";

/**
 * Every machine centre in one table (cards on phones), worst outlook first: whether its fields
 * will pass their last waiting day over the plan's days (a forecast), and what one machine more or
 * less would do; machines working tomorrow and what they can sow; fields at burn risk now; promises
 * on track as a meter; promises kept and broken this season; and the state of its plan. On phones
 * a compact list: name and outlook, then one line of facts. Eight centres show at first, the rest
 * one tap away.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { OfficerCentre } from "@/shared";
import { useDates } from "@/lib/dates";
import { Pill } from "../ui";
import { byOutlook, centreState } from "./status";

const SHOWN = 8;
const whole = (acres: number) => Math.round(acres);

function OnTrackMeter({ onTrack, open }: { onTrack: number; open: number }) {
  const t = useTranslations("officer");
  const share = open === 0 ? 1 : onTrack / open;
  return (
    <div className="min-w-24">
      <p className="text-sm tabular">{t("onTrackOf", { onTrack, open })}</p>
      {/* The track is a lighter step of the fill's own colour, so state reads across the whole bar. */}
      <div aria-hidden className={`mt-1.5 h-1.5 w-full rounded-full bg-line/80`}>
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

/** The outlook in a word: icon and label, never colour alone. */
function OutlookPill({ centre }: { centre: OfficerCentre }) {
  const t = useTranslations("officer");
  const state = centreState(centre);
  if (state === "late") return <Pill kind="at_risk">{t("outlookLate", { acres: whole(centre.outlook.lateAcres) })}</Pill>;
  if (state === "fragile") return <Pill kind="tight">{t("outlookFragile")}</Pill>;
  return <Pill kind="safe">{t("outlookOnTime")}</Pill>;
}

/** What one machine more (or less) changes for the centre. */
function outlookDetail(centre: OfficerCentre, t: ReturnType<typeof useTranslations>): string {
  const state = centreState(centre);
  const { lateIfOneDownAcres, lateIfOneMoreAcres } = centre.outlook;
  if (state === "late") return whole(lateIfOneMoreAcres) === 0 ? t("outlookOneMoreClears") : t("outlookOneMore", { acres: whole(lateIfOneMoreAcres) });
  if (state === "fragile") return t("outlookIfOneDown", { acres: whole(lateIfOneDownAcres ?? 0) });
  return lateIfOneDownAcres !== null ? t("outlookCanSpare") : t("outlookOnlyOne");
}

function Outlook({ centre }: { centre: OfficerCentre }) {
  const t = useTranslations("officer");
  return (
    <div>
      <OutlookPill centre={centre} />
      <p className="mt-1 text-xs text-ink-muted">{outlookDetail(centre, t)}</p>
    </div>
  );
}

export function CentresTable({ centres }: { centres: OfficerCentre[] }) {
  const t = useTranslations("officer");
  const [showAll, setShowAll] = useState(false);
  const sorted = [...centres].sort(byOutlook);
  const list = showAll ? sorted : sorted.slice(0, SHOWN);
  const more = sorted.length - list.length;
  const toggle =
    sorted.length > SHOWN ? (
      <button
        type="button"
        onClick={() => setShowAll((value) => !value)}
        aria-expanded={showAll}
        className="min-h-11 w-full border-t border-line px-5 text-left text-sm font-medium text-ink hover:bg-ink/[0.03] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
      >
        {showAll ? t("centresFewer") : t("centresAll", { count: sorted.length, more })}
      </button>
    ) : null;

  return (
    <>
      {/* Laptop: one row per centre. */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
        {/* Focusable, so a keyboard can scroll it if a long name or language ever makes it wider. */}
        <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink" tabIndex={0} role="region" aria-label={t("centresTitle")}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("centresTitle")}</caption>
            <thead className="border-b border-line text-xs text-ink-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-normal">{t("colCentre")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("colOutlook")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("colMachines")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("colRisk")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("colOnTrack")}</th>
                <th scope="col" className="hidden px-4 py-3 font-normal xl:table-cell">{t("colKeptBroken")}</th>
                <th scope="col" className="hidden px-5 py-3 font-normal xl:table-cell">{t("colPlan")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((centre) => (
                <tr key={centre.id}>
                  <th scope="row" className="px-5 py-3.5 font-medium">
                    {centre.name}
                    <span className="block text-xs font-normal text-ink-muted">{t("centreVillages", { count: centre.villageCount })}</span>
                  </th>
                  <td className="px-4 py-3.5">
                    <Outlook centre={centre} />
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="tabular">{t("machinesOf", { working: centre.machinesWorking, total: centre.machinesTotal })}</span>
                    <span className="block text-xs text-ink-muted">{t("canSow", { acres: whole(centre.outlook.capacityAcresPerDay) })}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <RiskCount count={centre.burnRisk} />
                  </td>
                  <td className="px-4 py-3.5">
                    <OnTrackMeter onTrack={centre.promisesOnTrack} open={centre.promisesOpen} />
                  </td>
                  <td className="hidden px-4 py-3.5 tabular xl:table-cell">
                    {centre.promisesKept} / <span className={centre.promisesBroken > 0 ? "text-ember-deep" : ""}>{centre.promisesBroken}</span>
                  </td>
                  <td className="hidden px-5 py-3.5 xl:table-cell">
                    <PlanState centre={centre} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {toggle}
      </div>

      {/* Phone: one compact list (a row per centre: name and outlook, then one line of facts), not
          a tall card each, so eight centres fit in about two screens. */}
      <div className="overflow-hidden rounded-card border border-line bg-surface md:hidden">
        <ul className="divide-y divide-line">
          {list.map((centre) => (
            <li key={centre.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium leading-snug">{centre.name}</p>
                <OutlookPill centre={centre} />
              </div>
              <p className="mt-1 text-[13px] leading-snug text-ink-muted">
                {outlookDetail(centre, t)} · {t("phoneMachines", { working: centre.machinesWorking, total: centre.machinesTotal })}
                {centre.burnRisk > 0 ? <span className="text-ember-deep"> · {t("phoneRisk", { count: centre.burnRisk })}</span> : null}
              </p>
            </li>
          ))}
        </ul>
        {toggle}
      </div>
    </>
  );
}
