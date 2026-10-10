/**
 * /signin: farmers to WhatsApp; helpers, operators and officers pick a role, then Log in / Register
 * (their role's page: Google on top, email under it; both off in this demo run, which has no
 * Cognito) or Continue with Google; demo accounts take over the panel on demand. Accessibility bar on both pages:
 * axe WCAG 2.1 A/AA, no sideways scroll, 44px targets, in English, Punjabi and Hindi, light and dark.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const BASE = "http://localhost:3100";

test("farmers to WhatsApp; staff Log in / Register to their page, where they pick the role", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("region", { name: "For farmers" }).getByRole("link", { name: /Sign in with WhatsApp/ })).toHaveAttribute("href", "/farmer/signin");
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await page.getByRole("link", { name: "Log in / Register" }).click();
  await page.waitForURL(`${BASE}/signin/helper`);
  await expect(page.getByRole("heading", { name: "Sign in as a village helper" })).toBeVisible();
  await expect(page.getByText("Google sign-in is switched off in this local demo.")).toBeVisible();
  await expect(page.getByText("Email sign-in needs Cognito, which is switched off in this local demo.")).toBeVisible();
  // The role is picked here, in place.
  await page.getByRole("radio", { name: "Machine centre operator" }).click();
  await expect(page.getByRole("heading", { name: "Sign in as an operator" })).toBeVisible();
  await expect(page).toHaveURL(`${BASE}/signin/operator`);
  // Back to /signin: Log in / Register now opens the operator's page.
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForURL(`${BASE}/signin**`);
  await expect(page.getByRole("link", { name: "Log in / Register" })).toHaveAttribute("href", "/signin/operator");
  expect((await page.goto("/signin/farmer"))?.status()).toBe(404);
});

test("'Try the demo accounts' shows the demo people in place of the choices; the officer's opens their page", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: /Try the demo accounts/ }).click();
  await expect(page.getByRole("heading", { name: "Demo accounts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this account" })).toHaveCount(4);
  await expect(page.getByText("Demo", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Log in / Register" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("link", { name: "Log in / Register" })).toBeVisible();
  await page.getByRole("button", { name: /Try the demo accounts/ }).click();
  await page.getByRole("listitem").filter({ hasText: "District agriculture officer" }).getByRole("button", { name: "Use this account" }).click();
  await page.waitForURL(`${BASE}/proof`);
});

test("/signin and a role page pass the accessibility bar", async ({ browser }) => {
  for (const path of ["/signin", "/signin/helper"]) {
    for (const locale of ["en", "pa", "hi"]) {
      for (const theme of ["light", "dark"]) {
        for (const width of [360, 1280]) {
          const context = await browser.newContext({ viewport: { width, height: 900 } });
          await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
          await context.addInitScript((chosen) => {
            try {
              localStorage.setItem("theme", chosen);
            } catch {}
          }, theme);
          const page = await context.newPage();
          await page.goto(path);
          await page.locator("main h1").waitFor();
          // Open the demo accounts too, so they are checked as people see them.
          const demo = page.getByRole("button", { name: /Try the demo accounts|ਡੈਮੋ|डेमो/ });
          if (await demo.count()) await demo.click();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(500);
          const label = `${path} ${locale} ${theme} ${width}px`;
          const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)), `${label}: axe`).toEqual([]);
          const layout = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            small: [...document.querySelectorAll("main a, main button, main input:not([type=hidden])")]
              .filter((element) => {
                const box = element.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && !element.closest(".sr-only, [aria-hidden=true], [inert]") && (box.height < 44 || box.width < 44);
              })
              .map((element) => `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}"`),
          }));
          expect(layout.overflow, `${label}: sideways scroll`).toBeLessThanOrEqual(0);
          expect(layout.small, `${label}: touch targets`).toEqual([]);
          await context.close();
        }
      }
    }
  }
});
