/** /dashboard/plan: the operator checks tomorrow's plan and approves it (OperatorPlanView). */
import { OperatorPlanView } from "@/components/views/operator-plan";
import { requireDashboard } from "@/lib/dashboard-access";

export default async function DashboardPlan() {
  await requireDashboard(["operator"]);
  return <OperatorPlanView />;
}
