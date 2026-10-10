/**
 * /dashboard: each role's own overview. Operator: tomorrow's machines (Today). Helper: the
 * farmers they booked for. Officer: the district at a glance. Farmer: every field booked with
 * their phone.
 */
import { FarmerHomeView } from "@/components/farmer-home";
import { FacilitatorBookingsView } from "@/components/views/facilitator-bookings";
import { OfficerOverviewView } from "@/components/views/officer-overview";
import { OperatorTodayView } from "@/components/views/operator-today";
import { requireDashboard } from "@/lib/dashboard-access";
import { serverConfig } from "@/lib/server-config";

export default async function DashboardHome() {
  const { role } = await requireDashboard();
  if (role === "operator") return <OperatorTodayView />;
  if (role === "facilitator") return <FacilitatorBookingsView />;
  if (role === "officer") return <OfficerOverviewView />;
  return <FarmerHomeView whatsappNumber={serverConfig.whatsappBusinessNumber || null} />;
}
