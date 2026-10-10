/**
 * The dashboard frame and the account menu: the same frame for every role with only the list of
 * pages changing, the current page marked, the account menu listing the person's own pages (not a
 * vague "go to my page"), and a farmer's dashboard having no staff pages.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/account-menu";
import { DashboardShell } from "@/components/dashboard/shell";
import { ThemeProvider } from "@/contexts/theme-context";
import { SAMPLE_BOOKED, SAMPLE_TODAY } from "@/lib/samples";
import type { Viewer } from "@/lib/viewer-kind";
import { renderWithIntl } from "./render";

const pathname = vi.hoisted(() => ({ current: "/dashboard/plan" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname.current,
}));

const staff = (role: "operator" | "facilitator" | "officer", name: string, chcName: string | null = "Balian Cooperative Society"): Viewer => ({
  kind: "staff",
  me: { userId: `u-${role}`, name, role, chcId: chcName ? "chc-balian" : null, chcName, language: "en", demo: true, needsOnboarding: false },
});
const farmer: Viewer = { kind: "farmer", farmer: { name: "Jaswinder Singh", registered: true } };

function renderShell(viewer: Viewer) {
  return renderWithIntl(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell viewer={viewer}>
          <h1>Page</h1>
        </DashboardShell>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("DashboardShell", () => {
  it("lists the operator's pages in the sidebar and marks the current one", () => {
    pathname.current = "/dashboard/plan";
    renderShell(staff("operator", "Harpal Singh"));
    const sidebar = screen.getByRole("navigation", { name: "Main" });
    const links = within(sidebar).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/dashboard", "/dashboard/plan", "/dashboard/queue", "/dashboard/proof", "/dashboard/profile"]);
    expect(within(sidebar).getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar).getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
    // The workspace card says whose work this is.
    const aside = screen.getByRole("complementary", { name: "Dashboard" });
    expect(within(aside).getByText("Balian Cooperative Society")).toBeInTheDocument();
    expect(within(aside).getAllByText("CHC operator").length).toBeGreaterThan(0);
    // The phone's bottom bar has the same pages, without the profile (it is in the account menu).
    const bottom = screen.getByRole("navigation", { name: "Dashboard pages" });
    expect(within(bottom).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/dashboard", "/dashboard/plan", "/dashboard/queue", "/dashboard/proof"]);
    expect(screen.getByRole("heading", { name: "Page" })).toBeInTheDocument();
  });

  it("gives the officer a District page and the farmer only their fields and booking", () => {
    pathname.current = "/dashboard";
    const officer = renderShell(staff("officer", "District officer (demo)", null));
    expect(within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["District", "Proof", "Profile"]);
    officer.unmount();
    renderShell(farmer);
    const sidebar = screen.getByRole("navigation", { name: "Main" });
    expect(within(sidebar).getAllByRole("link").map((link) => link.textContent)).toEqual(["My fields", "Book a field", "Profile"]);
    expect(within(sidebar).getByRole("link", { name: "My fields" })).toHaveAttribute("aria-current", "page");
  });
});

describe("sidebar badges", () => {
  it("count the helper's bookings beside Bookings, in words for screen readers", async () => {
    pathname.current = "/dashboard";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("facilitator/fields")
          ? new Response(JSON.stringify({ today: SAMPLE_TODAY, items: SAMPLE_BOOKED }), { status: 200, headers: { "content-type": "application/json" } })
          : new Response("{}", { status: 404 }),
      ),
    );
    renderShell(staff("facilitator", "Gurpreet Kaur"));
    const sidebar = screen.getByRole("navigation", { name: "Main" });
    expect(await within(sidebar).findByRole("link", { name: "Bookings, 3 fields booked" })).toHaveAttribute("href", "/dashboard");
    vi.unstubAllGlobals();
  });
});

describe("AccountMenu", () => {
  /** Every item after the person's own name (the first item, which opens their profile). */
  const itemsAfterName = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").slice(1).map((item) => item.textContent);

  it("inside the dashboard: the name opens the profile; then profile, theme and sign out only", async () => {
    pathname.current = "/dashboard/plan";
    renderWithIntl(<AccountMenu viewer={staff("operator", "Harpal Singh")} trigger="card" />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu");
    const name = within(menu).getAllByRole("menuitem")[0]!;
    expect(name).toHaveTextContent("Harpal Singh");
    expect(name).toHaveAttribute("href", "/dashboard/profile");
    expect(itemsAfterName(menu)).toEqual(["Profile", "Switch to dark mode", "Sign out"]);
  });

  it("on a public page it also lists the person's own pages (there is no sidebar there)", async () => {
    pathname.current = "/proof";
    renderWithIntl(<AccountMenu viewer={staff("operator", "Harpal Singh")} />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(itemsAfterName(screen.getByRole("menu"))).toEqual(["Today", "Plan", "Queue", "Proof", "Profile", "Switch to dark mode", "Sign out"]);
  });

  it("shows clean initials for the demo officer and a farmer's pages for a farmer", async () => {
    pathname.current = "/";
    const officer = renderWithIntl(<AccountMenu viewer={staff("officer", "District officer (demo)", null)} />);
    expect(screen.getByRole("button", { name: "Account" })).toHaveTextContent("DO");
    officer.unmount();
    renderWithIntl(<AccountMenu viewer={farmer} />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(itemsAfterName(screen.getByRole("menu"))).toEqual(["My fields", "Book a field", "Profile", "Switch to dark mode", "Sign out"]);
  });

  it("asks a new staff member to finish setting up instead of listing pages", async () => {
    renderWithIntl(<AccountMenu viewer={{ kind: "staff", me: { userId: "u", name: "new@example.org", role: null, chcId: null, chcName: null, language: "en", demo: false, needsOnboarding: true } }} />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(itemsAfterName(screen.getByRole("menu"))).toEqual(["Finish setting up", "Switch to dark mode", "Sign out"]);
  });
});
