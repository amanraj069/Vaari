"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "./language-switcher";

export function Wordmark() {
  return (
    <Link href="/" className="group inline-flex items-baseline gap-2" aria-label="Vaari home">
      <span className="font-display text-2xl font-semibold tracking-tight">Vaari</span>
      <span lang="pa" className="text-lg text-wheat-deep">ਵਾਰੀ</span>
    </Link>
  );
}

export function TopBar({ children, signedIn = false }: { children?: React.ReactNode; signedIn?: boolean }) {
  const t = useTranslations("common");
  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const { redirect } = (await response.json()) as { redirect: string };
    window.location.href = redirect;
  }
  return (
    <header className="border-b border-line bg-paper/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Wordmark />
        <nav className="flex flex-1 items-center gap-1">{children}</nav>
        <LanguageSwitcher />
        {signedIn ? (
          <button type="button" onClick={signOut} className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] px-2 text-sm text-ink-muted hover:text-ink">
            <LogOut aria-hidden className="size-4" strokeWidth={1.75} />
            {t("signOut")}
          </button>
        ) : null}
      </div>
    </header>
  );
}
