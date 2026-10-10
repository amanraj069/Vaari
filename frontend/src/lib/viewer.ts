/**
 * Who is looking, on the server: a signed-in staff member (their /me), a farmer with a phone
 * session (/farmer/me), nobody, or "we cannot tell right now" (the API is unreachable). Staff come
 * first when both cookies exist. Cached per request, so a layout and its page ask the API once.
 */
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { farmerMeSchema, meSchema } from "@/shared";
import { COOKIE } from "./server-config";
import { apiFetch } from "./session";
import type { Viewer } from "./viewer-kind";

export type ViewerResult =
  | { status: "signedIn"; viewer: Viewer }
  // farmerSessionEnded: there was a phone session cookie, but the API no longer accepts it.
  | { status: "signedOut"; farmerSessionEnded: boolean }
  | { status: "unavailable" };

export const getViewer = cache(async (): Promise<ViewerResult> => {
  const jar = await cookies();
  if (jar.get(COOKIE.accessToken)?.value) {
    const response = await apiFetch("/me").catch(() => null);
    if (!response || response.status >= 500) return { status: "unavailable" };
    if (response.ok) {
      const me = meSchema.safeParse(await response.json().catch(() => null));
      if (!me.success) return { status: "unavailable" };
      return { status: "signedIn", viewer: { kind: "staff", me: me.data } };
    }
  }
  if (jar.get(COOKIE.farmerSession)?.value) {
    const response = await apiFetch("/farmer/me").catch(() => null);
    if (!response || response.status >= 500) return { status: "unavailable" };
    if (!response.ok) return { status: "signedOut", farmerSessionEnded: true };
    const farmer = farmerMeSchema.safeParse(await response.json().catch(() => null));
    if (!farmer.success) return { status: "unavailable" };
    return { status: "signedIn", viewer: { kind: "farmer", farmer: farmer.data } };
  }
  return { status: "signedOut", farmerSessionEnded: false };
});
