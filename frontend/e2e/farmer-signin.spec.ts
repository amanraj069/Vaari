/**
 * A farmer on their own: registers on /farmer/signin with name, phone and consent, signs in with the
 * code (shown on screen in DEMO_MODE), books a field on /dashboard/book and sees it on /dashboard, with the
 * WhatsApp way in ("hey" to Vaari) beside it. Then both new pages pass the accessibility bar: axe
 * WCAG 2.1 A/AA, no sideways scroll, 44px touch targets, in English, Punjabi and Hindi, light and dark.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

const BASE = "http://localhost:3100";

/** A farmer new to Vaari: number, code (shown on screen in DEMO_MODE), then name and consent. */
async function register(page: Page, name: string, digits: string) {
  await page.goto("/farmer/signin");
  await page.getByRole("textbox", { name: /Mobile number/ }).fill(digits);
  await page.getByText(/I agree to get messages/).click();
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await expect(page.getByText("Demo: no WhatsApp message is sent")).toBeVisible();
  const code = (await page.getByTestId("demo-code").textContent())!.trim();
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Vaari" })).toBeVisible();
  await page.getByRole("textbox", { name: /Your name/ }).fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`${BASE}/dashboard`);
}

// Test numbers: +91 90000 00xxx. DEMO delivery sends nothing anywhere; the store is in memory.
test("a farmer signs up with a code, books a field and sees it on their page", async ({ page }) => {
  await register(page, "Gurpreet Singh", "9000000251");
  await expect(page.getByRole("heading", { name: "Sat Sri Akal, Gurpreet" })).toBeVisible();
  await expect(page.getByText("No bookings yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", "https://wa.me/910000000000?text=Sat%20Sri%20Akal");
  // The session lives in an httpOnly cookie: page scripts cannot read it.
  expect(await page.evaluate(() => document.cookie)).not.toContain("vaari_farmer");

  await page.getByRole("link", { name: "Book a new field" }).first().click();
  await page.waitForURL(`${BASE}/dashboard/book`);
  // The booking box keeps one size through every step and while the village list is searched (a
  // phone, 390px wide): Back and Next never move under the farmer's thumb.
  const ticket = page.locator("main section[aria-labelledby=ticket-title]");
  await page.locator("main fieldset button[aria-pressed]").first().waitFor();
  const heights = new Set<number>();
  const measure = async () => heights.add(Math.round((await ticket.boundingBox())!.height));
  await measure();
  await page.getByRole("textbox", { name: "Search villages" }).fill("no such village");
  await expect(page.getByText("No village by that name.")).toBeVisible();
  await measure();
  await page.getByRole("textbox", { name: "Search villages" }).fill("");
  await page.locator("main fieldset button[aria-pressed]").first().click();
  for (let step = 0; step < 4; step++) {
    if (step === 2) await page.getByRole("button", { name: /Today/ }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForTimeout(400);
    await measure();
  }
  expect([...heights], "the booking box changed size between steps").toHaveLength(1);
  await page.getByRole("button", { name: "Book this field" }).click();
  await expect(page.getByText("Your turn is booked")).toBeVisible();
  await page.getByRole("link", { name: "See my fields" }).click();
  await page.waitForURL(`${BASE}/dashboard`);
  await expect(page.getByRole("list", { name: "Your fields" }).getByRole("listitem")).toHaveCount(1);

  // Signing out (the account menu) ends the phone session.
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(`${BASE}/`);
  await page.goto("/farmer");
  await expect(page).toHaveURL(/\/farmer\/signin/);
});

async function signedInState(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await register(page, "Harpreet Kaur", "9000000252");
  const state = await context.storageState();
  await context.close();
  return state;
}

test("/farmer/signin and the farmer's /dashboard/book pass the accessibility bar", async ({ browser }) => {
  const session = await signedInState(browser);
  for (const target of [
    { path: "/farmer/signin", ready: "main section.auth-form form", signedIn: false },
    { path: "/dashboard/book", ready: "main fieldset", signedIn: true },
  ]) {
    for (const locale of ["en", "pa", "hi"]) {
      for (const theme of ["light", "dark"]) {
        for (const width of [360, 1280]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, storageState: target.signedIn ? session : undefined });
          await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
          await context.addInitScript((chosen) => {
            try {
              localStorage.setItem("theme", chosen);
            } catch {}
          }, theme);
          const page = await context.newPage();
          await page.goto(target.path);
          await page.locator(target.ready).first().waitFor();
          await page.waitForLoadState("networkidle");
          const label = `${target.path} ${locale} ${theme} ${width}px`;
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)), `${label}: axe`).toEqual([]);
          const layout = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            small: [...document.querySelectorAll("header a, header button, main a, main button, main input:not([type=hidden])")]
              .filter((element) => {
                const box = element.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && !element.closest(".sr-only, [aria-hidden=true]") && (box.height < 44 || box.width < 44);
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

test("the sign-in box keeps one size through every step and language; the phone too, where it shows", async ({ browser }) => {
  for (const width of [360, 1280]) {
    const sizes: string[] = [];
    for (const locale of ["en", "pa", "hi"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
      const page = await context.newPage();
      await page.goto("/farmer/signin");
      const box = page.locator("main section.auth-form");
      await box.locator("form").first().waitFor();
      const phone = page.locator("figure[role=img]");
      const measure = async () => {
        const boxSize = (await box.boundingBox())!;
        // On phones the picture of a phone is not shown at all.
        const phoneSize = width < 640 ? null : (await phone.boundingBox())!;
        if (width < 640) await expect(phone).toBeHidden();
        return `box ${Math.round(boxSize.width)}x${Math.round(boxSize.height)} phone ${phoneSize ? `${Math.round(phoneSize.width)}x${Math.round(phoneSize.height)}` : "hidden"}`;
      };
      sizes.push(await measure());
      // The code step once per width: sign-in codes are limited to 10 a minute per browser address,
      // and the three steps share one grid cell, so their language makes no difference to the box.
      if (locale === "en") {
        await page.locator("main input[type=tel]").fill(width < 640 ? "9000000301" : "9000000302");
        await page.locator("main section.auth-form label:has(input[type=checkbox])").first().click();
        await page.locator("main section.auth-form form button[type=submit]").first().click();
        await page.getByTestId("demo-code").waitFor();
        await page.waitForTimeout(500);
        sizes.push(await measure());
      }
      await context.close();
    }
    expect(new Set(sizes), `${width}px: ${sizes.join(" | ")}`).toHaveProperty("size", 1);
  }
});
