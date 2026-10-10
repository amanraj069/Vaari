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
 */
export function GlobalFooter({ contactEmail }: { contactEmail: string }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  // The credits were first written for the landing page's footer.
  const tl = useTranslations("landing");
  const pathname = usePathname();
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return null;

  return (
    <footer className="footer-weave mt-auto pb-8">
      {/* A phulkari border marks where the page ends and the footer begins. */}
      <div aria-hidden className="ornament-band mt-1" />
      <div className={`${PAGE_FRAME} grid gap-12 pt-16 lg:grid-cols-4`}>
        {/* Brand & Tagline */}
        <div className="flex flex-col gap-4 lg:col-span-1">
          <BrandMark />
          <p className="mt-2 text-base text-ink-muted max-w-sm">
            {tl("heroMeaning")}
          </p>
          <div className="flex items-center gap-4 mt-2 text-ink-muted">
            <a href="https://github.com/amanraj069/Vaari" aria-label={tc("githubLabel")} className="hover:text-ink transition-colors">
              <Github className="size-5" strokeWidth={1.5} />
            </a>
            <a href={`mailto:${contactEmail}`} aria-label={tc("contactLabel")} className="hover:text-ink transition-colors">
              <Mail className="size-5" strokeWidth={1.5} />
            </a>
          </div>
        </div>

        {/* Expanded Navigation Links */}
        <div className="grid grid-cols-2 md:flex md:justify-between gap-8 lg:col-span-3 mt-4 lg:mt-0">
          {/* For farmers (no account: their fields open from a WhatsApp link) and for the helpers who book */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">{t("footerFarmers")}</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><Link href="/dashboard" className="hover:text-ink transition-colors">{t("myFields")}</Link></li>
              <li><Link href="/dashboard/book" className="hover:text-ink transition-colors">{t("book")}</Link></li>
            </ul>
          </div>

          {/* For Operators */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">{t("footerOperators")}</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><Link href="/dashboard/plan" className="hover:text-ink transition-colors">{t("plan")}</Link></li>
              <li><Link href="/dashboard/queue" className="hover:text-ink transition-colors">{t("queue")}</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">{t("footerResources")}</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><Link href="/#problem" className="hover:text-ink transition-colors">{t("problem")}</Link></li>
              <li><Link href="/#how" className="hover:text-ink transition-colors">{t("how")}</Link></li>
              <li><Link href="/proof" className="hover:text-ink transition-colors">{t("proof")}</Link></li>
              <li><Link href="/privacy" className="hover:text-ink transition-colors">{t("privacy")}</Link></li>
            </ul>
          </div>

        </div>
      </div>

      <div className={`mt-16 pt-8 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm text-ink-muted ${PAGE_FRAME}`}>
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
