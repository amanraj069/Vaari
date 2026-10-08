import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/server-config";
import { clearSession } from "@/lib/session";

export async function POST() {
  await clearSession();
  if (serverConfig.authMode === "cognito" && serverConfig.cognitoDomain) {
    const logoutUrl = new URL(`${serverConfig.cognitoDomain}/logout`);
    logoutUrl.searchParams.set("client_id", serverConfig.cognitoClientId);
    logoutUrl.searchParams.set("logout_uri", serverConfig.publicBaseUrl);
    return NextResponse.json({ redirect: logoutUrl.toString() });
  }
  return NextResponse.json({ redirect: "/" });
}
