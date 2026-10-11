import { NextResponse } from "next/server";
import { localeSchema } from "@/shared";
import { setLocaleCookie } from "@/lib/session";

export async function POST(request: Request) {
  const parsed = localeSchema.safeParse((await request.json().catch(() => null))?.locale);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_LOCALE" }, { status: 400 });
  await setLocaleCookie(parsed.data);
  return NextResponse.json({ locale: parsed.data });
}
