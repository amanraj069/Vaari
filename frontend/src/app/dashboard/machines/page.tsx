/**
 * /dashboard/machines. Operator: the centre's fleet (status, loans, speed; add and remove a
 * machine). Officer: the district's machines by district and centre, and load per machine.
 */
import { OfficerFleetView } from "@/components/views/officer-fleet";
import { OperatorMachinesView } from "@/components/views/operator-machines";
import { requireDashboard } from "@/lib/dashboard-access";

export default async function DashboardMachines() {
  const { role } = await requireDashboard(["operator", "officer"]);
  return role === "officer" ? <OfficerFleetView /> : <OperatorMachinesView />;
}
