"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Github, Twitter, Mail } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { PAGE_FRAME } from "./page-shell";

export function GlobalFooter() {
  const t = useTranslations("nav");
  // We'll reuse the landing translations for the credits, 
  // since they were originally in the landing footer.
  const tl = useTranslations("landing"); 

  return (
    <footer className="mt-auto border-t border-line bg-surface/50 pt-16 pb-8">
      <div className={`${PAGE_FRAME} grid gap-12 lg:grid-cols-4`}>
        {/* Brand & Tagline */}
        <div className="flex flex-col gap-4 lg:col-span-1">
          <BrandMark />
          <p className="mt-2 text-base text-ink-muted max-w-sm">
            {tl("heroMeaning")}
          </p>
          <div className="flex items-center gap-4 mt-2 text-ink-muted">
            <a href="https://github.com/amanraj069/Vaari" aria-label="GitHub" className="hover:text-ink transition-colors">
              <Github className="size-5" strokeWidth={1.5} />
            </a>
            <a href="mailto:amanraj3567@gmail.com" aria-label="Contact" className="hover:text-ink transition-colors">
              <Mail className="size-5" strokeWidth={1.5} />
            </a>
          </div>
        </div>

        {/* Expanded Navigation Links */}
        <div className="grid grid-cols-2 md:flex md:justify-between gap-8 lg:col-span-3 mt-4 lg:mt-0">
          {/* For Farmers */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">For Farmers</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><Link href="/farmer" className="hover:text-ink transition-colors">{t("myFields")}</Link></li>
              <li><Link href="/book" className="hover:text-ink transition-colors">{t("askDate")}</Link></li>
            </ul>
          </div>
          
          {/* For Operators */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">For Operators</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><Link href="/operator" className="hover:text-ink transition-colors">{t("plan")}</Link></li>
              <li><Link href="/operator/queue" className="hover:text-ink transition-colors">{t("queue")}</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">Resources</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><Link href="/#problem" className="hover:text-ink transition-colors">{t("problem")}</Link></li>
              <li><Link href="/#how" className="hover:text-ink transition-colors">{t("how")}</Link></li>
              <li><Link href="/proof" className="hover:text-ink transition-colors">{t("proof")}</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-display text-lg font-medium mb-4 text-wheat-deep">Legal</h3>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              <li><a href="#" className="hover:text-ink transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-ink transition-colors">Terms of Service</a></li>
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
          &copy; {new Date().getFullYear()} Vaari. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
