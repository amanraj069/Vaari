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

export async function api<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit = {},
  // Slot links have no session: a 401 there means a bad link, not "please sign in".
  options: { redirectOn401?: boolean } = {},
): Promise<z.infer<Schema>> {
  const response = await fetch(`/api/proxy/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { error?: string } | null)?.error ?? "UNKNOWN";
    if (response.status === 401 && options.redirectOn401 !== false && typeof window !== "undefined") window.location.href = "/signin";
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

/** Copies text; falls back to a hidden textarea where the async clipboard is unavailable. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}
