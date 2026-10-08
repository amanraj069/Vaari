import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/session";

export async function GET() {
  const response = await apiFetch("/me").catch(() => null);
  if (!response || !response.ok) return NextResponse.json({ signedIn: false });
  return NextResponse.json({ signedIn: true, me: await response.json() });
}
