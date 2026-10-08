/**
 * "Take me where I belong": asks the API who this is, rewrites the role cookie to match, and
 * redirects to the right page. The role cookie is only a routing hint for middleware; when it is
 * stale (e.g. still "pending" after onboarding finished), pages send the user here instead of
 * redirecting on their own, which is what caused a /welcome <-> /farmer redirect loop.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { meSchema } from "@/shared";
import { COOKIE, ROLE_HOME, serverConfig } from "@/lib/server-config";
import { apiFetch, setRoleCookie } from "@/lib/session";

const to = (path: string) => NextResponse.redirect(new URL(path, serverConfig.publicBaseUrl));

export async function GET() {
  if (!(await cookies()).get(COOKIE.accessToken)?.value) return to("/signin");
  const response = await apiFetch("/me").catch(() => null);
  if (!response || response.status >= 500) return to("/signin?error=unavailable");
  if (!response.ok) return to("/signin");
  const me = meSchema.safeParse(await response.json());
  if (!me.success) return to("/signin?error=unavailable");
  if (me.data.needsOnboarding || !me.data.role) {
    await setRoleCookie("pending");
    return to("/welcome");
  }
  await setRoleCookie(me.data.role);
  return to(ROLE_HOME[me.data.role] ?? "/");
}
