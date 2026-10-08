import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decodeJwt } from "jose";
import { COOKIE, ROLE_HOME, serverConfig } from "@/lib/server-config";
import { setSession } from "@/lib/session";

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
  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  // Routing hint only; the API verifies the signature on every request.
  const groups = (decodeJwt(tokens.access_token)["cognito:groups"] as string[] | undefined) ?? [];
  const role = groups[0] ?? "";
  await setSession(tokens.access_token, tokens.expires_in, role, tokens.refresh_token);
  return NextResponse.redirect(new URL(role ? ROLE_HOME[role] ?? "/welcome" : "/welcome", serverConfig.publicBaseUrl));
}
