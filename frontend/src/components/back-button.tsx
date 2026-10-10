"use client";

/**
 * "Back", a plain "<" beside a page title (PageHeader's `back`): returns to the page the farmer came from inside Vaari. Someone who opened this page
 * directly (a WhatsApp link, a bookmark, a new tab) has no such page, so they go to `fallback`
 * instead of leaving the site. The Navigation API knows whether a same-site page is behind this one;
 * browsers without it fall back on the history length.
 */
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function BackButton({ fallback }: { fallback: string }) {
  const t = useTranslations("common");
  const router = useRouter();

  function goBack() {
    const navigation = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
    const canGoBack = navigation?.canGoBack ?? window.history.length > 1;
    if (canGoBack) router.back();
    else router.push(fallback);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t("back")}
      title={t("back")}
      // A bare chevron: no border or fill. The 44px target reaches past it to the left, so the glyph
      // lines up with the page's edge.
      className="-ml-3 grid size-11 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <ChevronLeft aria-hidden className="size-7" strokeWidth={1.75} />
    </button>
  );
}
