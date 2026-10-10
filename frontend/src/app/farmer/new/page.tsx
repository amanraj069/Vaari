/** /farmer/new: a registered farmer books a field for their own phone (see FarmerNewView). */
import { FarmerNewView } from "@/components/farmer-new";
import { serverConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

export default function FarmerNewPage() {
  return <FarmerNewView whatsappNumber={serverConfig.whatsappBusinessNumber || null} />;
}
