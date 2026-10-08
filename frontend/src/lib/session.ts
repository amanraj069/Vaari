import "server-only";
import { cookies } from "next/headers";
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
  jar.delete({ name: COOKIE.refreshToken, path: "/api" });
}

/** Calls the private API with the caller's token. Used by route handlers and server components. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(COOKIE.accessToken)?.value;
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${serverConfig.apiUrl}${path}`, { ...init, headers, cache: "no-store" });
}
