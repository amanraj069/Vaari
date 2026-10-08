"use client";

/** The signed-in person: initials on the top bar; name, role and sign-out in the menu. */
import { ArrowRight, FlaskConical, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Me } from "@/shared";
import { Dropdown, MENU_ITEM_CLASS } from "./dropdown";

const ROLE_HOME: Record<string, string> = { farmer: "/farmer", facilitator: "/book", operator: "/operator", officer: "/proof" };

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0]];
  return letters.filter(Boolean).join("").toUpperCase() || "?";
}

export function AccountMenu({ me }: { me: Me }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const pathname = usePathname();
  const home = me.needsOnboarding || !me.role ? "/welcome" : (ROLE_HOME[me.role] ?? "/");
  const awayFromHome = !pathname.startsWith(home);

  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const { redirect } = (await response.json()) as { redirect: string };
    window.location.href = redirect;
  }

  return (
    <Dropdown
      label={t("accountMenu")}
      buttonClassName="grid size-11 place-items-center rounded-full bg-wheat-soft text-sm font-semibold text-ink ring-offset-2 ring-offset-paper hover:ring-2 hover:ring-line-strong aria-expanded:ring-2 aria-expanded:ring-wheat"
      buttonContent={<span aria-hidden>{initials(me.name)}</span>}
    >
      {(close) => (
        <>
          <div className="px-2.5 pb-2.5 pt-2">
            <p className="truncate font-medium">{me.name}</p>
            <p className="text-sm text-ink-muted">{me.role ? tr(me.role) : t("setupPending")}</p>
            {me.demo ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-muted/50 px-2 py-0.5 text-xs text-ink-muted">
                <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
                {t("demoAccount")}
              </p>
            ) : null}
          </div>
          <div className="my-1 border-t border-line" />
          {awayFromHome ? (
            <Link href={home} role="menuitem" onClick={close} className={MENU_ITEM_CLASS}>
              <ArrowRight aria-hidden className="size-4 text-ink-muted" strokeWidth={1.75} />
              {t("goToMyPage")}
            </Link>
          ) : null}
          <button type="button" role="menuitem" onClick={signOut} className={MENU_ITEM_CLASS}>
            <LogOut aria-hidden className="size-4 text-ink-muted" strokeWidth={1.75} />
            {tc("signOut")}
          </button>
        </>
      )}
    </Dropdown>
  );
}
