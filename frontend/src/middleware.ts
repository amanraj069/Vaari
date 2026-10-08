/** Routes each signed-in role to its pages. A hint only: the API checks every request with Cedar. */
import { NextResponse, type NextRequest } from "next/server";

const ROLE_PREFIX: Record<string, string[]> = {
  farmer: ["/farmer"],
  facilitator: ["/farmer"],
  operator: ["/operator"],
  officer: [],
};
const HOME: Record<string, string> = { farmer: "/farmer", facilitator: "/farmer", operator: "/operator", officer: "/proof" };

export function middleware(request: NextRequest) {
  const role = request.cookies.get("vaari_role")?.value;
  const hasSession = Boolean(request.cookies.get("vaari_at")?.value);
  const { pathname } = request.nextUrl;
  if (!hasSession || !role) {
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", pathname);
    return NextResponse.redirect(signin);
  }
  // Signed in but not onboarded yet: finish /welcome first.
  if (role === "pending") {
    return pathname === "/welcome" ? NextResponse.next() : NextResponse.redirect(new URL("/welcome", request.url));
  }
  const allowed = ROLE_PREFIX[role] ?? [];
  if (pathname !== "/welcome" && !allowed.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.redirect(new URL(HOME[role] ?? "/", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/farmer/:path*", "/operator/:path*", "/welcome"] };
