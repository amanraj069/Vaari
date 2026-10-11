"use client";

/**
 * PaginationBar: previous / next under a long list, with where you are ("21–40 of 87") as words. It
 * renders nothing when the list fits on one page, so short lists look exactly as before. Changing the
 * page brings the top of the list back into view (the buttons sit under it), without a jump when
 * the person prefers reduced motion.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Pagination } from "@/lib/use-pagination";
import { Button } from "./ui";

export function PaginationBar<Item>({ pagination, listId, className = "" }: { pagination: Pagination<Item>; listId?: string; className?: string }) {
  const t = useTranslations("common");
  if (pagination.pageCount <= 1) return null;

  function goTo(page: number) {
    pagination.setPage(page);
    const list = listId ? document.getElementById(listId) : null;
    if (list && list.getBoundingClientRect().top < 0) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      list.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  return (
    <nav aria-label={t("pagesLabel")} className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p aria-live="polite" className="text-xs text-ink-muted tabular">
        {t("pageRange", { first: pagination.firstShown, last: pagination.lastShown, total: pagination.total })}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="size-11 px-0" aria-label={t("pagePrevious")} disabled={pagination.page <= 1} onClick={() => goTo(pagination.page - 1)}>
          <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
        </Button>
        <span className="min-w-[6.5rem] text-center text-sm tabular">{t("pageOf", { page: pagination.page, pages: pagination.pageCount })}</span>
        <Button variant="secondary" className="size-11 px-0" aria-label={t("pageNext")} disabled={pagination.page >= pagination.pageCount} onClick={() => goTo(pagination.page + 1)}>
          <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
        </Button>
      </div>
    </nav>
  );
}
