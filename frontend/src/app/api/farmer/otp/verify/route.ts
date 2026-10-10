/**
 * POST /api/farmer/otp/verify: the farmer's phone and one-time code go to the API; a right code comes
 * back as a 7-day phone session, which stays here in the httpOnly cookie (the browser never sees it).
 * A refusal (wrong, used or expired code) passes through as the API phrased it, without a token.
 */
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/same-origin";
import { z } from "zod";
import { apiFetch, setFarmerSession } from "@/lib/session";

const sessionSchema = z.object({ sessionToken: z.string().min(1), expiresIn: z.number().int().positive(), registered: z.boolean() });

export async function POST(request: Request) {
  // Same-origin pages only (CSRF guard on top of SameSite cookies), like the proxy.
  if (!isSameOrigin(request)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const response = await apiFetch("/farmer/otp/verify", { method: "POST", body: await request.text() }).catch(() => null);
  if (!response) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json(body ?? { error: "UNKNOWN" }, { status: response.status });
  const session = sessionSchema.safeParse(body);
  if (!session.success) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 502 });
  await setFarmerSession(session.data.sessionToken, session.data.expiresIn);
  // `registered`: false for a number Vaari has never seen; the page then asks for the name.
  return NextResponse.json({ signedIn: true, registered: session.data.registered }, { headers: { "cache-control": "no-store" } });
}
