"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { meSchema } from "@/shared";
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
  const tr = useTranslations("roles");
  // Who is signed in, shown on every signed-in page.
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const body = (await response.json()) as { signedIn: boolean; me?: unknown };
      const parsed = meSchema.safeParse(body.me);
      return body.signedIn && parsed.success ? parsed.data : null;
    },
    enabled: signedIn,
    staleTime: 60_000,
  });
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
        {session.data ? (
          <span className="inline-flex items-center gap-1.5 text-sm" title={session.data.demo ? t("simulated") : undefined}>
            <UserRound aria-hidden className="size-4 text-ink-muted" strokeWidth={1.75} />
            <span className="font-medium">{session.data.name}</span>
            {session.data.role ? <span className="text-ink-muted">· {tr(session.data.role)}</span> : null}
          </span>
        ) : null}
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
