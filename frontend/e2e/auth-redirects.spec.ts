/**
 * Signed-in people never see the sign-in page, and a stale role cookie can never cause a redirect
 * loop: /signin and /welcome hand off to /api/auth/resume, which asks the API and fixes the cookie.
 */
import { expect, test, type BrowserContext } from "@playwright/test";

const BASE = "http://localhost:3100";

async function signIn(context: BrowserContext, role: string) {
  const response = await context.request.post(`${BASE}/api/auth/demo`, { data: { role } });
  expect(response.ok()).toBe(true);
}

for (const [role, home] of [["farmer", "/farmer"], ["operator", "/operator"], ["facilitator", "/book"]] as const) {
  test(`signed-in ${role} opening /signin lands on ${home}`, async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context, role);
    const page = await context.newPage();
    await page.goto("/signin");
    await expect(page).toHaveURL(`${BASE}${home}`);
    await context.close();
  });
}

test("a stale 'pending' role cookie after onboarding does not loop", async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context, "farmer");
  // Simulate the cookie left over from a first Google sign-in, before onboarding finished.
  await context.addCookies([{ name: "vaari_role", value: "pending", url: BASE }]);
  const page = await context.newPage();
  for (const start of ["/welcome", "/farmer"]) {
    await page.goto(start);
    await expect(page).toHaveURL(`${BASE}/farmer`);
  }
  const role = (await context.cookies(BASE)).find((cookie) => cookie.name === "vaari_role")?.value;
  expect(role).toBe("farmer");
  await context.close();
});

test("signed-out visitors still see the sign-in page", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in to Vaari" })).toBeVisible();
});
