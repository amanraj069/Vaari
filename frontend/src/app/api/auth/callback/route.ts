import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decodeJwt } from "jose";
import { meSchema } from "@/shared";
import { COOKIE, ROLE_HOME, serverConfig } from "@/lib/server-config";
import { setRoleCookie, setSession } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get(COOKIE.oauthState)?.value;
  jar.delete({ name: COOKIE.oauthState, path: "/api/auth" });
  const fail = (reason: string) => NextResponse.redirect(new URL(`/signin?error=${reason}`, serverConfig.publicBaseUrl));
  if (!saved) return fail("expired");
  const { verifier, state } = JSON.parse(saved) as { verifier: string; state: string };
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== state) return fail("state");

  const tokenResponse = await fetch(`${serverConfig.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: serverConfig.cognitoClientId,
      code,
      redirect_uri: `${serverConfig.publicBaseUrl}/api/auth/callback`,
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return fail("token");
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
    expires_in: number;
  };
  await setSession(tokens.access_token, tokens.expires_in, "pending", tokens.refresh_token);

  // The API decides the role: a Cognito group, or the profile picked on /welcome.
  const meResponse = await fetch(`${serverConfig.apiUrl}/me`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  }).catch(() => null);
  const me = meResponse?.ok ? meSchema.safeParse(await meResponse.json()) : null;
  if (!me?.success) return fail("token");

  if (me.data.needsOnboarding || !me.data.role) {
    if (tokens.id_token) {
      const claims = decodeJwt(tokens.id_token);
      const name = typeof claims.name === "string" ? claims.name : typeof claims.email === "string" ? claims.email.split("@")[0] : "";
      if (name) jar.set(COOKIE.displayName, name, { httpOnly: true, secure: serverConfig.secureCookies, sameSite: "lax", path: "/", maxAge: 900 });
    }
    return NextResponse.redirect(new URL("/welcome", serverConfig.publicBaseUrl));
  }
  await setRoleCookie(me.data.role);
  return NextResponse.redirect(new URL(ROLE_HOME[me.data.role] ?? "/", serverConfig.publicBaseUrl));
}
