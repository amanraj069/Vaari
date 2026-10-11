/** /dashboard/centres: every machine centre in the district, the harvest wave and the villages to watch (officers). */
import { OfficerCentresView } from "@/components/views/officer-centres";
import { requireDashboard } from "@/lib/dashboard-access";

export default async function DashboardCentres() {
  await requireDashboard(["officer"]);
  return <OfficerCentresView />;
}
