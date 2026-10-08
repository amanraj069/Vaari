import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, serverConfig } from "@/lib/server-config";
import { clearSession } from "@/lib/session";

export async function POST() {
  // Only Cognito sessions carry a refresh token; demo sessions just clear cookies.
  const wasCognitoSession = Boolean((await cookies()).get(COOKIE.refreshToken)?.value);
  await clearSession();
  if (wasCognitoSession && serverConfig.authMode === "cognito" && serverConfig.cognitoDomain) {
    const logoutUrl = new URL(`${serverConfig.cognitoDomain}/logout`);
    logoutUrl.searchParams.set("client_id", serverConfig.cognitoClientId);
    logoutUrl.searchParams.set("logout_uri", serverConfig.publicBaseUrl);
    return NextResponse.json({ redirect: logoutUrl.toString() });
  }
  return NextResponse.json({ redirect: "/" });
}
