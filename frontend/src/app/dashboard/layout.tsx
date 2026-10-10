/**
 * /dashboard: one workspace for every role (operator, helper, officer, farmer), in one frame
 * (DashboardShell). Who is looking is settled here, on the server, before anything renders:
 * nobody -> sign in (a farmer whose phone session ended -> the farmer sign-in, with a word on why);
 * staff who have not picked a role yet -> /welcome; the API unreachable -> a calm error, not a
 * sign-in page. Every dashboard page may show one farmer's fields or contacts: never indexed,
 * never sent on as a referrer.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { DashboardUnavailable } from "@/components/dashboard/unavailable";
import { PRIVATE_PAGE_METADATA } from "@/lib/private-pages";
import { getViewer } from "@/lib/viewer";
import { dashboardRole } from "@/lib/viewer-kind";

export const dynamic = "force-dynamic";
export const metadata: Metadata = PRIVATE_PAGE_METADATA;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getViewer();
  if (result.status === "unavailable") return <DashboardUnavailable />;
  if (result.status === "signedOut") redirect(result.farmerSessionEnded ? "/farmer/signin?link=ended" : "/signin");
  if (!dashboardRole(result.viewer)) redirect("/welcome");
  return <DashboardShell viewer={result.viewer}>{children}</DashboardShell>;
}
