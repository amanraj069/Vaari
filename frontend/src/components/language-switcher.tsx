"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "hi", label: "हिन्दी" },
] as const;

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function choose(code: string) {
    await fetch("/api/locale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: code }) });
    startTransition(() => router.refresh());
  }

  return (
    <div role="group" aria-label={t("language")} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface p-0.5">
      <Languages aria-hidden className="ml-2 size-4 text-ink-muted" strokeWidth={1.75} />
      {LANGUAGES.map((language) => (
        <button
          key={language.code}
          type="button"
          lang={language.code}
          aria-pressed={locale === language.code}
          disabled={pending}
          onClick={() => choose(language.code)}
          className={`min-h-9 rounded-full px-3 text-sm transition-colors ${
            locale === language.code ? "bg-ink text-paper" : "text-ink hover:bg-ink/5"
          }`}
        >
          {language.label}
        </button>
      ))}
    </div>
  );
}
