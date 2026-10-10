/**
 * /dashboard/book: book a field. A helper books for a farmer (name, phone, the farmer's consent);
 * a farmer books for their own phone. Same page name for both, so "Book a field" means one thing.
 */
import { FarmerNewView } from "@/components/farmer-new";
import { FacilitatorBookView } from "@/components/views/facilitator-book";
import { requireDashboard } from "@/lib/dashboard-access";
import { serverConfig } from "@/lib/server-config";

export default async function DashboardBook() {
  const { role } = await requireDashboard(["facilitator", "farmer"]);
  if (role === "facilitator") return <FacilitatorBookView />;
  return <FarmerNewView whatsappNumber={serverConfig.whatsappBusinessNumber || null} />;
}
