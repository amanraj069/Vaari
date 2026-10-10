/** /dashboard/profile: who you are here, your language and look, and signing out. */
import { ProfileView } from "@/components/views/profile";
import { requireDashboard } from "@/lib/dashboard-access";
import { serverConfig } from "@/lib/server-config";

export default async function DashboardProfile() {
  const { viewer } = await requireDashboard();
  return <ProfileView viewer={viewer} whatsappNumber={serverConfig.whatsappBusinessNumber || null} />;
}
