/**
 * Routes people to the pages their role may open. A hint only: the API checks every request with
 * Cedar, and each dashboard page checks the role again on the server.
 * - /dashboard/*: staff by their role cookie, else a farmer by their phone-session cookie, each only
 *   to their own sections (lib/dashboard-routes.ts); anything else goes to /dashboard. Nobody: sign in.
 * - /welcome: signed-in staff only.
 * - /farmer and /farmer/new (old addresses, still in sent WhatsApp messages): into the dashboard for
 *   anyone signed in; a farmer without a session goes to the farmer sign-in, never the staff one.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isDashboardRole, mayOpen } from "@/lib/dashboard-routes";

export function middleware(request: NextRequest) {
  const role = request.cookies.get("vaari_role")?.value;
  const hasStaffSession = Boolean(request.cookies.get("vaari_at")?.value) && Boolean(role);
  const hasFarmerSession = Boolean(request.cookies.get("vaari_farmer")?.value);
  const { pathname } = request.nextUrl;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (pathname === "/farmer" || pathname === "/farmer/new") {
    const target = pathname === "/farmer" ? "/dashboard" : "/dashboard/book";
    if (hasStaffSession || hasFarmerSession) return to(target + request.nextUrl.search);
    return to(`/farmer/signin?next=${encodeURIComponent(target)}`);
  }

  if (pathname === "/welcome") {
    if (hasStaffSession) return NextResponse.next();
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", pathname);
    return NextResponse.redirect(signin);
  }

  if (hasStaffSession) {
    // Signed in but not set up yet: finish /welcome first.
    if (role === "pending") return to("/welcome");
    if (!isDashboardRole(role) || role === "farmer") return to("/signin");
    return mayOpen(role, pathname) ? NextResponse.next() : to("/dashboard");
  }
  if (hasFarmerSession) return mayOpen("farmer", pathname) ? NextResponse.next() : to("/dashboard");

  const signin = new URL("/signin", request.url);
  signin.searchParams.set("next", pathname);
  return NextResponse.redirect(signin);
}

export const config = { matcher: ["/dashboard", "/dashboard/:path*", "/welcome", "/farmer", "/farmer/new"] };
