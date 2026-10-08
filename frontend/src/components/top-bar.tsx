"use client";

/**
 * One top bar for every page. Left: the mark and the links for whoever is signed in (operator:
 * Plan, Queue; farmer: My fields, Ask for a date; visitors: See the proof). Right: three
 * same-size controls, language, theme and the account menu (or Sign in). On phones the links
 * drop to a second row so nothing is squeezed.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "@/lib/use-session";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { LanguageMenu } from "./language-menu";
import { ThemeToggle } from "./theme-toggle";

type NavLink = { href: string; label: string };

export function TopBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const session = useSession();
  const me = session.data ?? null;

  let links: NavLink[] = [];
  if (me?.role === "operator" && !me.needsOnboarding) {
    links = [
      { href: "/operator", label: t("plan") },
      { href: "/operator/queue", label: t("queue") },
    ];
  } else if ((me?.role === "farmer" || me?.role === "facilitator") && !me.needsOnboarding) {
    links = [
      { href: "/farmer", label: t("myFields") },
      { href: "/farmer/request", label: t("askDate") },
    ];
  } else if (!me && !session.isPending) {
    links = [{ href: "/proof", label: t("proof") }];
  }

  return (
    <header className="border-b border-line bg-paper/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:gap-x-10 sm:px-6 sm:py-4">
        <BrandMark />
        <nav aria-label={t("mainNav")} className="order-last -mx-1 flex w-full items-center gap-1.5 sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-control px-3.5 text-sm ${active ? "bg-ink/5 font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LanguageMenu />
          <ThemeToggle />
          {session.isPending ? (
            <span aria-hidden className="size-10 animate-pulse rounded-full bg-line/70" />
          ) : me ? (
            <AccountMenu me={me} />
          ) : pathname !== "/signin" ? (
            <Link href="/signin" className="inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-5 text-sm font-medium hover:border-ink/50">
              {t("signIn")}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
