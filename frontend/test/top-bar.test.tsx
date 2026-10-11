/**
 * The public top bar on phones is one row: the page links live in a Menu button at its right end
 * (the inline links show from the sm breakpoint up). Sign-in pages have no menu: the task there is
 * the form. A signed-in person's menu offers their dashboard and the proof.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { TopBar } from "@/components/top-bar";
import { ThemeProvider } from "@/contexts/theme-context";
import { renderWithIntl } from "./render";

const location = vi.hoisted(() => ({ pathname: "/" }));
const session = vi.hoisted(() => ({ value: { data: null as unknown, isPending: false, isError: false } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => location.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/use-session", () => ({ useSession: () => session.value, useRefreshSession: () => vi.fn() }));

const draw = (overlay = false) =>
  renderWithIntl(
    <ThemeProvider>
      <TopBar overlay={overlay} />
    </ThemeProvider>,
  );

describe("TopBar on phones", () => {
  beforeEach(() => {
    location.pathname = "/";
    session.value = { data: null, isPending: false, isError: false };
  });

  it("puts the landing page's links in one Menu, with the same targets as the inline links", async () => {
    draw(true);
    const inline = screen.getByRole("navigation", { name: en.nav.mainNav });
    // The inline links are for sm and up; on a phone the nav itself is hidden.
    expect(inline).toHaveClass("hidden", "sm:flex");
    await userEvent.click(screen.getByRole("button", { name: en.nav.pageMenu }));
    const menu = screen.getByRole("menu", { name: en.nav.pageMenu });
    expect(within(menu).getAllByRole("menuitem").map((item) => [item.textContent, item.getAttribute("href")])).toEqual([
      [en.nav.problem, "#problem"],
      [en.nav.how, "#how"],
      [en.nav.proof, "/proof"],
    ]);
    // Sign in stays on the bar itself, beside the menu.
    expect(screen.getByRole("link", { name: en.nav.signIn })).toHaveAttribute("href", "/signin");
  });

  it("offers a signed-in person their dashboard and the proof", async () => {
    session.value = {
      data: { kind: "farmer", farmer: { name: "Jaswinder Singh", registered: true } },
      isPending: false,
      isError: false,
    };
    draw();
    await userEvent.click(screen.getByRole("button", { name: en.nav.pageMenu }));
    expect(within(screen.getByRole("menu", { name: en.nav.pageMenu })).getAllByRole("menuitem").map((item) => item.getAttribute("href"))).toEqual(["/dashboard", "/proof"]);
  });

  it("has no menu on a sign-in page", () => {
    location.pathname = "/signin";
    draw();
    expect(screen.queryByRole("button", { name: en.nav.pageMenu })).not.toBeInTheDocument();
  });
});
