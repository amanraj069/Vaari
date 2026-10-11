/**
 * GET /farmer/login/<token>: the link a farmer taps on WhatsApp (and the demo farmer follows).
 * Exchanges the one-time login token for a 7-day phone session cookie, then opens the farmer's
 * dashboard in the language the link was sent in (the WhatsApp chat's language). A used, expired or
 * broken link opens the farmer sign-in with a plain word on why.
 * The token goes to the API in a POST body, never in a URL the API would log.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/server-config";
import { apiFetch, setFarmerSession, setLocaleCookie } from "@/lib/session";
import { localeSchema } from "@/shared";

const sessionSchema = z.object({ sessionToken: z.string().min(1), expiresIn: z.number().int().positive(), locale: localeSchema.optional() });

type Context = { params: Promise<{ token: string }> };

function redirectTo(path: string) {
  const response = NextResponse.redirect(new URL(path, serverConfig.publicBaseUrl));
  // The token is in this URL: never cache it, never pass it on as a referrer, never index it.
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  const response = await apiFetch("/farmer/login", { method: "POST", body: JSON.stringify({ token }) }).catch(() => null);
  if (!response) return redirectTo("/farmer/signin?link=unavailable");
  if (!response.ok) return redirectTo("/farmer/signin?link=expired");
  const session = sessionSchema.safeParse(await response.json().catch(() => null));
  if (!session.success) return redirectTo("/farmer/signin?link=unavailable");
  await setFarmerSession(session.data.sessionToken, session.data.expiresIn);
  if (session.data.locale) await setLocaleCookie(session.data.locale);
  return redirectTo("/dashboard");
}
