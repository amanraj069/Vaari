/**
 * Cognito hosted UI, authorization-code flow with PKCE, Google as the federated provider.
 * The verifier and state live in a short-lived httpOnly cookie until the callback.
 */
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isStaffPick, rememberRolePick } from "@/lib/cognito";
import { COOKIE, serverConfig } from "@/lib/server-config";

const base64Url = (buffer: Buffer) => buffer.toString("base64url");

export async function GET(request: Request) {
  if (serverConfig.authMode !== "cognito" || !serverConfig.cognitoDomain) {
    return NextResponse.redirect(new URL("/signin?error=cognito_off", serverConfig.publicBaseUrl));
  }
  // The role picked on /signin/<role>, for /welcome after the first sign-in.
  const pick = new URL(request.url).searchParams.get("pick") ?? "";
  if (isStaffPick(pick)) await rememberRolePick(pick);
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(16));
  const jar = await cookies();
  jar.set(COOKIE.oauthState, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    secure: serverConfig.secureCookies,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  const authorize = new URL(`${serverConfig.cognitoDomain}/oauth2/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: serverConfig.cognitoClientId,
    redirect_uri: `${serverConfig.publicBaseUrl}/api/auth/callback`,
    scope: "openid email profile",
    identity_provider: "Google",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  }).toString();
  return NextResponse.redirect(authorize);
}
