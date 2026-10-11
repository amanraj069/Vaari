/**
 * What the dashboard's navigation lists for a person: their role's sections (lib/dashboard-routes),
 * each with its icon and its words. The sidebar, the phone's bottom bar and the account menu all
 * read this, so they never disagree. "home" is named for what it shows to that role.
 */
import { BarChart3, Building2, CalendarCheck2, Tractor, ClipboardCheck, LandPlot, LayoutDashboard, ListOrdered, Plus, Sprout, UserRound, Users, type LucideIcon } from "lucide-react";
import { ROLE_SECTIONS, SECTION_PATH, sectionOf, type DashboardRole, type DashboardSection } from "@/lib/dashboard-routes";

export type NavItem = {
  section: DashboardSection;
  href: string;
  // A key in the "dashboard" messages.
  labelKey: string;
  icon: LucideIcon;
  // main: the role's own work; more: shared pages (the proof, the profile).
  group: "main" | "more";
};

const HOME: Record<DashboardRole, { labelKey: string; icon: LucideIcon }> = {
  operator: { labelKey: "navToday", icon: CalendarCheck2 },
  facilitator: { labelKey: "navBookings", icon: Users },
  officer: { labelKey: "navDistrict", icon: LandPlot },
  farmer: { labelKey: "navMyFields", icon: Sprout },
};

const OTHER: Record<Exclude<DashboardSection, "home">, { labelKey: string; icon: LucideIcon; group: NavItem["group"] }> = {
  plan: { labelKey: "navPlan", icon: ClipboardCheck, group: "main" },
  queue: { labelKey: "navQueue", icon: ListOrdered, group: "main" },
  machines: { labelKey: "navMachines", icon: Tractor, group: "main" },
  centres: { labelKey: "navCentres", icon: Building2, group: "main" },
  book: { labelKey: "navBook", icon: Plus, group: "main" },
  proof: { labelKey: "navProof", icon: BarChart3, group: "more" },
  profile: { labelKey: "navProfile", icon: UserRound, group: "more" },
};

export function navItems(role: DashboardRole): NavItem[] {
  return ROLE_SECTIONS[role].map((section) => {
    const href = SECTION_PATH[section];
    if (section === "home") return { section, href, ...HOME[role], group: "main" };
    return { section, href, ...OTHER[section] };
  });
}

/** The item for the page being shown (exact match: /dashboard is not "active" on /dashboard/plan). */
export function activeSection(pathname: string): DashboardSection | null {
  return sectionOf(pathname);
}

export const DASHBOARD_ICON = LayoutDashboard;
