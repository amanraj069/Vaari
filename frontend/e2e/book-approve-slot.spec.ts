/**
 * The facilitator -> operator -> farmer loop through the real UI and API:
 * a facilitator books a field on /book and gets a slot link; the operator approves tomorrow's plan;
 * the farmer opens the link with no account and sees a firm date. axe checks /book and /slot.
 * The field is 1 acre so it fits tomorrow's capacity and the planner can promise a firm date; a
 * larger field in this crowded demo season gets a window instead, which approval does not firm
 * until its day is within two days (that is the product rule, not a test shortcut).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function signedInPage(browser: Browser, role: "facilitator" | "operator"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/signin");
  const response = await page.request.post("/api/auth/demo", { data: { role } });
  expect(response.ok()).toBe(true);
  return page;
}

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("facilitator books, operator approves, slot link shows a firm date", async ({ browser }) => {
  // 1. Facilitator books a field for a farmer without an account.
  const facilitator = await signedInPage(browser, "facilitator");
  await facilitator.goto("/book");
  await expect(facilitator.getByRole("heading", { name: "Book a field for a farmer" })).toBeVisible();
  await expect(facilitator.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Book a field"]);
  await expectNoAxeViolations(facilitator);

  const next = () => facilitator.getByRole("button", { name: "Next", exact: true }).click();
  await facilitator.getByRole("textbox", { name: /Farmer's name/ }).fill("Paramjit Kaur");
  await next();
  await facilitator.getByRole("button", { name: "Balian", exact: true }).click();
  await next();
  // 1 acre: small enough to fit tomorrow's capacity, so the planner can promise a firm date.
  for (let click = 0; click < 4; click += 1) await facilitator.getByRole("button", { name: "Less" }).click();
  await expect(facilitator.locator("output")).toHaveText("1");
  await next();
  await facilitator.getByRole("button", { name: /Tomorrow/ }).click();
  await next();
  await facilitator.getByRole("slider", { name: "Waiting" }).fill("3");
  await next();
  await facilitator.getByRole("button", { name: "Book and get the link" }).click();
  await expect(facilitator.getByRole("heading", { name: "Booked for Paramjit Kaur" })).toBeVisible();
  const slotUrl = await facilitator.getByRole("textbox").inputValue();
  expect(slotUrl).toMatch(/\/slot\/[\w.-]+$/);
  await expect(facilitator.getByRole("listitem").filter({ hasText: "Paramjit Kaur" })).toBeVisible();

  // 2. The operator approves tomorrow's plan.
  const operator = await signedInPage(browser, "operator");
  await operator.goto("/operator");
  await operator.getByRole("button", { name: "Approve plan" }).click();
  await expect(operator.getByText("Approved", { exact: true })).toBeVisible();

  // 3. The farmer opens the link, no account, and sees a firm date (only the promise is shown).
  const farmer = await (await browser.newContext()).newPage();
  await farmer.goto(slotUrl);
  await expect(farmer.getByText("The machine comes on")).toBeVisible();
  // The page shows exactly the date the backend promised (the solver may pick 1 or 2 November).
  const token = new URL(slotUrl).pathname.split("/").pop()!;
  const slot = (await (await farmer.request.get(`/api/proxy/slot/${token}`)).json()) as { promise: { kind: string; date?: string } | null };
  expect(slot.promise?.kind).toBe("firm");
  const promised = new Date(`${slot.promise!.date}T00:00:00Z`);
  // English dates are day-first (Indian usage): "Sunday", "1 November".
  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(promised);
  const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", timeZone: "UTC" }).format(promised);
  await expect(farmer.getByText(weekday, { exact: true })).toBeVisible();
  await expect(farmer.getByText(dayMonth, { exact: true })).toBeVisible();
  await expect(farmer.getByText("Firm date").first()).toBeVisible();
  await expect(farmer.getByRole("list", { name: "Progress of this turn" }).locator('[aria-current="step"]')).toContainText("Planned");
  await expect(farmer.getByRole("heading", { name: "Why this date" })).toBeVisible();
  await expect(farmer.getByText("Simulated season, real fire timing")).toBeVisible();
  await expectNoAxeViolations(farmer);

  // A tampered link says so, without sending the farmer to a sign-in page.
  await farmer.goto(`${slotUrl.slice(0, -4)}AAAA`);
  // (Next.js also renders an empty route-announcer alert; pick ours by its text.)
  await expect(farmer.getByRole("alert").filter({ hasText: "This link does not work" })).toBeVisible();
  expect(new URL(farmer.url()).pathname).toMatch(/^\/slot\//);
  await expectNoAxeViolations(farmer);
});
