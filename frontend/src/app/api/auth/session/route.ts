/**
 * Who is signed in, for the top bar on public pages. Three answers, kept distinct so the UI never
 * says "Sign in" to someone whose session is fine but whose API is momentarily unreachable:
 *   no session, or the API rejects it      -> { signedIn: false }
 *   the API cannot be reached or fails     -> 503 { error: "API_UNAVAILABLE" }
 *   otherwise                              -> { signedIn: true, viewer } (staff or a farmer's phone session)
 */
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";

export async function GET() {
  const result = await getViewer();
  if (result.status === "unavailable") return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  if (result.status === "signedOut") return NextResponse.json({ signedIn: false });
  return NextResponse.json({ signedIn: true, viewer: result.viewer });
}
