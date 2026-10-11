/**
 * One dashboard for everyone: /dashboard and its sections. Who may open which section is decided
 * here, once, for the middleware (a routing hint), the dashboard pages (which redirect) and the
 * navigation (which only lists what the person may open). The API still checks every request.
 * No imports, so the edge middleware can use it.
 */
export type DashboardRole = "operator" | "facilitator" | "officer" | "farmer";

export type DashboardSection = "home" | "plan" | "queue" | "machines" | "centres" | "book" | "proof" | "profile";

export const SECTION_PATH: Record<DashboardSection, string> = {
  home: "/dashboard",
  plan: "/dashboard/plan",
  queue: "/dashboard/queue",
  machines: "/dashboard/machines",
  centres: "/dashboard/centres",
  book: "/dashboard/book",
  proof: "/dashboard/proof",
  profile: "/dashboard/profile",
};

/** In the order the navigation lists them. "home" is each role's own overview. */
export const ROLE_SECTIONS: Record<DashboardRole, DashboardSection[]> = {
  operator: ["home", "plan", "queue", "machines", "proof", "profile"],
  facilitator: ["home", "book", "proof", "profile"],
  officer: ["home", "centres", "machines", "proof", "profile"],
  farmer: ["home", "book", "profile"],
};

export function sectionOf(pathname: string): DashboardSection | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const match = (Object.entries(SECTION_PATH) as [DashboardSection, string][]).find(([, path]) => path === clean);
  return match ? match[0] : null;
}

export function mayOpen(role: DashboardRole, pathname: string): boolean {
  const section = sectionOf(pathname);
  return section !== null && ROLE_SECTIONS[role].includes(section);
}

export function isDashboardRole(value: string | undefined | null): value is DashboardRole {
  return value === "operator" || value === "facilitator" || value === "officer" || value === "farmer";
}
