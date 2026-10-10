"use client";

/**
 * "Villages to watch" as a compact table: every village with booked fields, the ones with fields
 * at burn risk or tight first. Columns: village (and its centre when there are several), active
 * fields, at risk, tight, and a thin bar of the village's fields by state (2px gaps), with the
 * same counts in the cells, so the bar is never the only way to read it. Counts only: no farmer
 * is named.
 */
import { useTranslations } from "next-intl";
import type { OfficerVillage } from "@/shared";
import { STATUS_COLOUR, STATUS_ORDER, villageSplit } from "./status";

const SHOWN = 8;

export function VillagesWatch({ villages, centreNames }: { villages: OfficerVillage[]; centreNames: Map<string, string> }) {
  const t = useTranslations("officer");
  const tr = useTranslations("risk");
  const active = villages.filter((village) => village.fieldsActive > 0);
  const list = active.slice(0, SHOWN);

  if (active.length === 0) return <p className="p-5 text-sm text-ink-muted">{t("villagesEmpty")}</p>;

  return (
    <div>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("villagesTitle")}</caption>
        <thead className="border-b border-line text-xs text-ink-muted">
          <tr>
            <th scope="col" className="w-[42%] py-2.5 pl-5 pr-2 font-normal">
              {t("colVillage")}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-normal">
              {t("tableFields")}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-normal">
              {tr("at_risk")}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-normal">
              {tr("tight")}
            </th>
            <th scope="col" className="w-[22%] py-2.5 pl-2 pr-5 font-normal">
              <span className="sr-only">{t("colSplit")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {list.map((village) => {
            const split = villageSplit(village);
            return (
              <tr key={`${village.centreId}/${village.id}`}>
                <th scope="row" className="max-w-0 py-3 pl-5 pr-2 font-medium">
                  <span className="block truncate">{village.name}</span>
                  {centreNames.size > 1 ? <span className="block truncate text-xs font-normal text-ink-muted">{centreNames.get(village.centreId)}</span> : null}
                </th>
                <td className="px-2 py-3 text-right tabular">{village.fieldsActive}</td>
                <td className={`px-2 py-3 text-right tabular ${village.burnRisk > 0 ? "font-semibold text-ember-deep" : "text-ink-muted"}`}>{village.burnRisk}</td>
                <td className={`px-2 py-3 text-right tabular ${village.tight > 0 ? "text-wheat-deep" : "text-ink-muted"}`}>{village.tight}</td>
                <td className="py-3 pl-2 pr-5">
                  <div aria-hidden className="flex h-1.5 gap-0.5">
                    {STATUS_ORDER.filter((status) => split[status] > 0).map((status) => (
                      <span key={status} className="h-full rounded-full" style={{ flexGrow: split[status], background: STATUS_COLOUR[status] }} />
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {active.length > list.length ? <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">{t("villagesMore", { count: active.length - list.length })}</p> : null}
    </div>
  );
}
