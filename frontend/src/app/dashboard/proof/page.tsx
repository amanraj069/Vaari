/** /dashboard/proof: the simulator's evidence inside the dashboard, the same report as the public /proof. */
import { ProofView } from "@/components/views/proof-view";
import { requireDashboard } from "@/lib/dashboard-access";

export default async function DashboardProof() {
  await requireDashboard(["operator", "facilitator", "officer"]);
  return <ProofView />;
}
