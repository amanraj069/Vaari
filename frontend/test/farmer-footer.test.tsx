/**
 * The footer on a farmer's own pages: a slot link and phone sign-in end with one quiet line (the
 * simulated label and Privacy), not the site's directory, which on a phone is longer than the page.
 * Every other public page keeps the full footer; the dashboard has none (its shell has its own).
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { GlobalFooter } from "@/components/footer";
import { renderWithIntl } from "./render";

const location = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => location.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const EMAIL = "privacy@example.org";

describe("GlobalFooter on farmer pages", () => {
  beforeEach(() => {
    location.pathname = "/";
  });

  for (const pathname of ["/slot/some-token", "/farmer/signin"]) {
    it(`is one line with the simulated label and Privacy on ${pathname}`, () => {
      location.pathname = pathname;
      renderWithIntl(<GlobalFooter contactEmail={EMAIL} />, "en");
      const footer = screen.getByRole("contentinfo");
      expect(footer).toHaveTextContent(en.common.simulatedLong);
      expect(screen.getByRole("link", { name: en.nav.privacy })).toHaveAttribute("href", "/privacy");
      // No site directory: no operator links, no contact icons.
      expect(screen.queryByRole("link", { name: en.nav.plan })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: en.common.contactLabel })).not.toBeInTheDocument();
    });
  }

  it("keeps the full footer on other public pages", () => {
    location.pathname = "/proof";
    renderWithIntl(<GlobalFooter contactEmail={EMAIL} />, "en");
    expect(screen.getByRole("link", { name: en.nav.plan })).toHaveAttribute("href", "/dashboard/plan");
    expect(screen.getByRole("link", { name: en.common.contactLabel })).toHaveAttribute("href", `mailto:${EMAIL}`);
  });

  it("renders nothing inside the dashboard", () => {
    location.pathname = "/dashboard";
    renderWithIntl(<GlobalFooter contactEmail={EMAIL} />, "en");
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
});
