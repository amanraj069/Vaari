/**
 * "Try as farmer / facilitator / operator": real sessions for seeded demo users (the API refuses
 * unless DEMO_MODE). The farmer has no account: the API answers with a one-time phone login link,
 * and the browser follows it (/farmer/login/<token>) exactly as a farmer taps it on WhatsApp.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { demoPersonaSchema } from "@/shared";
import { ROLE_HOME, serverConfig } from "@/lib/server-config";
import { setSession } from "@/lib/session";

const answerSchema = z.union([
  z.object({ persona: z.literal("farmer"), loginPath: z.string().startsWith("/farmer/login/") }),
  z.object({ persona: z.string(), accessToken: z.string(), expiresIn: z.number(), role: z.string() }),
]);

export async function POST(request: Request) {
  const parsed = z.object({ role: demoPersonaSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const response = await fetch(`${serverConfig.apiUrl}/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: parsed.data.role }),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  if (!response.ok) return NextResponse.json({ error: "DEMO_UNAVAILABLE" }, { status: response.status });
  const answer = answerSchema.safeParse(await response.json());
  if (!answer.success) return NextResponse.json({ error: "DEMO_UNAVAILABLE" }, { status: 502 });
  if ("loginPath" in answer.data) return NextResponse.json({ home: answer.data.loginPath });
  await setSession(answer.data.accessToken, answer.data.expiresIn, answer.data.role);
  return NextResponse.json({ home: ROLE_HOME[answer.data.role] ?? "/" });
}
