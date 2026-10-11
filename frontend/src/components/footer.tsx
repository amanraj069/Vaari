"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Github, Mail } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { PAGE_FRAME } from "./page-shell";

/**
 * contactEmail comes from the server (CONTACT_EMAIL), the same address /privacy gives for deletion.
 * Public pages only: the dashboard is a workspace with its own slim footer (DashboardShell).
 * A farmer's own pages (a slot link, phone sign-in) end with one quiet line instead of the site's
 * directory: they arrive from WhatsApp to do one thing, and on a phone the full footer is longer
 * than the page itself.
 */
export function GlobalFooter({ contactEmail }: { contactEmail: string }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  // The credits were first written for the landing page's footer.
  const tl = useTranslations("landing");
  const pathname = usePathname();
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return null;
  if (pathname.startsWith("/slot/") || pathname.startsWith("/farmer/")) {
    return (
      <footer className="mt-auto border-t border-line">
        <div className={`${PAGE_FRAME} flex flex-col gap-1 py-4 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6`}>
          <p>{tc("simulatedLong")}</p>
          <Link href="/privacy" className="inline-flex min-h-11 shrink-0 items-center hover:text-ink">
            {t("privacy")}
          </Link>
        </div>
      </footer>
    );
  }

  return (
    <footer className="footer-weave mt-auto pb-8">
      {/* A phulkari border marks where the page ends and the footer begins. */}
      <div aria-hidden className="ornament-band mt-1" />
      <div className={`${PAGE_FRAME} grid gap-8 pt-10 sm:gap-12 sm:pt-16 lg:grid-cols-4`}>
        {/* Brand & Tagline */}
        <div className="flex flex-col gap-3 sm:gap-4 lg:col-span-1">
          <BrandMark />
          <p className="max-w-sm text-sm text-ink-muted sm:mt-2 sm:text-base">
            {tl("heroMeaning")}
          </p>
          <div className="-ml-3 flex items-center text-ink-muted sm:mt-1">
            <a href="https://github.com/amanraj069/Vaari" aria-label={tc("githubLabel")} className="grid size-11 place-items-center transition-colors hover:text-ink">
              <Github className="size-5" strokeWidth={1.5} />
            </a>
            <a href={`mailto:${contactEmail}`} aria-label={tc("contactLabel")} className="grid size-11 place-items-center transition-colors hover:text-ink">
              <Mail className="size-5" strokeWidth={1.5} />
            </a>
          </div>
        </div>

        {/* Expanded Navigation Links */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:gap-8 md:flex md:justify-between lg:col-span-3">
          {/* Dashboard links are never prefetched: a signed-out visitor's prefetch is answered with a
              redirect to sign-in, and Next would replay that cached redirect after they sign in. */}
          {/* For farmers (no account: their fields open from a WhatsApp link) and for the helpers who book */}
          <div>
            <h3 className="mb-1 font-display text-base font-medium text-wheat-deep sm:mb-3 sm:text-lg">{t("footerFarmers")}</h3>
            <ul className="flex flex-col text-sm text-ink-muted sm:gap-1">
              <li><Link href="/dashboard" prefetch={false} className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("myFields")}</Link></li>
              <li><Link href="/dashboard/book" prefetch={false} className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("book")}</Link></li>
            </ul>
          </div>

          {/* For Operators */}
          <div>
            <h3 className="mb-1 font-display text-base font-medium text-wheat-deep sm:mb-3 sm:text-lg">{t("footerOperators")}</h3>
            <ul className="flex flex-col text-sm text-ink-muted sm:gap-1">
              <li><Link href="/dashboard/plan" prefetch={false} className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("plan")}</Link></li>
              <li><Link href="/dashboard/queue" prefetch={false} className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("queue")}</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="mb-1 font-display text-base font-medium text-wheat-deep sm:mb-3 sm:text-lg">{t("footerResources")}</h3>
            <ul className="flex flex-col text-sm text-ink-muted sm:gap-1">
              <li><Link href="/#problem" className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("problem")}</Link></li>
              <li><Link href="/#how" className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("how")}</Link></li>
              <li><Link href="/proof" className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("proof")}</Link></li>
              <li><Link href="/privacy" className="inline-flex min-h-10 items-center transition-colors hover:text-ink">{t("privacy")}</Link></li>
            </ul>
          </div>

        </div>
      </div>

      <div className={`mt-10 flex flex-col justify-between gap-3 border-t border-line pt-6 text-xs text-ink-muted sm:mt-16 sm:flex-row sm:items-center sm:gap-4 sm:pt-8 sm:text-sm ${PAGE_FRAME}`}>
        <div className="flex flex-col gap-1.5">
          <p>{tl("footerPhotos")}</p>
          <p>{tl("footerCredits")}</p>
        </div>
        <p className="sm:text-right">
          {tc("copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
