/** /dashboard/queue: every field of the operator's centre as a fuse, least slack first. */
import { OperatorQueueView } from "@/components/views/operator-queue";
import { requireDashboard } from "@/lib/dashboard-access";

export default async function DashboardQueue() {
  await requireDashboard(["operator"]);
  return <OperatorQueueView />;
}
