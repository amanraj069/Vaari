import "server-only";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { COOKIE, serverConfig } from "./server-config";

export async function setSession(accessToken: string, expiresInSeconds: number, role: string, refreshToken?: string) {
  const jar = await cookies();
  const base = { httpOnly: true, secure: serverConfig.secureCookies, sameSite: "lax" as const, path: "/" };
  jar.set(COOKIE.accessToken, accessToken, { ...base, maxAge: expiresInSeconds });
  jar.set(COOKIE.role, role, { ...base, maxAge: 14 * 24 * 3600 });
  if (refreshToken) {
    // Path-scoped so it only travels to the routes that refresh.
    jar.set(COOKIE.refreshToken, refreshToken, { ...base, path: "/api", maxAge: 14 * 24 * 3600 });
  }
}

/** A farmer's phone session (7 days). Separate from signed-in sessions; only /farmer uses it. */
export async function setFarmerSession(sessionToken: string, expiresInSeconds: number) {
  const jar = await cookies();
  jar.set(COOKIE.farmerSession, sessionToken, { httpOnly: true, secure: serverConfig.secureCookies, sameSite: "lax", path: "/", maxAge: expiresInSeconds });
}

/** "pending" means signed in but not onboarded: middleware keeps the user on /welcome. */
export async function setRoleCookie(role: string) {
  const jar = await cookies();
  jar.set(COOKIE.role, role, { httpOnly: true, secure: serverConfig.secureCookies, sameSite: "lax", path: "/", maxAge: 14 * 24 * 3600 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE.accessToken);
  jar.delete(COOKIE.role);
  jar.delete(COOKIE.displayName);
  jar.delete(COOKIE.farmerSession);
  jar.delete({ name: COOKIE.refreshToken, path: "/api" });
}

/**
 * The browser's address, as the host in front of Next saw it: CloudFront's viewer address when
 * present, else the last X-Forwarded-For entry (the one the nearest proxy added; earlier entries
 * can be typed by anyone). ASSUMPTION for Amplify Hosting: it appends the viewer address last.
 */
export function clientIpFrom(incoming: Headers): string | null {
  const viewer = incoming.get("cloudfront-viewer-address");
  if (viewer) {
    // "ip:port", with IPv6 written as "[addr]:port" or "addr:port".
    const address = viewer.startsWith("[") ? viewer.slice(1, viewer.indexOf("]")) : viewer.slice(0, viewer.lastIndexOf(":"));
    if (isIP(address)) return address;
  }
  const forwarded = incoming.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  if (forwarded && isIP(forwarded)) return forwarded;
  const real = incoming.get("x-real-ip")?.trim();
  return real && isIP(real) ? real : null;
}

/**
 * Calls the API on the caller's behalf. Used by route handlers and server components.
 * - /farmer/* carries the farmer's phone session; everything else the signed-in user's token.
 * - The browser's address goes along with the proxy secret, so the API rate-limits per farmer.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = await cookies();
  const token = path.startsWith("/farmer/") ? jar.get(COOKIE.farmerSession)?.value : jar.get(COOKIE.accessToken)?.value;
  const outgoing = new Headers(init.headers);
  if (token) outgoing.set("authorization", `Bearer ${token}`);
  if (init.body && !outgoing.has("content-type")) outgoing.set("content-type", "application/json");
  if (serverConfig.proxySharedSecret) {
    const clientIp = clientIpFrom(await headers());
    if (clientIp) {
      outgoing.set("x-vaari-client-ip", clientIp);
      outgoing.set("x-vaari-proxy-secret", serverConfig.proxySharedSecret);
    }
  }
  return fetch(`${serverConfig.apiUrl}${path}`, { ...init, headers: outgoing, cache: "no-store" });
}
