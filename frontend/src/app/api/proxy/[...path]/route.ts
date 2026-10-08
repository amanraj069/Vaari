/**
 * The browser's only way to the API: same-origin, cookie-authenticated. Next attaches the bearer
 * token and forwards to the private API. Only known path prefixes are forwarded.
 */
import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/session";

const ALLOWED_PREFIXES = ["me", "villages", "farmer/", "fields/", "operator/", "public/"];

async function forward(request: Request, path: string[]) {
  const joined = path.join("/");
  if (!ALLOWED_PREFIXES.some((prefix) => joined === prefix || joined.startsWith(prefix))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const search = new URL(request.url).search;
  const init: RequestInit = { method: request.method };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.text();
  const response = await apiFetch(`/${joined}${search}`, init).catch(() => null);
  if (!response) return NextResponse.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  return forward(request, (await context.params).path);
}

export async function POST(request: Request, context: Context) {
  // State-changing calls must come from our own pages (CSRF guard on top of SameSite cookies).
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return forward(request, (await context.params).path);
}
