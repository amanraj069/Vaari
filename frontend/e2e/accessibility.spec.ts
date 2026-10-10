/**
 * Accessibility matrix for / (landing), /book, /slot/[token] (valid and tampered), /farmer (the
 * demo farmer's phone session), the operator's /operator and /operator/plan, /proof, /privacy and /design:
 * English, Punjabi, Hindi x light, dark x 360px, 1280px. Each combination must have zero axe
 * WCAG 2.1 A/AA violations, no sideways scroll, a single-row header, and 44px touch targets.
 * Plus keyboard use of the "I cannot wait longer" dialog and the reduced-motion setting.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

const LOCALES = ["en", "pa", "hi"] as const;
const THEMES = ["light", "dark"] as const;
const WIDTHS = [360, 1280] as const;
let slotPath = "";

// One demo sign-in per role, reused: the demo endpoint allows 20 sign-ins a minute (on purpose), and
// this matrix opens dozens of contexts.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

async function context(browser: Browser, options: { width: number; locale: string; theme: string; role?: string }): Promise<BrowserContext> {
  if (options.role && !sessions.has(options.role)) {
    const login = await browser.newContext();
    const response = await login.request.post("http://localhost:3100/api/auth/demo", { data: { role: options.role } });
    expect(response.ok()).toBe(true);
    // The farmer has no account: the answer is a one-time login link; following it sets the phone session.
    const { home } = (await response.json()) as { home: string };
    if (home.startsWith("/farmer/login/")) expect((await login.request.get(`http://localhost:3100${home}`)).ok()).toBe(true);
    sessions.set(options.role, await login.storageState());
    await login.close();
  }
  const created = await browser.newContext({
    viewport: { width: options.width, height: 900 },
    storageState: options.role ? sessions.get(options.role) : undefined,
  });
  await created.addCookies([{ name: "NEXT_LOCALE", value: options.locale, url: "http://localhost:3100" }]);
  await created.addInitScript((theme) => {
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }, options.theme);
  return created;
}

test.beforeAll(async ({ browser }) => {
  // One real booking gives a real slot link to check.
  const facilitator = await context(browser, { width: 1280, locale: "en", theme: "light", role: "facilitator" });
  const villages = (await (await facilitator.request.get("http://localhost:3100/api/proxy/villages")).json()) as { id: string }[];
  const booking = await facilitator.request.post("http://localhost:3100/api/proxy/fields", {
    data: { farmerName: "Manjit Kaur", farmerPhone: "+447700900124", consent: true, villageId: villages[0]!.id, acres: 2, readyDate: "2026-11-02", waitingLimitDays: 6 },
  });
  expect(booking.status()).toBe(201);
  slotPath = ((await booking.json()) as { slot: { path: string } }).slot.path;
  await facilitator.close();
});

const PAGES = [
  { name: "landing", role: undefined, path: () => "/", ready: "#hero-title" },
  { name: "book", role: "facilitator", path: () => "/book", ready: "main section" },
  { name: "slot", role: undefined, path: () => slotPath, ready: "text=/#\\d{3}/" },
  { name: "slot-tampered", role: undefined, path: () => `${slotPath.slice(0, -4)}AAAA`, ready: '[role="alert"] h1' },
  // A farmer's own fields, read-only, behind the demo farmer's phone session.
  { name: "farmer", role: "farmer", path: () => "/farmer", ready: "main h1" },
  // Operators work on laptops in the office and tablets in the field: the same bar applies.
  { name: "operator", role: "operator", path: () => "/operator", ready: "main h1" },
  { name: "operator-plan", role: "operator", path: () => "/operator/plan", ready: "main h1" },
  // The evidence page, rendered from the committed data/sim/results.json.
  { name: "proof", role: undefined, path: () => "/proof", ready: "#replay-title" },
  // Public, signed out: the privacy notice and its deletion section.
  { name: "privacy", role: undefined, path: () => "/privacy", ready: "#deletion" },
] as const;

for (const pageSpec of PAGES) {
  for (const locale of LOCALES) {
    test(`${pageSpec.name} in ${locale}: axe, overflow, header, touch targets`, async ({ browser }) => {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          const created = await context(browser, { width, locale, theme, role: pageSpec.role });
          const page = await created.newPage();
          await page.goto(pageSpec.path());
          await page.locator(pageSpec.ready).first().waitFor();
          await page.waitForLoadState("networkidle");
          // Let entrance animations finish (looping ones never do): mid-fade text has no fixed contrast to measure.
          await page.waitForFunction(() =>
            document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity),
          );
          const label = `${pageSpec.name} ${locale} ${theme} ${width}px`;

          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          expect(
            axe.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")} ${node.any[0]?.message ?? ""}`.slice(0, 220))),
            `${label}: axe`,
          ).toEqual([]);

          const layout = await page.evaluate(() => {
            const header = document.querySelector("header > div")!;
            const children = [...header.children].filter((child) => (child as HTMLElement).offsetParent !== null && child.tagName !== "NAV");
            // Compare vertical centres: items of different heights are centred, so their tops differ.
            const centres = children.map((child) => { const box = child.getBoundingClientRect(); return box.top + box.height / 2; });
            const small = [...document.querySelectorAll("header a, header button, main a, main button, main input:not([type=hidden])")]
              .filter((element) => {
                const box = element.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" && !element.closest(".sr-only, [aria-hidden=true]");
              })
              .filter((element) => {
                const box = element.getBoundingClientRect();
                return box.height < 44 || box.width < 44;
              })
              .map((element) => `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`);
            return {
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              headerRows: Math.max(...centres) - Math.min(...centres) > 16 ? 2 : 1,
              small,
            };
          });
          expect(layout.overflow, `${label}: sideways scroll`).toBeLessThanOrEqual(0);
          expect(layout.headerRows, `${label}: header rows`).toBe(1);
          expect(layout.small, `${label}: touch targets under 44px`).toEqual([]);
          await created.close();
        }
      }
    });
  }
}

test("proof: the method and sources card opens and closes, and opened it passes axe, overflow and touch targets", async ({ browser }) => {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const created = await context(browser, { width, locale, theme: "light" });
      const page = await created.newPage();
      await page.goto("/proof");
      const toggle = page.locator("#method-title");
      await toggle.waitFor();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#conversions-title")).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#conversions-title")).toBeVisible();
      // Let the opening fade finish: text mid-fade has no fixed contrast to measure.
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity));
      const label = `proof method ${locale} ${width}px`;
      const axe = await new AxeBuilder({ page }).include("#method-details").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), `${label}: axe`).toEqual([]);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        small: [...document.querySelectorAll("#method-details a, #method-title")]
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.width > 0 && (box.height < 44 || box.width < 44)).length,
      }));
      expect(layout.overflow, `${label}: sideways scroll`).toBeLessThanOrEqual(0);
      expect(layout.small, `${label}: touch targets under 44px`).toBe(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#conversions-title")).toBeHidden();
      await created.close();
    }
  }
});

test("design page renders every state in three languages with no axe violations", async ({ browser }) => {
  const created = await context(browser, { width: 1600, locale: "en", theme: "light" });
  const page = await created.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Vaari design system" })).toBeVisible();
  for (const language of ["English", "ਪੰਜਾਬੀ", "हिन्दी"]) await expect(page.getByRole("heading", { name: language, level: 2 })).toBeVisible();
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id} x${violation.nodes.length}`)).toEqual([]);
  // Missing translations, and any server/browser mismatch (e.g. dates rendered differently).
  expect(errors.filter((error) => /MISSING_MESSAGE|IntlError|[Hh]ydrat|did not match/.test(error))).toEqual([]);
  await created.close();
});

test("keyboard: open 'I cannot wait longer', change the value, Escape closes and returns focus", async ({ browser }) => {
  const created = await context(browser, { width: 390, locale: "en", theme: "light" });
  const page = await created.newPage();
  await page.goto(slotPath);
  const trigger = page.getByRole("button", { name: "I cannot wait longer" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "How long can you wait now?" });
  await expect(dialog).toBeVisible();
  const slider = dialog.getByRole("slider");
  await slider.focus();
  const before = await slider.inputValue();
  await page.keyboard.press("ArrowLeft");
  expect(Number(await slider.inputValue())).toBe(Number(before) - 1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await created.close();
});

test("reduced motion is respected", async ({ browser }) => {
  const created = await browser.newContext({ reducedMotion: "reduce" });
  const page = await created.newPage();
  await page.goto(slotPath);
  // The token number is on the slot page in every state (this booking is still a request).
  await page.locator("text=/#\\d{3}/").first().waitFor();
  const duration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "animate-pulse";
    document.body.appendChild(probe);
    return getComputedStyle(probe).animationDuration;
  });
  expect(parseFloat(duration)).toBeLessThan(0.001);
  await created.close();
});
