/**
 * The vertical slice through the real UI and API, start to finish:
 *   a facilitator books a field on /book and gets the farmer's slot link -> the link says
 *   "Requested" (no date until a plan is published) -> the operator sees the new request on
 *   /operator, makes tomorrow's plan on /operator/plan, reads that this farmer gets a first date,
 *   and approves -> the farmer opens the link with no account and sees a firm date -> the helper
 *   reissues the link from the booked list and the old one stops working.
 * The booking carries the farmer's phone and consent; the phone never appears on the slot page.
 * The field is 1 acre and ready tomorrow, so it fits tomorrow's capacity and the first promise is
 * firm (a date within two days is promised firm; later dates start as a window). axe checks the
 * slot page in both states and the plan page.
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

test("facilitator books, operator generates and approves, the slot link shows a firm date", async ({ browser }) => {
  // 1. A facilitator books a field for a farmer without an account.
  const facilitator = await signedInPage(browser, "facilitator");
  await facilitator.goto("/book");
  await expect(facilitator.getByRole("heading", { name: "Book a field for a farmer" })).toBeVisible();
  await expect(facilitator.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Book a field"]);

  const next = () => facilitator.getByRole("button", { name: "Next", exact: true }).click();
  await facilitator.getByRole("textbox", { name: /Farmer's name/ }).fill("Paramjit Kaur");
  await next();
  // A placeholder number from Ofcom's range reserved for fiction: never a real person.
  await facilitator.getByRole("textbox", { name: /mobile number/ }).fill("+44 7700 900123");
  await facilitator.getByText(/Paramjit Kaur agrees to get messages/).click();
  await next();
  await facilitator.getByRole("button", { name: "Balian", exact: true }).click();
  await next();
  for (let click = 0; click < 4; click += 1) await facilitator.getByRole("button", { name: "Less" }).click();
  await expect(facilitator.locator("output")).toHaveText("1");
  await next();
  await facilitator.getByRole("button", { name: /Tomorrow/ }).click();
  await next();
  await facilitator.getByRole("slider", { name: "Waiting" }).fill("3");
  await next();
  // The confirmation step shows everything before booking.
  await expect(facilitator.getByRole("heading", { name: "Check before booking" })).toBeVisible();
  await facilitator.getByRole("button", { name: "Book and get the link" }).click();
  await expect(facilitator.getByRole("heading", { name: "Booked for Paramjit Kaur" })).toBeVisible();
  const slotUrl = await facilitator.getByRole("textbox").inputValue();
  expect(slotUrl).toMatch(/\/slot\/[\w.-]+$/);
  const token = new URL(slotUrl).pathname.split("/").pop()!;

  // 2. Until a plan is published, the farmer's link says "Requested" and promises nothing.
  const farmer = await (await browser.newContext()).newPage();
  const opened = await farmer.goto(slotUrl);
  // A slot link is private: no indexing, no referrer, as headers and as page metadata.
  expect(opened?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(opened?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(await farmer.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  expect(await farmer.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
  await expect(farmer.getByText("Your request is in")).toBeVisible();
  await expect(farmer.getByRole("link", { name: "See all my fields" })).toHaveAttribute("href", "https://wa.me/910000000000?text=my%20fields");
  expect(await farmer.locator("body").innerText()).not.toMatch(/7700\s?900\s?123/);
  await expect(farmer.getByText("Requested").first()).toBeVisible();
  await expect(farmer.getByText("Firm date")).toHaveCount(0);
  await expect(farmer.getByRole("list", { name: "Progress of this turn" }).locator('[aria-current="step"]')).toContainText("Booked");
  await expectNoAxeViolations(farmer);

  // 3. The operator sees the new request on today's board and plans tomorrow.
  const operator = await signedInPage(browser, "operator");
  await operator.goto("/operator");
  await expect(operator.getByText(/\d+ new requests? (has|have) no date yet\./)).toBeVisible();
  await operator.getByRole("main").getByRole("link", { name: "Plan tomorrow" }).last().click();
  await expect(operator).toHaveURL(/\/operator\/plan$/);
  await operator.getByRole("button", { name: "Make a fresh plan" }).first().click();
  // The draft says exactly what approving will do, before anything is published.
  await expect(operator.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(operator.getByText("Nothing changes for farmers until you approve.", { exact: false })).toBeVisible();
  await expect(operator.getByText(/farmers? gets? a first date/)).toBeVisible();
  await expect(operator.getByRole("complementary", { name: "What approving does" }).getByText("Paramjit Kaur")).toBeVisible();
  await expectNoAxeViolations(operator);
  // Still nothing for the farmer: a draft is not a promise.
  const beforeApproval = (await (await farmer.request.get(`/api/proxy/slot/${token}`)).json()) as { status: string };
  expect(beforeApproval.status).toBe("requested");

  await operator.getByRole("button", { name: "Approve and publish" }).click();
  await expect(operator.getByText(/Published by Harpal Singh/)).toBeVisible();

  // 4. The farmer's link now shows a firm date: exactly the date the backend promised.
  await farmer.reload();
  await expect(farmer.getByText("The machine comes on")).toBeVisible();
  const slot = (await (await farmer.request.get(`/api/proxy/slot/${token}`)).json()) as { id: string; status: string; promise: { kind: string; date?: string } | null };
  expect(slot.status).toBe("firm");
  expect(slot.promise?.kind).toBe("firm");
  const promised = new Date(`${slot.promise!.date}T00:00:00Z`);
  // English dates are day-first (Indian usage): "Sunday", "1 November".
  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(promised);
  const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", timeZone: "UTC" }).format(promised);
  await expect(farmer.getByText(weekday, { exact: true })).toBeVisible();
  await expect(farmer.getByText(dayMonth, { exact: true })).toBeVisible();
  await expect(farmer.getByText("Firm date").first()).toBeVisible();
  // The plain reason names the machine and the stop.
  await expect(farmer.getByText(/comes to Balian on .*Your field is stop \d+ of \d+ that day\./)).toBeVisible();
  await expect(farmer.getByRole("list", { name: "Progress of this turn" }).locator('[aria-current="step"]')).toContainText("Planned");
  await expect(farmer.getByRole("heading", { name: "Why this date" })).toBeVisible();
  await expect(farmer.getByText("Simulated season, real fire timing")).toBeVisible();
  await expectNoAxeViolations(farmer);

  // A tampered link says so, without sending the farmer to a sign-in page.
  await farmer.goto(`${slotUrl.slice(0, -4)}AAAA`);
  // (Next.js also renders an empty route-announcer alert; pick ours by its text.)
  await expect(farmer.getByRole("alert").filter({ hasText: "This link does not work" })).toBeVisible();
  expect(new URL(farmer.url()).pathname).toMatch(/^\/slot\//);

  // 5. The helper gives the farmer a new link: the old one stops working, the new one opens.
  await facilitator.goto("/book");
  await facilitator.getByRole("button", { name: "New link for Paramjit Kaur" }).first().click();
  await facilitator.getByRole("button", { name: "Make a new link and copy it" }).click();
  // (Copied, or made but not copied when the headless clipboard refuses: either way the old link is dead.)
  await expect(facilitator.getByText(/New link (copied|made)/)).toBeVisible();
  await farmer.goto(slotUrl);
  await expect(farmer.getByRole("alert").filter({ hasText: "This link does not work" })).toBeVisible();
  const reissued = (await (await facilitator.request.get(`/api/proxy/fields/${slot.id}/slot-link`)).json()) as { path: string };
  await farmer.goto(reissued.path);
  await expect(farmer.getByText("The machine comes on")).toBeVisible();
});
