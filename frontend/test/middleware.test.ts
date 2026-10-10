/**
 * The middleware's routing hint for the dashboard: staff by role cookie, farmers by phone-session
 * cookie, each only into their own sections; nobody goes to sign in; staff not set up go to /welcome.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

function visit(path: string, cookies: Record<string, string> = {}) {
  const request = new NextRequest(new URL(path, "http://localhost:3000"));
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value);
  const response = middleware(request);
  const location = response.headers.get("location");
  return location ? new URL(location).pathname + new URL(location).search : null;
}

const operator = { vaari_at: "t", vaari_role: "operator" };
const officer = { vaari_at: "t", vaari_role: "officer" };
const farmer = { vaari_farmer: "s" };

describe("middleware", () => {
  it("lets each role into its own sections and sends it home from the rest", () => {
    expect(visit("/dashboard", operator)).toBeNull();
    expect(visit("/dashboard/plan", operator)).toBeNull();
    expect(visit("/dashboard/book", operator)).toBe("/dashboard");
    expect(visit("/dashboard", officer)).toBeNull();
    expect(visit("/dashboard/queue", officer)).toBe("/dashboard");
    expect(visit("/dashboard/book", farmer)).toBeNull();
    expect(visit("/dashboard/plan", farmer)).toBe("/dashboard");
    expect(visit("/dashboard/proof", farmer)).toBe("/dashboard");
  });

  it("sends nobody to sign in, and staff who are not set up to /welcome", () => {
    expect(visit("/dashboard/plan")).toBe("/signin?next=%2Fdashboard%2Fplan");
    expect(visit("/dashboard", { vaari_at: "t", vaari_role: "pending" })).toBe("/welcome");
    expect(visit("/welcome")).toBe("/signin?next=%2Fwelcome");
    expect(visit("/welcome", { vaari_at: "t", vaari_role: "pending" })).toBeNull();
  });

  it("sends the old farmer addresses into the dashboard, or a farmer without a session to the farmer sign-in", () => {
    expect(visit("/farmer", farmer)).toBe("/dashboard");
    expect(visit("/farmer/new", farmer)).toBe("/dashboard/book");
    expect(visit("/farmer")).toBe("/farmer/signin?next=%2Fdashboard");
    expect(visit("/farmer/new")).toBe("/farmer/signin?next=%2Fdashboard%2Fbook");
  });

  it("a staff session wins over a farmer's phone session in the same browser", () => {
    expect(visit("/dashboard/plan", { ...farmer, ...operator })).toBeNull();
  });
});
