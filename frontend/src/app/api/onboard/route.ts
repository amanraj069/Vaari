/** Saves the /welcome choices through the API, then updates the routing cookie to the new role. */
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/same-origin";
import { cookies } from "next/headers";
import { meSchema, onboardingInputSchema } from "@/shared";
import { COOKIE, ROLE_HOME } from "@/lib/server-config";
import { apiFetch, setLocaleCookie, setRoleCookie } from "@/lib/session";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const input = onboardingInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const response = await apiFetch("/me/profile", { method: "POST", body: JSON.stringify(input.data) }).catch(() => null);
  if (!response) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json(body ?? { error: "FAILED" }, { status: response.status });
  const me = meSchema.parse(body);
  if (!me.role) return NextResponse.json({ error: "FAILED" }, { status: 500 });
  await setRoleCookie(me.role);
  (await cookies()).delete(COOKIE.displayName);
  await setLocaleCookie(input.data.language);
  return NextResponse.json({ home: ROLE_HOME[me.role] ?? "/" });
}
