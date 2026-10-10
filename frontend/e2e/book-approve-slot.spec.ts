/**
 * The vertical slice through the real UI and API, start to finish:
 *   a facilitator books a field on /dashboard/book and gets the farmer's slot link -> the link says
 *   "Requested" (no date until a plan is published) -> the operator sees the new request on
 *   /dashboard, makes tomorrow's plan on /dashboard/plan, reads that this farmer gets a first date,
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
  // Let the page's fade-in (and any entrance animation) finish: text mid-fade has no fixed contrast.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("facilitator books, operator generates and approves, the slot link shows a firm date", async ({ browser }) => {
  // 1. A facilitator books a field for a farmer without an account.
  const facilitator = await signedInPage(browser, "facilitator");
  await facilitator.goto("/dashboard/book");
  await expect(facilitator.getByRole("heading", { name: "Book a field for a farmer" })).toBeVisible();
  // A helper's dashboard: their bookings, booking, and the proof (the phone's bottom bar).
  await expect(facilitator.getByRole("navigation", { name: "Dashboard pages" }).getByRole("link")).toHaveText(["Bookings", "Book a field", "Proof"]);

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
  await operator.goto("/dashboard");
  await expect(operator.getByText(/\d+ new requests? (has|have) no date yet\./)).toBeVisible();
  // One call to action per state: the request card carries the only "Plan tomorrow".
  await expect(operator.getByRole("main").getByRole("link", { name: "Plan tomorrow" })).toHaveCount(1);
  await operator.getByRole("main").getByRole("link", { name: "Plan tomorrow" }).click();
  await expect(operator).toHaveURL(/\/dashboard\/plan$/);
  await expect(operator.getByRole("button", { name: "Make a fresh plan" })).toHaveCount(1);
  await operator.getByRole("button", { name: "Make a fresh plan" }).click();
  // The draft says exactly what approving will do, before anything is published.
  await expect(operator.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(operator.getByText("Nothing changes for farmers until you approve.", { exact: false })).toBeVisible();
  // One decision bar: the consequences in one line, the Approve button beside them, each farmer one click away.
  const approving = operator.getByRole("region", { name: "What approving does" });
  await expect(approving.getByText(/farmers? gets? a first date/).first()).toBeVisible();
  await approving.getByText("See every farmer this changes").click();
  const firstDates = approving.locator("details").filter({ hasText: /farmers? gets? a first date/ });
  if (!(await approving.getByText("Paramjit Kaur").isVisible())) await firstDates.locator("summary").click();
  await expect(approving.getByText("Paramjit Kaur")).toBeVisible();
  await expectNoAxeViolations(operator);
  // Still nothing for the farmer: a draft is not a promise.
  const beforeApproval = (await (await farmer.request.get(`/api/proxy/slot/${token}`)).json()) as { status: string };
  expect(beforeApproval.status).toBe("requested");

  // Approving lives only under "What approving does": decide after seeing the consequences.
  await expect(operator.getByRole("button", { name: "Approve and publish" })).toHaveCount(1);
  await operator.getByRole("button", { name: "Approve and publish" }).click();
  await expect(operator.getByText(/Published by Harpal Singh/)).toBeVisible();

  // 4. The farmer's link now shows exactly what the backend promised: a firm date within two days,
  // or, when those days are full, a window that ends by the farmer's last waiting day.
  await farmer.reload();
  const slot = (await (await farmer.request.get(`/api/proxy/slot/${token}`)).json()) as {
    id: string;
    status: string;
    burnDeadlineDate: string;
    promise: { kind: "firm"; date: string } | { kind: "window"; startDate: string; endDate: string } | null;
  };
  expect(slot.promise).not.toBeNull();
  // English dates are day-first (Indian usage): "Sunday", "1 November".
  const longDate = (iso: string) => {
    const date = new Date(`${iso}T00:00:00Z`);
    return {
      weekday: new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(date),
      dayMonth: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", timeZone: "UTC" }).format(date),
    };
  };
  if (slot.promise!.kind === "firm") {
    expect(slot.status).toBe("firm");
    await expect(farmer.getByText("The machine comes on")).toBeVisible();
    const { weekday, dayMonth } = longDate(slot.promise!.date);
    await expect(farmer.getByText(weekday, { exact: true })).toBeVisible();
    await expect(farmer.getByText(dayMonth, { exact: true })).toBeVisible();
    await expect(farmer.getByText("Firm date").first()).toBeVisible();
    // The plain reason names the machine and the stop.
    await expect(farmer.getByText(/comes to Balian on .*Your field is stop \d+ of \d+ that day\./)).toBeVisible();
  } else {
    expect(slot.status).toBe("window");
    expect(slot.promise!.endDate <= slot.burnDeadlineDate).toBe(true);
    await expect(farmer.getByText("The machine comes between")).toBeVisible();
    const start = longDate(slot.promise!.startDate);
    const end = longDate(slot.promise!.endDate);
    await expect(farmer.getByText(`Your turn is between ${start.weekday}, ${start.dayMonth} and ${end.weekday}, ${end.dayMonth}.`, { exact: false })).toBeVisible();
  }
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
  await facilitator.goto("/dashboard");
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
