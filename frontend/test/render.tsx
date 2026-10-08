import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import pa from "../messages/pa.json";
import { ToastProvider } from "@/components/toast";

const MESSAGES = { en, pa, hi } as const;

/** Renders with the real messages; a missing key throws instead of silently showing the key. */
export function renderWithIntl(ui: ReactElement, locale: keyof typeof MESSAGES = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone="Asia/Kolkata"
      onError={(error) => {
        throw error;
      }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}
