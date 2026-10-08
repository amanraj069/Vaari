import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { localeSchema } from "@/shared";
import { COOKIE } from "@/lib/server-config";

export async function POST(request: Request) {
  const parsed = localeSchema.safeParse((await request.json().catch(() => null))?.locale);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_LOCALE" }, { status: 400 });
  (await cookies()).set(COOKIE.locale, parsed.data, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
  return NextResponse.json({ locale: parsed.data });
}
