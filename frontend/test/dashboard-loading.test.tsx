/**
 * Moving between dashboard pages shows a loading page at once (Next's Suspense fallback for every
 * /dashboard page), never the previous page's content under the new page's marker.
 */
import { screen, within } from "@testing-library/react";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import DashboardLoading from "@/app/dashboard/loading";
import { renderWithIntl } from "./render";

describe("dashboard loading page", () => {
  it("sits at the dashboard level, so it covers every role's pages", () => {
    expect(existsSync(path.resolve(__dirname, "../src/app/dashboard/loading.tsx"))).toBe(true);
  });

  it.each(["en", "hi", "pa"] as const)("says it is loading and marks the page busy (%s)", (locale) => {
    renderWithIntl(<DashboardLoading />, locale);
    const loading = screen.getByTestId("dashboard-loading");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(within(loading).getByRole("status").textContent).not.toBe("");
  });
});
