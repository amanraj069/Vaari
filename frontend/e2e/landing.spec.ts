/**
 * The landing page follows the theme everywhere. Regression: its photo sections were pinned to the
 * night palette, so the theme toggle there looked dead (the hero and its icon never changed).
 */
import { expect, test } from "@playwright/test";

test("theme toggle on the landing page switches the whole page, hero included", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem("theme")) localStorage.setItem("theme", "light");
    } catch {}
  });
  await page.goto("/");
  const heading = page.locator("#hero-title");
  await heading.waitFor();
  const lightColour = await heading.evaluate((element) => getComputedStyle(element).color);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await page.locator("header .dark, main .dark").count()).toBe(0);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => heading.evaluate((element) => getComputedStyle(element).color)).not.toBe(lightColour);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect.poll(() => heading.evaluate((element) => getComputedStyle(element).color)).toBe(lightColour);
});
