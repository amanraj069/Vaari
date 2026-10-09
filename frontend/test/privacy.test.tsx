/**
 * /privacy is public and complete in English, Hindi and Punjabi: every string comes from the
 * messages files (a missing key throws), the deletion section keeps its #deletion anchor and
 * offers email, the footer links the page, and nothing gates it behind sign-in or noindex.
 * The real route, signed out, is checked end to end in e2e/privacy.spec.ts.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import pa from "../messages/pa.json";
import { GlobalFooter } from "@/components/footer";
import { PrivacyNotice } from "@/components/privacy-notice";
import { PRIVATE_PAGE_SOURCES } from "@/lib/private-pages";
import { config as middlewareConfig } from "@/middleware";
import { renderWithIntl } from "./render";

const MESSAGES = { en, hi, pa } as const;
const LOCALES = ["en", "hi", "pa"] as const;
const EMAIL = "privacy@example.org";

describe("/privacy", () => {
  it("has the same privacy strings in every language", () => {
    const keys = Object.keys(en.privacy).sort();
    expect(Object.keys(hi.privacy).sort()).toEqual(keys);
    expect(Object.keys(pa.privacy).sort()).toEqual(keys);
  });

  for (const locale of LOCALES) {
    it(`renders every section, with #deletion and an email to ask for deletion (${locale})`, () => {
      const text = MESSAGES[locale].privacy;
      const { container } = renderWithIntl(<PrivacyNotice contactEmail={EMAIL} />, locale);
      expect(screen.getByRole("heading", { level: 1, name: text.title })).toBeInTheDocument();
      for (const title of [text.whoTitle, text.collectTitle, text.whyTitle, text.processorsTitle, text.accessTitle, text.retentionTitle, text.deletionTitle]) {
        expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
      }

      const deletion = container.querySelector<HTMLElement>("section#deletion");
      expect(deletion).not.toBeNull();
      expect(within(deletion!).getByRole("heading", { level: 2 })).toHaveTextContent(text.deletionTitle);
      const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent(text.emailSubject)}`;
      expect(within(deletion!).getByText(EMAIL)).toBeInTheDocument();
      expect(within(deletion!).getByRole("link", { name: text.deletionButton })).toHaveAttribute("href", mailto);
      expect(deletion).toHaveTextContent(text.deletionWhen);
      // The table of contents jumps straight to the deletion section.
      expect(screen.getByRole("link", { name: text.deletionTitle })).toHaveAttribute("href", "#deletion");
      // Hindi and Punjabi are not yet reviewed by a speaker; the page says so.
      expect(screen.queryByText(new RegExp(text.reviewNote))).toEqual(locale === "en" ? null : expect.anything());
    });

    it(`is linked from the footer (${locale})`, () => {
      renderWithIntl(<GlobalFooter contactEmail={EMAIL} />, locale);
      expect(screen.getByRole("link", { name: MESSAGES[locale].nav.privacy })).toHaveAttribute("href", "/privacy");
      expect(screen.getByRole("link", { name: MESSAGES[locale].common.contactLabel })).toHaveAttribute("href", `mailto:${EMAIL}`);
    });
  }

  it("needs no sign-in and is not marked private", () => {
    const gated = middlewareConfig.matcher.map((pattern) => pattern.replace(/\/:path\*$/, ""));
    expect(gated.some((prefix) => "/privacy".startsWith(prefix))).toBe(false);
    expect(PRIVATE_PAGE_SOURCES.some((source) => source.startsWith("/privacy"))).toBe(false);
  });
});
