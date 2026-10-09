/**
 * /farmer: all of one farmer's fields, read-only, behind the phone session that a one-time login
 * link (/farmer/login/<token>) leaves. This server wrapper reads ?link= (a used or expired link) and
 * the WhatsApp Business number, then renders the client view.
 */
import { serverConfig } from "@/lib/server-config";
import { FarmerHomeView, type LinkProblem } from "@/components/farmer-home";

export const dynamic = "force-dynamic";

export default async function FarmerPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  const linkProblem: LinkProblem = link === "expired" || link === "unavailable" ? link : null;
  return <FarmerHomeView whatsappNumber={serverConfig.whatsappBusinessNumber || null} linkProblem={linkProblem} />;
}
