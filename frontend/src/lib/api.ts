/**
 * Browser-side calls. Everything goes through the same-origin BFF proxy (/api/proxy/*), which adds
 * the token server-side. Responses are validated with the shared Zod schemas.
 */
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status} ${code}`);
  }
}

export async function api<Schema extends z.ZodType>(path: string, schema: Schema, init: RequestInit = {}): Promise<z.infer<Schema>> {
  const response = await fetch(`/api/proxy/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { error?: string } | null)?.error ?? "UNKNOWN";
    if (response.status === 401 && typeof window !== "undefined") window.location.href = "/signin";
    throw new ApiError(response.status, code);
  }
  return schema.parse(body);
}

export async function signInAsDemo(role: string): Promise<string> {
  const response = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new ApiError(response.status, "DEMO_SIGNIN_FAILED");
  return ((await response.json()) as { home: string }).home;
}
