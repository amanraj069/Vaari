"use client";

/** Compact language choice for the top bar: current language on the button, all three in the menu. */
import { Check, ChevronDown, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Dropdown, MENU_ITEM_CLASS } from "./dropdown";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "hi", label: "हिन्दी" },
] as const;

export function LanguageMenu() {
  const locale = useLocale();
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = LANGUAGES.find((language) => language.code === locale) ?? LANGUAGES[0];

  async function choose(code: string) {
    await fetch("/api/locale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: code }) });
    startTransition(() => router.refresh());
  }

  return (
    <Dropdown
      label={t("languageMenu")}
      panelClassName="w-44"
      buttonClassName={`inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm text-ink hover:bg-ink/5 aria-expanded:bg-ink/5 ${pending ? "opacity-60" : ""}`}
      buttonContent={
        <>
          <Languages aria-hidden className="size-[18px] text-ink-muted" strokeWidth={1.75} />
          <span lang={current.code} className="hidden sm:inline">{current.label}</span>
          <ChevronDown aria-hidden className="hidden size-3.5 text-ink-muted sm:block" strokeWidth={2} />
        </>
      }
    >
      {(close) =>
        LANGUAGES.map((language) => (
          <button
            key={language.code}
            type="button"
            role="menuitemradio"
            aria-checked={language.code === locale}
            lang={language.code}
            onClick={() => {
              close();
              if (language.code !== locale) void choose(language.code);
            }}
            className={MENU_ITEM_CLASS}
          >
            <span className="flex-1">{language.label}</span>
            {language.code === locale ? <Check aria-hidden className="size-4 text-field" strokeWidth={2.25} /> : null}
          </button>
        ))
      }
    </Dropdown>
  );
}
