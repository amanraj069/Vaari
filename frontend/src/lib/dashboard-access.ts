/**
 * Server-side gate for each dashboard page: who is looking, and may their role open this page?
 * The layout has already sent signed-out and not-yet-set-up people away; a role that may not open
 * a page goes to its own overview (never an error page). The API still checks every request.
 */
import "server-only";
import { redirect } from "next/navigation";
import type { DashboardRole } from "./dashboard-routes";
import { getViewer } from "./viewer";
import { dashboardRole, type Viewer } from "./viewer-kind";

export async function requireDashboard(allowed?: DashboardRole[]): Promise<{ viewer: Viewer; role: DashboardRole }> {
  const result = await getViewer();
  if (result.status !== "signedIn") redirect("/signin");
  const role = dashboardRole(result.viewer);
  if (!role) redirect("/welcome");
  if (allowed && !allowed.includes(role)) redirect("/dashboard");
  return { viewer: result.viewer, role };
}
