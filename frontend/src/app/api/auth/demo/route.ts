/** "Try as farmer / operator": real sessions for seeded demo users (API refuses unless DEMO_MODE). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { roleSchema } from "@/shared";
import { ROLE_HOME, serverConfig } from "@/lib/server-config";
import { setSession } from "@/lib/session";

export async function POST(request: Request) {
  const parsed = z.object({ role: roleSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const response = await fetch(`${serverConfig.apiUrl}/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: parsed.data.role }),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  if (!response.ok) return NextResponse.json({ error: "DEMO_UNAVAILABLE" }, { status: response.status });
  const body = (await response.json()) as { accessToken: string; expiresIn: number; role: string };
  await setSession(body.accessToken, body.expiresIn, body.role);
  return NextResponse.json({ home: ROLE_HOME[body.role] ?? "/" });
}
