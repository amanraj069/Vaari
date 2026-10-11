"use client";

/**
 * BookedList: the fields this facilitator booked, newest status first. Each row shows the farmer on
 * the left; on the right, the status badges at the top (the promise, only a promised date, never a
 * planned one, with icon + word) and under them a button to copy the farmer's slot link again and
 * one to give the farmer a new link (after a confirmation: the old link stops working at once).
 * With `pageSize`, a long list is drawn a page at a time (a helper's bookings add up over seasons).
 */
import { Copy, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { QueueItem } from "@/shared";
import { useDates } from "@/lib/dates";
import { usePagination } from "@/lib/use-pagination";
import { ChangeBooking } from "./change-booking";
import { Dialog } from "./dialog";
import { PaginationBar } from "./pagination";
import { Button, Pill, Skeleton, Spinner, StateMessage } from "./ui";

export type BookedListState = { kind: "loading" } | { kind: "error"; onRetry: () => void } | { kind: "ready"; items: QueueItem[] };
const NO_ITEMS: QueueItem[] = [];

export function StatusBadges({ item, align = "start" }: { item: QueueItem; align?: "start" | "end" }) {
  const tf = useTranslations("farmer");
  const tr = useTranslations("risk");
  const dates = useDates();
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${align === "end" ? "justify-end" : ""}`}>
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

export function BookedList({
  state,
  onCopyLink,
  onReissueLink,
  onChanged,
  today = null,
  bare = false,
  pageSize,
  resetKey,
}: {
  state: BookedListState;
  /** Inside a dashboard panel: no heading of its own and no outer border (the panel has both). */
  bare?: boolean;
  onCopyLink: (item: QueueItem) => void;
  /** Makes a new slot link (the old one stops working). Resolves when the new link is copied. */
  onReissueLink?: (item: QueueItem) => Promise<void>;
  /** The booking's harvest moved or it was cancelled (the "change booking" dialog): refresh the list. */
  onChanged?: () => void;
  today?: string | null;
  /** Rows per page; without it every row is shown. */
  pageSize?: number;
  /** Changes when the search or filter above the list changes: back to the first page. */
  resetKey?: string;
}) {
  const t = useTranslations("book");
  const tc = useTranslations("common");
  const listId = useId();
  const [reissuing, setReissuing] = useState<QueueItem | null>(null);
  const [reissueState, setReissueState] = useState<"idle" | "working" | "failed">("idle");
  const allItems = state.kind === "ready" ? state.items : NO_ITEMS;
  const pagination = usePagination(allItems, { pageSize: pageSize ?? Math.max(1, allItems.length), resetKey });

  async function confirmReissue() {
    if (!reissuing || !onReissueLink) return;
    setReissueState("working");
    try {
      await onReissueLink(reissuing);
      setReissueState("idle");
      setReissuing(null);
    } catch {
      setReissueState("failed");
    }
  }

  return (
    // Bare: the panel around it is the region (and names it), so this is a plain container.
    <section aria-labelledby={bare ? undefined : "booked-title"} role={bare ? "presentation" : undefined}>
      {bare ? null : <h2 id="booked-title" className="font-display text-2xl">{t("listTitle")}</h2>}
      {state.kind === "loading" ? (
        <div className={`${bare ? "p-4" : "mt-4"} space-y-3`}>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : state.kind === "error" ? (
        <div className={bare ? "p-4" : "mt-4"}>
          <StateMessage tone="error" title={t("listError")} action={<Button onClick={state.onRetry}>{tc("retry")}</Button>} />
        </div>
      ) : state.items.length === 0 ? (
        <div className={bare ? "p-4" : "mt-4"}>
          <StateMessage title={t("listEmpty")} body={t("listEmptyBody")} />
        </div>
      ) : (
        <>
          <ul id={listId} className={bare ? "scroll-mt-4 divide-y divide-line" : "mt-4 scroll-mt-4 divide-y divide-line rounded-card border border-line bg-surface"}>
            {pagination.pageItems.map((item) => (
              // Who and where on the left; on the right, the status at the top and the actions under it.
              <li key={item.fieldId} className={`flex items-start gap-3 py-3 ${bare ? "px-5" : "px-4"}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    <span className="font-medium tabular">#{String(item.token).padStart(3, "0")}</span> {item.farmerName}
                  </p>
                  <p className="truncate text-sm text-ink-muted">
                    {item.villageName} · {tc("acres", { acres: item.acres })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <StatusBadges item={item} align="end" />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onCopyLink(item)}
                      aria-label={t("copyLinkFor", { name: item.farmerName })}
                      className="grid size-11 shrink-0 place-items-center rounded-control border border-line-strong text-ink hover:border-ink/50"
                    >
                      <Copy aria-hidden className="size-5" strokeWidth={1.75} />
                    </button>
                    {onReissueLink ? (
                      <button
                        type="button"
                        onClick={() => {
                          setReissueState("idle");
                          setReissuing(item);
                        }}
                        aria-label={t("reissueFor", { name: item.farmerName })}
                        className="grid size-11 shrink-0 place-items-center rounded-control border border-line-strong text-ink hover:border-ink/50"
                      >
                        <RefreshCw aria-hidden className="size-5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                    {onChanged ? <ChangeBooking compact base={`fields/${item.fieldId}`} readyDate={item.readyDate} today={today} label={item.farmerName} onDone={onChanged} /> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <PaginationBar pagination={pagination} listId={listId} className={bare ? "border-t border-line px-5 py-3" : "mt-3"} />
        </>
      )}
      <Dialog
        open={reissuing !== null}
        onClose={() => setReissuing(null)}
        title={t("reissueTitle", { name: reissuing?.farmerName ?? "" })}
        description={t("reissueBody")}
        closeLabel={tc("close")}
        footer={
          <Button variant="accent" className="min-h-12" disabled={reissueState === "working"} onClick={confirmReissue}>
            {reissueState === "working" ? <Spinner label={t("reissueConfirm")} /> : t("reissueConfirm")}
          </Button>
        }
      >
        {reissueState === "failed" ? (
          <p role="alert" className="text-ember-deep">
            {t("reissueFailed")}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
