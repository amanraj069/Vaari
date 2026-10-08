"use client";

/** Every field as a fuse, least slack first, with a risk filter. Risk is an icon plus a word. */
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { queueItemSchema, type Risk } from "@/shared";
import { FuseBar } from "@/components/fuse-bar";
import { SimulatedBadge } from "@/components/simulated-badge";
import { TopBar } from "@/components/top-bar";
import { Button, Pill, Skeleton, StateMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";

const queueSchema = z.object({ today: z.string(), items: z.array(queueItemSchema) });
const FILTERS: (Risk | "all")[] = ["all", "at_risk", "tight", "safe", "unplanned"];

export default function OperatorQueuePage() {
  const t = useTranslations("queue");
  const tr = useTranslations("risk");
  const tc = useTranslations("common");
  const dates = useDates();
  const [filter, setFilter] = useState<Risk | "all">("all");
  const queue = useQuery({ queryKey: ["operator-queue"], queryFn: () => api("operator/queue", queueSchema), refetchInterval: 5_000 });
  const items = (queue.data?.items ?? []).filter((item) => filter === "all" || item.risk === filter);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl">{t("title")}</h1>
          {queue.data ? <SimulatedBadge demoDate={dates.short(queue.data.today)} /> : null}
        </div>
        <p className="mt-2 max-w-2xl text-ink-muted">{t("subtitle")}</p>
        <div role="group" className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`min-h-9 rounded-full border px-3 text-sm ${filter === option ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface"}`}
            >
              {option === "all" ? t("all") : tr(option)}
              {queue.data ? <span className="ml-1.5 opacity-70 tabular">{queue.data.items.filter((item) => option === "all" || item.risk === option).length}</span> : null}
            </button>
          ))}
        </div>
        {queue.isPending ? (
          <Skeleton className="mt-6 h-96" />
        ) : queue.isError ? (
          <div className="mt-6">
            <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => queue.refetch()}>{tc("retry")}</Button>} />
          </div>
        ) : items.length === 0 ? (
          <p className="mt-6 text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-5 divide-y divide-line rounded-card border border-line bg-surface">
            {items.map((item) => (
              <li key={item.fieldId} className="grid gap-3 px-4 py-3 md:grid-cols-[16rem_1fr_11rem] md:items-center">
                <div className="text-sm">
                  <p>
                    <span className="font-medium tabular">#{String(item.token).padStart(3, "0")}</span> {item.farmerName}
                  </p>
                  <p className="text-ink-muted">
                    {item.villageName} · {tc("acres", { acres: item.acres })}
                  </p>
                </div>
                <FuseBar readyDate={item.readyDate} deadlineDate={item.burnDeadlineDate} plannedDate={item.plannedDate} today={queue.data.today} />
                <div className="flex flex-col items-start gap-1 text-sm md:items-end">
                  <Pill kind={item.risk}>{tr(item.risk)}</Pill>
                  {item.slackDays !== null ? (
                    <span className="text-ink-muted tabular">{item.slackDays >= 0 ? t("spare", { count: item.slackDays }) : t("late", { count: -item.slackDays })}</span>
                  ) : null}
                  {item.plannedDate ? <span className="tabular">{t("planned")}: {dates.short(item.plannedDate)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
