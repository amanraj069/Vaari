/**
 * /slot/[token]: a farmer's turn, opened from a link with no sign-in. The page itself is the client
 * component in slot-client.tsx; this server wrapper only hands it the WhatsApp Business number
 * (WHATSAPP_BUSINESS_NUMBER, read at request time) for the "See all my fields" button, so the number
 * never travels through the API.
 */
import { serverConfig } from "@/lib/server-config";
import { SlotPageClient } from "./slot-client";

export const dynamic = "force-dynamic";

export default function SlotPage() {
  return <SlotPageClient whatsappNumber={serverConfig.whatsappBusinessNumber || null} />;
}
