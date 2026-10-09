/**
 * /privacy and /privacy#deletion open for anyone, signed out, in English, Hindi and Punjabi: no
 * redirect to sign-in, the whole notice in the server HTML (what a crawler reads), indexable (no
 * noindex header or meta), and the #deletion anchor lands on the deletion section.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3100";
const LOCALES = ["en", "hi", "pa"] as const;
type PrivacyMessages = Record<string, string>;
const messages = (locale: string) =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname,`../messages/${locale}.json`), "utf8")) as { privacy: PrivacyMessages; nav: PrivacyMessages };

for (const locale of LOCALES) {
  test(`/privacy and /privacy#deletion render signed out (${locale})`, async ({ browser }) => {
    const { privacy, nav } = messages(locale);
    // No session cookies at all: only the language choice.
    const context = await browser.newContext();
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);

    // What a crawler gets: a 200 with the notice in the HTML, and nothing saying "do not index".
    const raw = await context.request.get(`${BASE}/privacy`, { maxRedirects: 0 });
    expect(raw.status()).toBe(200);
    expect(raw.headers()["x-robots-tag"]).toBeUndefined();
    const html = await raw.text();
    for (const text of [privacy.title, privacy.deletionTitle, privacy.deletionWhen]) expect(html).toContain(text);
    expect(html).toContain('id="deletion"');
    expect(html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);

    const page = await context.newPage();
    await page.goto("/privacy");
    await expect(page).toHaveURL(`${BASE}/privacy`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1, name: privacy.title })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index, follow/);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: nav.privacy })).toHaveAttribute("href", "/privacy");

    await page.goto("/privacy#deletion");
    await expect(page).toHaveURL(`${BASE}/privacy#deletion`);
    const deletion = page.locator("section#deletion");
    await expect(deletion.getByRole("heading", { level: 2, name: privacy.deletionTitle })).toBeInViewport();
    await expect(deletion.getByRole("link", { name: privacy.deletionButton })).toHaveAttribute("href", /^mailto:[^?]+@[^?]+\?subject=/);
    await context.close();
  });
}
