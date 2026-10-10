"use client";

/**
 * /dashboard/queue: every open field of the centre, least slack first, as a working table. The
 * filter row counts the fields by risk (one place, not a second row of cards); a search finds a
 * farmer, village or token number. Each row: token, farmer and village, acres, the fuse from harvest-ready to the last
 * waiting day with the planned day pinned on it, the planned day, and the days to spare. Risk is
 * always an icon and a word.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleDashed, Clock3, List, ShieldCheck, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { queueItemSchema, type Risk } from "@/shared";
import { DashHeader, Panel, SearchBox, Segmented } from "@/components/dashboard/kit";
import { FuseBar } from "@/components/fuse-bar";
import { Button, Pill, Skeleton, StateMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";

const queueSchema = z.object({ today: z.string(), items: z.array(queueItemSchema) });
const RISKS: { risk: Risk; icon: LucideIcon }[] = [
  { risk: "at_risk", icon: AlertTriangle },
  { risk: "tight", icon: Clock3 },
  { risk: "safe", icon: ShieldCheck },
  { risk: "unplanned", icon: CircleDashed },
];

export function OperatorQueueView() {
  const t = useTranslations("queue");
  const ts = useTranslations("schedule");
  const tr = useTranslations("risk");
  const tc = useTranslations("common");
  const dates = useDates();
  const [filter, setFilter] = useState<Risk | "all">("all");
  const [search, setSearch] = useState("");
  const queue = useQuery({ queryKey: ["operator-queue"], queryFn: () => api("operator/queue", queueSchema), refetchInterval: 5_000 });
  const all = queue.data?.items ?? [];
  const countOf = (risk: Risk) => all.filter((item) => item.risk === risk).length;
  const needle = search.trim().toLowerCase().replace(/^#/, "");
  const items = all
    .filter((item) => filter === "all" || item.risk === filter)
    .filter((item) => !needle || item.farmerName.toLowerCase().includes(needle) || item.villageName.toLowerCase().includes(needle) || String(item.token).padStart(3, "0").includes(needle));

  return (
    <>
      <DashHeader title={t("title")} />

      <Panel className="mt-6" bodyClassName="">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <SearchBox label={ts("searchFields")} value={search} onChange={setSearch} />
          <Segmented
            label={t("filterLabel")}
            value={filter}
            onChange={setFilter}
            options={[{ value: "all" as const, label: t("all"), count: all.length, icon: List }, ...RISKS.map(({ risk, icon }) => ({ value: risk, label: tr(risk), count: countOf(risk), icon }))]}
          />
        </div>
        {queue.isPending ? (
          <div className="p-4">
            <Skeleton className="h-80" />
          </div>
        ) : queue.isError ? (
          <div className="p-4">
            <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => queue.refetch()}>{tc("retry")}</Button>} />
          </div>
        ) : items.length === 0 ? (
          <p className="p-6 text-ink-muted">{needle ? ts("noMatch") : t("empty")}</p>
        ) : (
          <>
            <div className="hidden grid-cols-[4rem_minmax(0,14rem)_4.5rem_minmax(0,1fr)_7.5rem_7rem] gap-4 border-b border-line px-5 py-2.5 text-xs text-ink-muted md:grid">
              <span>{ts("colToken")}</span>
              <span>{ts("colFarmer")}</span>
              <span>{ts("colAcres")}</span>
              <span>{ts("colFuse")}</span>
              <span>{t("planned")}</span>
              <span className="text-right">{ts("colRisk")}</span>
            </div>
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.fieldId} className="grid grid-cols-1 gap-3 px-5 py-3.5 md:grid-cols-[4rem_minmax(0,14rem)_4.5rem_minmax(0,1fr)_7.5rem_7rem] md:items-center md:gap-4">
                  <span className="font-mono text-sm text-ink-muted">#{String(item.token).padStart(3, "0")}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.farmerName}</span>
                    <span className="block truncate text-sm text-ink-muted">{item.villageName}</span>
                  </span>
                  <span className="text-sm tabular">{tc("acres", { acres: item.acres })}</span>
                  <FuseBar readyDate={item.readyDate} deadlineDate={item.burnDeadlineDate} plannedDate={item.plannedDate} today={queue.data.today} />
                  <span className="text-sm tabular">{item.plannedDate ? dates.short(item.plannedDate) : <span className="text-ink-muted">{tr("unplanned")}</span>}</span>
                  <span className="flex flex-col items-start gap-1 md:items-end">
                    <Pill kind={item.risk}>{tr(item.risk)}</Pill>
                    {item.slackDays !== null ? (
                      <span className="text-xs text-ink-muted tabular">{item.slackDays >= 0 ? t("spare", { count: item.slackDays }) : t("late", { count: -item.slackDays })}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">{ts("showing", { shown: items.length, total: all.length })}</p>
          </>
        )}
      </Panel>
    </>
  );
}
