"use client";

/**
 * The top bar of every public page (landing, proof, sign-in, privacy). Left: the mark and the same
 * links for everyone who is signed in, whatever their role: Dashboard and the proof (their own
 * pages live in the dashboard's sidebar, and in the account menu). Visitors get the proof (and, on
 * the landing page, its sections). Right: three same-size controls, language, theme and the
 * account menu (or Sign in). On phones the bar is always one row: the links move into a Menu button
 * at its right end (none on sign-in pages, where the task is the form). With
 * `overlay` (the landing page) it sits transparent on top of the hero photo.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "@/lib/use-session";
import { Menu } from "lucide-react";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { Dropdown, MENU_ITEM_CLASS } from "./dropdown";
import { LanguageMenu } from "./language-menu";
import { PAGE_FRAME } from "./page-shell";
import { ThemeToggle } from "./theme-toggle";

type NavLink = { href: string; label: string };

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
  if (me) {
    // Signed in (staff or a farmer's phone session): one way to their dashboard, the same for every role.
    const ready = me.kind === "farmer" || (!me.me.needsOnboarding && Boolean(me.me.role));
    links = ready ? [{ href: "/dashboard", label: t("dashboard") }, { href: "/proof", label: t("proof") }] : [{ href: "/proof", label: t("proof") }];
  } else if (!session.isPending && !session.isError) {
    links = overlay
      ? [
          { href: "#problem", label: t("problem") },
          { href: "#how", label: t("how") },
          { href: "/proof", label: t("proof") },
        ]
      : [{ href: "/proof", label: t("proof") }];
  }
  const onSignInPage = pathname === "/signin" || pathname.startsWith("/signin/") || pathname === "/farmer/signin";

  const innerContent = (
    <>
      <BrandMark />
      <nav aria-label={t("mainNav")} className="hidden min-w-0 items-center gap-1.5 sm:flex sm:flex-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-control px-3.5 text-sm ${active ? "font-medium text-wheat-deep" : "text-ink-muted hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-3">
        <LanguageMenu />
        <ThemeToggle />
        {session.isPending || (session.isError && !me) ? (
          <span aria-hidden className="size-11 animate-pulse rounded-full bg-line/70" />
        ) : me ? (
          <AccountMenu viewer={me} />
        ) : !onSignInPage ? (
          <Link href="/signin" className="ml-1 inline-flex h-11 items-center whitespace-nowrap rounded-full border border-line-strong bg-raised px-3.5 text-[13px] font-medium hover:border-ink/50 min-[380px]:px-4 min-[380px]:text-sm sm:ml-0 sm:px-5 shadow-control">
            {t("signIn")}
          </Link>
        ) : null}
        {/* Phones: the page links live in one menu, so the bar never wraps. */}
        {links.length > 0 && !onSignInPage ? (
          <Dropdown
            label={t("pageMenu")}
            className="sm:hidden"
            panelClassName="w-56"
            buttonClassName="grid size-11 place-items-center rounded-full text-ink hover:bg-ink/5 aria-expanded:bg-ink/5"
            buttonContent={<Menu aria-hidden className="size-5" strokeWidth={1.9} />}
          >
            {(close) =>
              links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  aria-current={pathname === link.href ? "page" : undefined}
                  onClick={close}
                  className={`${MENU_ITEM_CLASS} ${pathname === link.href ? "font-medium text-wheat-deep" : ""}`}
                >
                  {link.label}
                </Link>
              ))
            }
          </Dropdown>
        ) : null}
      </div>
    </>
  );

  if (overlay) {
    return (
      <div className={`fixed inset-x-0 top-3 z-40 pointer-events-none ${PAGE_FRAME}`}>
        <header className={`hero-nav pointer-events-auto transition-colors duration-500 rounded-full sm:-ml-6 sm:-mr-3 ${scrolled ? 'bg-paper/80 backdrop-blur-lg border border-line/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)]' : 'bg-transparent border border-transparent'}`}>
          <div className="flex items-center gap-x-2 py-2 pl-3.5 pr-1.5 sm:gap-x-10 sm:pl-6 sm:pr-3">
            {innerContent}
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={`sticky top-3 z-40 pointer-events-none ${PAGE_FRAME}`}>
      <header className="pointer-events-auto transition-colors duration-500 rounded-full sm:-ml-6 sm:-mr-3 bg-surface border border-line shadow-sm">
        <div className="flex items-center gap-x-2 py-2 pl-3.5 pr-1.5 sm:gap-x-10 sm:pl-6 sm:pr-3">
          {innerContent}
        </div>
      </header>
    </div>
  );
}
