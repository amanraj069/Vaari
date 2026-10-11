/**
 * One dashboard, each role's own pages: who may open which section (the middleware, the pages and
 * the navigation all ask lib/dashboard-routes), what the navigation lists for each role, that every
 * label exists in all three languages, and the avatar's initials ("District officer (demo)" -> "DO").
 */
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import pa from "../messages/pa.json";
import { navItems } from "@/components/dashboard/nav-items";
import { ROLE_SECTIONS, mayOpen, sectionOf, type DashboardRole } from "@/lib/dashboard-routes";
import { dashboardRole, initials } from "@/lib/viewer-kind";

const ROLES: DashboardRole[] = ["operator", "facilitator", "officer", "farmer"];

describe("dashboard sections", () => {
  it("each role opens its own sections and nothing else", () => {
    expect(ROLE_SECTIONS.operator).toEqual(["home", "plan", "queue", "machines", "proof", "profile"]);
    expect(ROLE_SECTIONS.facilitator).toEqual(["home", "book", "proof", "profile"]);
    expect(ROLE_SECTIONS.officer).toEqual(["home", "centres", "machines", "proof", "profile"]);
    expect(mayOpen("officer", "/dashboard/centres")).toBe(true);
    expect(mayOpen("operator", "/dashboard/centres")).toBe(false);
    expect(ROLE_SECTIONS.farmer).toEqual(["home", "book", "profile"]);
    for (const role of ROLES) {
      expect(mayOpen(role, "/dashboard")).toBe(true);
      expect(mayOpen(role, "/dashboard/profile")).toBe(true);
    }
    expect(mayOpen("operator", "/dashboard/plan")).toBe(true);
    expect(mayOpen("farmer", "/dashboard/plan")).toBe(false);
    expect(mayOpen("officer", "/dashboard/queue")).toBe(false);
    expect(mayOpen("facilitator", "/dashboard/queue")).toBe(false);
    expect(mayOpen("operator", "/dashboard/book")).toBe(false);
    expect(mayOpen("farmer", "/dashboard/book")).toBe(true);
    // A farmer's dashboard has no proof page; an unknown section is no section.
    expect(mayOpen("farmer", "/dashboard/proof")).toBe(false);
    expect(mayOpen("operator", "/dashboard/anything")).toBe(false);
    expect(sectionOf("/dashboard/plan/")).toBe("plan");
  });

  it("the navigation lists exactly those sections, named for what home shows each role", () => {
    expect(navItems("operator").map((item) => item.labelKey)).toEqual(["navToday", "navPlan", "navQueue", "navMachines", "navProof", "navProfile"]);
    expect(navItems("facilitator").map((item) => item.labelKey)).toEqual(["navBookings", "navBook", "navProof", "navProfile"]);
    expect(navItems("officer").map((item) => item.labelKey)).toEqual(["navDistrict", "navCentres", "navMachines", "navProof", "navProfile"]);
    expect(navItems("farmer").map((item) => item.labelKey)).toEqual(["navMyFields", "navBook", "navProfile"]);
    for (const role of ROLES) for (const item of navItems(role)) expect(mayOpen(role, item.href)).toBe(true);
  });

  it("every navigation label exists in English, Punjabi and Hindi", () => {
    for (const messages of [en, pa, hi]) {
      for (const role of ROLES) for (const item of navItems(role)) expect((messages.dashboard as Record<string, string>)[item.labelKey], item.labelKey).toBeTruthy();
    }
  });

  it("a staff member without a role yet has no dashboard; a farmer always has one", () => {
    const me = { userId: "u", name: "New Person", chcId: null, chcName: null, district: null, language: "en" as const, demo: false };
    expect(dashboardRole({ kind: "staff", me: { ...me, role: null, needsOnboarding: true } })).toBeNull();
    expect(dashboardRole({ kind: "staff", me: { ...me, role: "officer", needsOnboarding: false } })).toBe("officer");
    expect(dashboardRole({ kind: "farmer", farmer: { name: null, registered: false } })).toBe("farmer");
  });
});

describe("initials", () => {
  it("skips words that do not start with a letter", () => {
    expect(initials("District officer (demo)")).toBe("DO");
    expect(initials("Harpal Singh")).toBe("HS");
    expect(initials("Gurpreet")).toBe("G");
    expect(initials("ਜਸਵਿੰਦਰ ਸਿੰਘ")).toBe("ਜਸ");
    expect(initials("(demo)")).toBeNull();
    expect(initials(null)).toBeNull();
  });
});
