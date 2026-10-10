"use client";

/**
 * The dashboard's frame, the same for every role: only the list of pages changes.
 * Laptop: a sidebar (the mark; a workspace card saying whose work this is: the machine centre,
 * the district office or the farmer; the pages; the account at its foot) that folds to icons and
 * remembers that in this browser, and a top bar over the page (where you are, the simulated
 * season's clock, language, theme). Phone: the same top bar with the account, and a bottom bar
 * with every page as a large tap target, so the farmer's two pages are one thumb away.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronsLeft, ChevronsRight, FlaskConical, LandPlot, Sprout, Tractor, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { operatorBoardSchema, publicSummarySchema, queueItemSchema } from "@/shared";
import type { DashboardRole } from "@/lib/dashboard-routes";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { dashboardRole, viewerName, type Viewer } from "@/lib/viewer-kind";
import { AccountMenu, useRoleLine } from "../account-menu";
import { BrandMark } from "../brand-mark";
import { LanguageMenu } from "../language-menu";
import { ThemeToggle } from "../theme-toggle";
import { SLIDE } from "./motion";
import { activeSection, navItems, type NavItem } from "./nav-items";

const COLLAPSED_KEY = "vaari.sidebar.collapsed";
const bookedFieldsSchema = z.object({ today: z.string(), items: z.array(queueItemSchema) });
const WORKSPACE_ICON = { operator: Tractor, facilitator: Users, officer: LandPlot, farmer: Sprout } as const;

type Badge = { text: string; label: string; tone: "risk" | "warn" | "neutral" };
const BADGE_TONE: Record<Badge["tone"], string> = {
  risk: "bg-ember-soft text-ember-deep",
  warn: "bg-wheat-soft text-wheat-deep",
  neutral: "bg-paper text-ink-muted ring-1 ring-inset ring-line",
};

function SidebarLink({ item, active, collapsed, badge }: { item: NavItem; active: boolean; collapsed: boolean; badge?: Badge | null }) {
  const t = useTranslations("dashboard");
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={`group relative flex min-h-11 items-center gap-3 rounded-control px-3 text-[14px] transition-colors duration-200 ${collapsed ? "justify-center" : ""} ${
          active ? "font-medium text-ink" : "text-ink-muted hover:bg-paper/70 hover:text-ink"
        }`}
      >
        {/* The current page's highlight glides to the new item instead of jumping. */}
        {active ? <motion.span layoutId="sidebar-current" transition={SLIDE} aria-hidden className="absolute inset-0 rounded-control bg-paper ring-1 ring-inset ring-line" /> : null}
        <Icon aria-hidden className={`relative size-[19px] shrink-0 transition-colors duration-200 ${active ? "text-wheat-deep" : "text-ink-muted group-hover:text-ink"}`} strokeWidth={2.1} />
        {collapsed ? <span className="sr-only">{label}</span> : <span className="relative min-w-0 flex-1 truncate">{label}</span>}
        {badge ? (
          collapsed ? (
            <span aria-hidden className={`absolute right-2 top-2 size-2 rounded-full ${badge.tone === "risk" ? "bg-ember" : badge.tone === "warn" ? "bg-wheat" : "bg-line-strong"}`} />
          ) : (
            <span aria-hidden className={`relative ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none tabular ${BADGE_TONE[badge.tone]}`}>{badge.text}</span>
          )
        ) : null}
        {badge ? <span className="sr-only">, {badge.label}</span> : null}
      </Link>
    </li>
  );
}

/**
 * Live counts beside the pages that need attention: the operator's Plan (a re-plan to approve, or
 * new requests with no date) and Queue (fields at burn risk or tight), the helper's Bookings. They
 * share the pages' own queries (same keys), so they cost no extra requests on those pages.
 */
function useNavBadges(role: DashboardRole | null): Partial<Record<NavItem["section"], Badge | null>> {
  const t = useTranslations("dashboard");
  const board = useQuery({ queryKey: ["operator-board"], queryFn: () => api("operator/board", operatorBoardSchema), enabled: role === "operator", refetchInterval: 15_000, staleTime: 5_000 });
  const booked = useQuery({ queryKey: ["facilitator-fields"], queryFn: () => api("facilitator/fields", bookedFieldsSchema), enabled: role === "facilitator", refetchInterval: 30_000, staleTime: 5_000 });
  if (role === "operator" && board.data) {
    const { draft, newRequests, counts, riskCounts } = board.data;
    const watch = riskCounts.at_risk + riskCounts.tight;
    return {
      plan: draft ? { text: t("badgeReview"), label: t("badgeReviewLabel"), tone: "warn" } : newRequests > 0 ? { text: String(newRequests), label: t("badgeNewLabel", { count: newRequests }), tone: "warn" } : null,
      queue: watch > 0 ? { text: String(watch), label: t("badgeWatchLabel", { count: watch }), tone: counts.burnRisk > 0 ? "risk" : "warn" } : null,
    };
  }
  if (role === "facilitator" && booked.data && booked.data.items.length > 0) {
    return { home: { text: String(booked.data.items.length), label: t("badgeBookedLabel", { count: booked.data.items.length }), tone: "neutral" } };
  }
  return {};
}

/** The simulated season's date (DATE_TODAY, fixed), on every dashboard page: simulated is labelled. */
function SeasonClock() {
  const t = useTranslations("dashboard");
  const dates = useDates();
  const summary = useQuery({ queryKey: ["public-summary"], queryFn: () => api("public/summary", publicSummarySchema, {}, { redirectOn401: false }), staleTime: 60_000 });
  return (
    <span title={t("clockHint")} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-ink-muted/45 px-3 text-xs text-ink-muted">
      <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
      <span className="hidden sm:inline">{t("clockSimulated")}</span>
      {summary.data ? <span className="tabular sm:before:content-['·_']">{dates.short(summary.data.today)}</span> : null}
    </span>
  );
}

export function DashboardShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const role = dashboardRole(viewer);
  const items = role ? navItems(role) : [];
  const current = activeSection(pathname);
  const currentItem = items.find((item) => item.section === current) ?? null;
  const roleLine = useRoleLine(viewer);
  const badges = useNavBadges(role);
  const [collapsed, setCollapsed] = useState(false);

  // Remembered per browser only (a convenience); storage can be blocked, so every access is guarded.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // No storage: start expanded.
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        // Not remembered; still toggles.
      }
      return !value;
    });
  }

  const main = items.filter((item) => item.group === "main");
  const more = items.filter((item) => item.group === "more");
  // The phone's bottom bar: the role's pages and the proof; the profile is in the account menu.
  const tabs = items.filter((item) => item.section !== "profile");
  const WorkspaceIcon = role ? WORKSPACE_ICON[role] : Tractor;
  const workspaceName =
    viewer.kind === "farmer" ? (viewerName(viewer) ?? t("farmerNoName")) : viewer.me.chcName ?? (viewer.me.role === "officer" ? t("officerWorkspace") : t("title"));

  return (
    <div className="dashboard-ui flex min-h-dvh">
      <a href="#dashboard-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        {t("skipToContent")}
      </a>

      {/* Laptop and tablet landscape: the sidebar. */}
      <aside
        aria-label={t("sidebarLabel")}
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${collapsed ? "w-[4.75rem]" : "w-[19.5rem]"}`}
      >
        <div className={`flex h-16 shrink-0 items-center border-b border-line ${collapsed ? "justify-center px-2" : "pl-6 pr-3"}`}>
          {collapsed ? <BrandMark compact /> : <BrandMark />}
        </div>

        {collapsed ? (
          <div className="flex justify-center pt-3">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={t("expandSidebar")}
              title={t("expandSidebar")}
              className="grid size-11 place-items-center rounded-chip text-ink-muted hover:bg-paper hover:text-ink"
            >
              <ChevronsRight aria-hidden className="size-[18px]" strokeWidth={2.1} />
            </button>
          </div>
        ) : (
          // The section's name, then whose workspace this is: plain type on the sidebar, not a box,
          // so nothing here looks like a button except the small collapse control.
          <div className="px-4 pt-6">
            {/* One left edge for the label, the centre and the pages below (px-3 inside px-4); the
                collapse control is a quiet icon at the same row's right edge, not a framed button. */}
            <div className="flex h-6 items-center justify-between px-3">
              <p className="eyebrow text-[11px] font-semibold leading-none text-ink-muted">{t("title")}</p>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={t("collapseSidebar")}
                title={t("collapseSidebar")}
                className="-my-2.5 -mr-2.5 grid size-11 place-items-center rounded-full text-ink-muted/70 transition-colors duration-200 hover:bg-paper hover:text-ink"
              >
                <ChevronsLeft aria-hidden className="size-4" strokeWidth={2.1} />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3 px-3 pb-5">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-control bg-wheat-soft text-wheat-deep">
                <WorkspaceIcon className="size-5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold leading-snug" title={workspaceName}>
                  {workspaceName}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{viewer.kind === "farmer" ? t("farmerWorkspace") : roleLine.split(" · ")[0]}</p>
              </div>
            </div>
            <div className="mx-3 border-t border-line" />
          </div>
        )}

        <nav aria-label={tn("mainNav")} className={`flex-1 overflow-y-auto pb-4 ${collapsed ? "px-2" : "px-4 pt-3"}`}>
          <ul className="space-y-1">
            {main.map((item) => (
              <SidebarLink key={item.section} item={item} active={current === item.section} collapsed={collapsed} badge={badges[item.section]} />
            ))}
          </ul>
          {more.length > 0 ? (
            <>
              <div className={`my-3 border-t border-line ${collapsed ? "mx-2" : "mx-3"}`} />
              <ul className="space-y-1">
                {more.map((item) => (
                  <SidebarLink key={item.section} item={item} active={current === item.section} collapsed={collapsed} badge={badges[item.section]} />
                ))}
              </ul>
            </>
          ) : null}
        </nav>

        <div className={`shrink-0 ${collapsed ? "border-t border-line px-2 py-3" : "p-4"}`}>
          <AccountMenu viewer={viewer} trigger="card" collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-[86rem] items-center gap-2 pl-4 pr-2 sm:pl-6 lg:px-10">
            <div className="lg:hidden">
              <BrandMark compact />
            </div>
            <p className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
              <span className="text-ink-muted">{t("title")}</span>
              {currentItem ? (
                <>
                  <span aria-hidden className="text-ink-muted/60">
                    /
                  </span>
                  <span className="truncate font-medium">{t(currentItem.labelKey)}</span>
                </>
              ) : null}
            </p>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <SeasonClock />
              <LanguageMenu />
              <ThemeToggle />
              <div className="lg:hidden">
                <AccountMenu viewer={viewer} />
              </div>
            </div>
          </div>
        </header>

        <main id="dashboard-main" tabIndex={-1} className="mx-auto w-full max-w-[86rem] flex-1 px-4 pb-32 pt-6 outline-none sm:px-6 sm:pt-8 lg:px-10 lg:pb-14">
          {children}
        </main>

        <footer className="mx-auto hidden w-full max-w-[86rem] flex-wrap items-center justify-between gap-3 px-10 pb-6 text-xs text-ink-muted lg:flex">
          <p>{tc("simulatedLong")}</p>
          <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-ink">
            {tn("privacy")}
          </Link>
        </footer>

        {tabs.length > 0 ? (
          <nav aria-label={t("bottomNavLabel")} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            <ul className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
              {tabs.map((item) => {
                const Icon = item.icon;
                const active = current === item.section;
                return (
                  <li key={item.section}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs leading-tight ${active ? "font-medium text-ink" : "text-ink-muted"}`}
                    >
                      <span aria-hidden className={`relative grid h-7 w-12 place-items-center rounded-full transition-colors duration-200 ${active ? "text-wheat-deep" : ""}`}>
                        {active ? <motion.span layoutId="tab-current" transition={SLIDE} className="absolute inset-0 rounded-full bg-wheat-soft" /> : null}
                        <Icon className="relative size-5" strokeWidth={2.1} />
                      </span>
                      <span className="line-clamp-2">{t(item.labelKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
