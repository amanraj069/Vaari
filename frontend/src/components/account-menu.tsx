"use client";

/**
 * The signed-in person's menu, the same on every page: who they are (name, role, centre, demo
 * label), then the pages of their dashboard they can open (operator: Today, Plan, Queue; helper:
 * Bookings, Book a field; officer: District; farmer: My fields, Book a field), the proof, their
 * profile and sign out. A new staff member who has not finished /welcome gets "Finish setting up".
 * `trigger="card"` is the sidebar's foot (avatar, name and role, opening upwards).
 */
import { ChevronRight, ChevronsUpDown, FlaskConical, LogOut, Moon, Settings2, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { activeSection, navItems } from "@/components/dashboard/nav-items";
import { useTheme } from "@/contexts/theme-context";
import { dashboardRole, viewerName, type Viewer } from "@/lib/viewer-kind";
import { Avatar } from "./avatar";
import { Dropdown, MENU_ITEM_CLASS } from "./dropdown";

export async function signOut() {
  const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  const body = response?.ok ? ((await response.json()) as { redirect?: string }) : null;
  window.location.href = body?.redirect ?? "/";
}

/** "CHC operator · Balian Cooperative Society", "Farmer", "Setup not finished". */
export function useRoleLine(viewer: Viewer): string {
  const t = useTranslations("nav");
  const tr = useTranslations("roles");
  if (viewer.kind === "farmer") return tr("farmer");
  if (!viewer.me.role) return t("setupPending");
  return viewer.me.chcName ? `${tr(viewer.me.role)} · ${viewer.me.chcName}` : tr(viewer.me.role);
}

export function AccountMenu({ viewer, trigger = "avatar", collapsed = false }: { viewer: Viewer; trigger?: "avatar" | "card"; collapsed?: boolean }) {
  const t = useTranslations("nav");
  const td = useTranslations("dashboard");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const role = dashboardRole(viewer);
  const name = viewerName(viewer);
  const displayName = name ?? td("farmerNoName");
  const roleLine = useRoleLine(viewer);
  const items = role ? navItems(role) : [];
  const current = pathname.startsWith("/dashboard") ? activeSection(pathname) : null;
  const work = items.filter((item) => item.section !== "profile");
  const profile = items.find((item) => item.section === "profile");
  const demo = viewer.kind === "staff" && viewer.me.demo;
  const { theme, toggleTheme } = useTheme();
  // Inside the dashboard the sidebar and bottom bar already list every page: the menu keeps only
  // what is about the person (profile, theme, sign out). On public pages it also lists their pages.
  const inDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const profileHref = role ? "/dashboard/profile" : "/welcome";

  const buttonContent =
    trigger === "card" ? (
      <>
        <Avatar name={name} size="sm" />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium">{displayName}</span>
              {/* The role alone: the centre is already in the sidebar's workspace card. */}
              <span className="block truncate text-xs text-ink-muted">{roleLine.split(" · ")[0]}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" strokeWidth={2} />
          </>
        )}
      </>
    ) : (
      <Avatar name={name} />
    );

  return (
    <Dropdown
      label={t("accountMenu")}
      placement={trigger === "card" ? "above" : "below"}
      className={trigger === "card" ? "w-full" : ""}
      panelClassName={trigger === "card" ? (collapsed ? "w-64" : "w-full min-w-60") : "w-72"}
      buttonClassName={
        trigger === "card"
          ? `flex min-h-14 w-full items-center gap-3 rounded-control text-ink transition-colors ${collapsed ? "justify-center p-1.5 hover:bg-paper" : "border border-line bg-paper/60 p-2.5 hover:border-line-strong hover:bg-paper aria-expanded:border-line-strong aria-expanded:bg-paper"}`
          : "grid size-11 place-items-center rounded-full ring-offset-2 ring-offset-paper hover:ring-2 hover:ring-line-strong aria-expanded:ring-2 aria-expanded:ring-wheat"
      }
      buttonContent={buttonContent}
    >
      {(close) => (
        <>
          <Link href={profileHref} role="menuitem" onClick={close} className="group flex items-center gap-3 rounded-chip px-2.5 pb-2.5 pt-2 hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:outline-none">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate font-medium">{displayName}</span>
                {demo ? (
                  <span title={t("demoAccount")} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-ink-muted/50 px-2 py-0.5 text-xs text-ink-muted">
                    <FlaskConical aria-hidden className="size-3" strokeWidth={2} />
                    {td("demoShort")}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-sm text-ink-muted">{roleLine}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted group-hover:text-ink" strokeWidth={2} />
          </Link>
          <div className="my-1 border-t border-line" />
          {role && !inDashboard ? (
            <>
              <p className="px-3 pb-1 pt-1.5 text-xs text-ink-muted">{td("menuDashboard")}</p>
              {work.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.section} href={item.href} role="menuitem" aria-current={current === item.section ? "page" : undefined} onClick={close} className={`${MENU_ITEM_CLASS} aria-[current=page]:font-medium`}>
                    <Icon aria-hidden className={`size-4 ${current === item.section ? "text-wheat-deep" : "text-ink-muted"}`} strokeWidth={2} />
                    {td(item.labelKey)}
                  </Link>
                );
              })}
              <div className="my-1 border-t border-line" />
              {profile ? (
                <Link href={profile.href} role="menuitem" aria-current={current === "profile" ? "page" : undefined} onClick={close} className={MENU_ITEM_CLASS}>
                  <profile.icon aria-hidden className="size-4 text-ink-muted" strokeWidth={2} />
                  {td(profile.labelKey)}
                </Link>
              ) : null}
            </>
          ) : role ? (
            profile ? (
              <Link href={profile.href} role="menuitem" aria-current={current === "profile" ? "page" : undefined} onClick={close} className={MENU_ITEM_CLASS}>
                <profile.icon aria-hidden className="size-4 text-ink-muted" strokeWidth={2} />
                {td(profile.labelKey)}
              </Link>
            ) : null
          ) : (
            <Link href="/welcome" role="menuitem" onClick={close} className={MENU_ITEM_CLASS}>
              <Settings2 aria-hidden className="size-4 text-ink-muted" strokeWidth={2} />
              {td("finishSetup")}
            </Link>
          )}
          <button type="button" role="menuitem" onClick={toggleTheme} className={MENU_ITEM_CLASS}>
            {theme === "dark" ? <Sun aria-hidden className="size-4 text-ink-muted" strokeWidth={2} /> : <Moon aria-hidden className="size-4 text-ink-muted" strokeWidth={2} />}
            {theme === "dark" ? tc("themeToLight") : tc("themeToDark")}
          </button>
          <button type="button" role="menuitem" onClick={() => void signOut()} className={MENU_ITEM_CLASS}>
            <LogOut aria-hidden className="size-4 text-ink-muted" strokeWidth={2} />
            {tc("signOut")}
          </button>
        </>
      )}
    </Dropdown>
  );
}
