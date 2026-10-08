"use client";

/**
 * One top bar for every page. Left: the mark and the links for whoever is signed in (operator:
 * Plan, Queue; farmer: My fields, Ask for a date; visitors: See the proof). Right: three
 * same-size controls, language, theme and the account menu (or Sign in). On phones the links
 * drop to a second row so nothing is squeezed. With `overlay` (the landing page) it sits
 * transparent on top of the hero photo and visitors get section links.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "@/lib/use-session";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { LanguageMenu } from "./language-menu";
import { PAGE_FRAME } from "./page-shell";
import { ThemeToggle } from "./theme-toggle";

// wideOnly: hidden on phones, where the in-page section links would not fit on one row.
type NavLink = { href: string; label: string; wideOnly?: boolean };

export function TopBar({ overlay = false }: { overlay?: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const session = useSession();
  const me = session.data ?? null;

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  let links: NavLink[] = [];
  if (me?.role === "operator" && !me.needsOnboarding) {
    links = [
      { href: "/operator", label: t("today") },
      { href: "/operator/plan", label: t("plan") },
      { href: "/operator/queue", label: t("queue") },
    ];
  } else if (me?.role === "facilitator" && !me.needsOnboarding) {
    // Facilitators book for farmers; no operator or officer pages.
    links = [{ href: "/book", label: t("book") }];
  } else if (me?.role === "farmer" && !me.needsOnboarding) {
    links = [
      { href: "/farmer", label: t("myFields") },
      { href: "/farmer/request", label: t("askDate") },
    ];
  } else if (!me && !session.isPending && !session.isError) {
    links = overlay
      ? [
          { href: "#problem", label: t("problem"), wideOnly: true },
          { href: "#how", label: t("how"), wideOnly: true },
          { href: "/proof", label: t("proof") },
        ]
      : [{ href: "/proof", label: t("proof") }];
  }

  const innerContent = (
    <>
      <BrandMark />
      <nav aria-label={t("mainNav")} className="order-last -mx-1 flex w-full items-center gap-1.5 sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`${link.wideOnly ? "hidden sm:inline-flex" : "inline-flex"} min-h-11 items-center rounded-control px-3.5 text-sm ${active ? "font-medium text-wheat-deep" : "text-ink-muted hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1 sm:gap-3">
        <LanguageMenu />
        <ThemeToggle />
        {session.isPending || (session.isError && !me) ? (
          <span aria-hidden className="size-11 animate-pulse rounded-full bg-line/70" />
        ) : me ? (
          <AccountMenu me={me} />
        ) : pathname !== "/signin" ? (
          <Link href="/signin" className="ml-1 inline-flex h-11 items-center whitespace-nowrap rounded-full border border-line-strong bg-surface px-4 text-sm font-medium hover:border-ink/50 sm:ml-0 sm:px-5">
            {t("signIn")}
          </Link>
        ) : null}
      </div>
    </>
  );

  if (overlay) {
    return (
      <div className={`fixed inset-x-0 top-3 z-40 pointer-events-none ${PAGE_FRAME}`}>
        <header className={`hero-nav pointer-events-auto transition-colors duration-500 rounded-full sm:-ml-6 sm:-mr-3 ${scrolled ? 'bg-paper/80 backdrop-blur-lg border border-line/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)]' : 'bg-transparent border border-transparent'}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-4 pr-2 sm:pl-6 sm:pr-3 sm:gap-x-10">
            {innerContent}
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={`sticky top-3 z-40 pointer-events-none ${PAGE_FRAME}`}>
      <header className="pointer-events-auto transition-colors duration-500 rounded-full sm:-ml-6 sm:-mr-3 bg-surface border border-line shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-4 pr-2 sm:pl-6 sm:pr-3 sm:gap-x-10">
          {innerContent}
        </div>
      </header>
    </div>
  );
}
