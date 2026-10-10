"use client";

/**
 * The farmer pages' own small header (/farmer, /farmer/new, /farmer/signin): the mark, language and
 * theme, and "Sign out" once a phone session is known to exist. Farmers never see the staff top bar.
 */
import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandMark } from "./brand-mark";
import { LanguageMenu } from "./language-menu";
import { PAGE_FRAME } from "./page-shell";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui";

export function FarmerHeader({ signedIn = false }: { signedIn?: boolean }) {
  const tc = useTranslations("common");

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/");
  }

  return (
    <header className="border-b border-line bg-paper/95">
      <div className={`flex items-center gap-3 py-3 sm:py-4 ${PAGE_FRAME}`}>
        <BrandMark />
        <div className="ml-auto flex items-center gap-1">
          <LanguageMenu />
          <ThemeToggle />
          {signedIn ? (
            <Button variant="quiet" className="min-h-11" onClick={signOut}>
              <LogOut aria-hidden className="size-4" strokeWidth={1.75} />
              {tc("signOut")}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
