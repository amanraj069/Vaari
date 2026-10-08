/**
 * Who is signed in. Three answers, kept distinct so the UI never says "Sign in" to someone whose
 * session is fine but whose API is momentarily unreachable:
 *   no session cookie, or the API rejects the token -> { signedIn: false }
 *   the API cannot be reached or fails               -> 503 { error: "API_UNAVAILABLE" }
 *   otherwise                                        -> { signedIn: true, me }
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

export async function GET() {
  if (!(await cookies()).get(COOKIE.accessToken)?.value) return NextResponse.json({ signedIn: false });
  const response = await apiFetch("/me").catch(() => null);
  if (!response || response.status >= 500) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  if (!response.ok) return NextResponse.json({ signedIn: false });
  return NextResponse.json({ signedIn: true, me: await response.json() });
}
