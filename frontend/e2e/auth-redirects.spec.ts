/**
 * Signed-in people never see the sign-in page, and a stale role cookie can never cause a redirect
 * loop: /signin and /welcome hand off to /api/auth/resume, which asks the API and fixes the cookie.
 * Farmers have no account: "Try as farmer" follows a one-time phone login link to /farmer, and that
 * link works once.
 */
import { expect, test, type BrowserContext } from "@playwright/test";

const BASE = "http://localhost:3100";

async function signIn(context: BrowserContext, role: string) {
  const response = await context.request.post(`${BASE}/api/auth/demo`, { data: { role } });
  expect(response.ok()).toBe(true);
}

for (const [role, home] of [["operator", "/operator"], ["facilitator", "/book"]] as const) {
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
  await signIn(context, "facilitator");
  // Simulate the cookie left over from a first Google sign-in, before onboarding finished.
  await context.addCookies([{ name: "vaari_role", value: "pending", url: BASE }]);
  const page = await context.newPage();
  for (const start of ["/welcome", "/book"]) {
    await page.goto(start);
    await expect(page).toHaveURL(`${BASE}/book`);
  }
  const role = (await context.cookies(BASE)).find((cookie) => cookie.name === "vaari_role")?.value;
  expect(role).toBe("facilitator");
  await context.close();
});

test("the demo farmer opens /farmer from a one-time login link, which then stops working", async ({ browser }) => {
  const context = await browser.newContext();
  const answer = await context.request.post(`${BASE}/api/auth/demo`, { data: { role: "farmer" } });
  const { home } = (await answer.json()) as { home: string };
  expect(home).toMatch(/^\/farmer\/login\/[\w.-]+$/);
  const page = await context.newPage();
  const response = await page.goto(home);
  await expect(page).toHaveURL(`${BASE}/farmer`);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: /Jaswinder/ })).toBeVisible();
  await expect(page.getByText("Balian Cooperative Society")).toBeVisible();
  // The session cookie is httpOnly: the page itself cannot read it.
  const cookie = (await context.cookies(BASE)).find((item) => item.name === "vaari_farmer");
  expect(cookie?.httpOnly).toBe(true);
  // The same link a second time (another device, a forwarded message): refused, with a way back.
  const other = await (await browser.newContext()).newPage();
  await other.goto(home);
  await expect(other).toHaveURL(`${BASE}/farmer?link=expired`);
  await expect(other.getByText("This link has already been used or has expired")).toBeVisible();
  await expect(other.getByRole("link", { name: "See all my fields" })).toHaveAttribute("href", "https://wa.me/910000000000?text=my%20fields");
  await context.close();
});

test("/farmer without a phone session says how to get a link, never 'sign in'", async ({ page }) => {
  await page.goto("/farmer");
  await expect(page.getByText("Open your link from WhatsApp")).toBeVisible();
  await expect(page).toHaveURL(`${BASE}/farmer`);
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
});

test("signed-out visitors still see the sign-in page", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in to Vaari" })).toBeVisible();
});
