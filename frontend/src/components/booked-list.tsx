"use client";

/**
 * BookedList: the fields this facilitator booked, newest status first. Each row shows the farmer,
 * the promise (only a promised date, never a planned one), status badges with icon + word, and a
 * button to copy the farmer's slot link again.
 */
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QueueItem } from "@/shared";
import { useDates } from "@/lib/dates";
import { Button, Pill, Skeleton, StateMessage } from "./ui";

export type BookedListState = { kind: "loading" } | { kind: "error"; onRetry: () => void } | { kind: "ready"; items: QueueItem[] };

export function StatusBadges({ item }: { item: QueueItem }) {
  const tf = useTranslations("farmer");
  const tr = useTranslations("risk");
  const dates = useDates();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {item.promise?.kind === "firm" ? (
        <Pill kind="firm">
          {tf("firm")} · <span className="tabular">{dates.short(item.promise.date)}</span>
        </Pill>
      ) : item.promise?.kind === "window" ? (
        <Pill kind="window">
          {tf("window")} · <span className="tabular">{dates.range(item.promise.startDate, item.promise.endDate)}</span>
        </Pill>
      ) : (
        <Pill kind="unplanned">{tf("noDate")}</Pill>
      )}
      {item.risk === "at_risk" ? <Pill kind="at_risk">{tr("at_risk")}</Pill> : item.risk === "tight" ? <Pill kind="tight">{tr("tight")}</Pill> : null}
    </span>
  );
}

export function BookedList({ state, onCopyLink }: { state: BookedListState; onCopyLink: (item: QueueItem) => void }) {
  const t = useTranslations("book");
  const tc = useTranslations("common");
  return (
    <section aria-labelledby="booked-title">
      <h2 id="booked-title" className="font-display text-2xl">{t("listTitle")}</h2>
      {state.kind === "loading" ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : state.kind === "error" ? (
        <div className="mt-4">
          <StateMessage tone="error" title={t("listError")} action={<Button onClick={state.onRetry}>{tc("retry")}</Button>} />
        </div>
      ) : state.items.length === 0 ? (
        <div className="mt-4">
          <StateMessage title={t("listEmpty")} body={t("listEmptyBody")} />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
          {state.items.map((item) => (
            <li key={item.fieldId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium tabular">#{String(item.token).padStart(3, "0")}</span> {item.farmerName}
                </p>
                <p className="truncate text-sm text-ink-muted">
                  {item.villageName} · {tc("acres", { acres: item.acres })}
                </p>
                <div className="mt-1.5">
                  <StatusBadges item={item} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCopyLink(item)}
                aria-label={t("copyLinkFor", { name: item.farmerName })}
                className="grid size-11 shrink-0 place-items-center rounded-control border border-line-strong text-ink hover:border-ink/50"
              >
                <Copy aria-hidden className="size-5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
