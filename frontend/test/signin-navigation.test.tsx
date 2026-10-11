/**
 * Signing in opens the dashboard with a full page load. While signed out, a page prefetches dashboard
 * links (the footer's Plan and Queue); the middleware answers those prefetches with "go to /signin",
 * and Next keeps that answer in its router cache. A client-side push after sign-in replayed it, so
 * the operator's first click on "Check and approve" went back to sign-in. So:
 *   - the demo buttons always use window.location.assign, never router.push;
 *   - the public footer never prefetches a dashboard link.
 * And /farmer/signin without a WhatsApp number shows the form alone, never beside an empty half.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSplitLayout } from "@/components/auth-split-layout";
import { DemoButton } from "@/components/demo-buttons";
import { GlobalFooter } from "@/components/footer";
import { renderWithIntl } from "./render";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/signin",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
// Records whether each link may be prefetched (Next's Link prefetches unless prefetch={false}).
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: boolean; children: ReactNode }) => (
    <a href={href} data-prefetch={prefetch === false ? "off" : "on"} {...rest}>
      {children}
    </a>
  ),
}));

const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("demo sign-in", () => {
  it("opens the staff dashboard with a full page load, not a client-side push", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ home: "/dashboard" }), { status: 200 })));
    renderWithIntl(<DemoButton role="operator" label="Try as operator" />);
    await userEvent.click(screen.getByRole("button", { name: /Try as operator/ }));
    expect(assign).toHaveBeenCalledWith("/dashboard");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("follows the demo farmer's one-time login link the same way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ home: "/farmer/login/abc" }), { status: 200 })));
    renderWithIntl(<DemoButton role="farmer" label="Try as farmer" />);
    await userEvent.click(screen.getByRole("button", { name: /Try as farmer/ }));
    expect(assign).toHaveBeenCalledWith("/farmer/login/abc");
  });
});

describe("public footer", () => {
  it("never prefetches a dashboard link", () => {
    renderWithIntl(<GlobalFooter contactEmail="privacy@example.org" />);
    const dashboardLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/dashboard"));
    expect(dashboardLinks.map((link) => link.getAttribute("href"))).toEqual(["/dashboard", "/dashboard/book", "/dashboard/plan", "/dashboard/queue"]);
    for (const link of dashboardLinks) expect(link).toHaveAttribute("data-prefetch", "off");
  });
});

describe("AuthSplitLayout", () => {
  it("puts the visual beside the content when there is one", () => {
    const { container } = renderWithIntl(
      <AuthSplitLayout visual={<p>WhatsApp card</p>} visualAbove compact>
        <p>Form</p>
      </AuthSplitLayout>,
    );
    const grid = container.firstElementChild!;
    expect(grid.children).toHaveLength(2);
    expect(grid.className).toContain("lg:grid-cols-2");
  });

  it("with visualAbove, puts the visual first on narrow screens and never hides it", () => {
    const { container } = renderWithIntl(
      <AuthSplitLayout visual={<p>WhatsApp card</p>} visualAbove compact>
        <p>Form</p>
      </AuthSplitLayout>,
    );
    const [visualCell, contentCell] = Array.from(container.firstElementChild!.children);
    expect(visualCell).toHaveTextContent("WhatsApp card");
    expect(contentCell).toHaveTextContent("Form");
    // Source order is the order on every screen: no order-* classes reshuffle it, nothing hides the visual.
    for (const cell of [visualCell!, contentCell!]) expect(cell.className).not.toMatch(/order-|hidden/);
  });

  it("without visualAbove, leaves the visual out below lg", () => {
    const { container } = renderWithIntl(
      <AuthSplitLayout visual={<p>WhatsApp card</p>}>
        <p>Form</p>
      </AuthSplitLayout>,
    );
    expect(container.firstElementChild!.children[0]!.className).toContain("hidden lg:block");
  });

  it("shows the content alone, in one column, without a visual", () => {
    const { container } = renderWithIntl(
      <AuthSplitLayout visual={null} visualAbove compact>
        <p>Form</p>
      </AuthSplitLayout>,
    );
    const grid = container.firstElementChild!;
    expect(grid.children).toHaveLength(1);
    expect(grid.className).not.toContain("lg:grid-cols-2");
    expect(screen.getByText("Form")).toBeInTheDocument();
  });
});
