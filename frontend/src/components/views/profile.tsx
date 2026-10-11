"use client";

/**
 * /dashboard/profile: who you are in Vaari and the two settings that matter on a shared phone or
 * office laptop: language and light or dark. Staff see their role and machine centre (a demo
 * account says it is one); a farmer sees that Vaari knows them by their phone number and never
 * shows it to anyone else. Signing out is here too, not only in the menu.
 */
import { Check, FlaskConical, LogOut, Moon, Phone, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useTheme } from "@/contexts/theme-context";
import { viewerName, type Viewer } from "@/lib/viewer-kind";
import { signOut, useRoleLine } from "../account-menu";
import { Avatar } from "../avatar";
import { LANGUAGES, useChooseLanguage } from "../language-menu";
import { DashHeader } from "../dashboard/kit";
import { Button } from "../ui";
import { SeeAllMyFields } from "../whatsapp-link";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Choice({ selected, onClick, children, lang }: { selected: boolean; onClick: () => void; children: ReactNode; lang?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      lang={lang}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface hover:border-ink/50"}`}
    >
      {selected ? <Check aria-hidden className="size-4" strokeWidth={2.25} /> : null}
      {children}
    </button>
  );
}

export function ProfileView({ viewer, whatsappNumber }: { viewer: Viewer; whatsappNumber: string | null }) {
  const t = useTranslations("profile");
  const td = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { choose, pending } = useChooseLanguage();
  const { theme, selectTheme } = useTheme();
  const name = viewerName(viewer);
  const roleLine = useRoleLine(viewer);

  return (
    <>
      <DashHeader title={t("title")} />

      <section aria-labelledby="profile-who" className="mt-5 max-w-3xl rounded-card border border-line bg-surface p-4 sm:mt-6 sm:p-6">
        <div className="flex items-center gap-4">
          <Avatar name={name} />
          <div className="min-w-0">
            <h2 id="profile-who" className="truncate text-lg font-semibold sm:text-xl">
              {name ?? td("farmerNoName")}
            </h2>
            <p className="text-sm text-ink-muted">{roleLine}</p>
          </div>
        </div>
        <dl className="mt-4 divide-y divide-line border-t border-line">
          {viewer.kind === "staff" ? (
            <>
              <Row label={t("role")}>{viewer.me.role ? tr(viewer.me.role) : tn("setupPending")}</Row>
              {viewer.me.chcName ? <Row label={t("centre")}>{viewer.me.chcName}</Row> : null}
              {viewer.me.role === "officer" ? <Row label={t("access")}>{t("accessOfficer")}</Row> : null}
              {viewer.me.demo ? (
                <Row label={t("account")}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-muted/50 px-2.5 py-0.5 text-sm text-ink-muted">
                    <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
                    {tn("demoAccount")}
                  </span>
                </Row>
              ) : null}
            </>
          ) : (
            <Row label={t("phone")}>
              <p className="flex items-start gap-2 text-sm sm:text-base">
                <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-wheat-deep" strokeWidth={1.75} />
                <span>{t("phoneBody")}</span>
              </p>
              {whatsappNumber ? (
                <div className="mt-4 max-w-sm">
                  <SeeAllMyFields number={whatsappNumber} />
                </div>
              ) : null}
            </Row>
          )}
        </dl>
      </section>

      <section aria-labelledby="profile-settings" className="mt-4 max-w-3xl rounded-card border border-line bg-surface p-4 sm:mt-6 sm:p-6">
        <h2 id="profile-settings" className="text-base font-semibold">
          {t("settingsTitle")}
        </h2>
        <dl className="mt-2 divide-y divide-line">
          <Row label={tc("language")}>
            <div role="radiogroup" aria-label={tc("language")} className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
              {LANGUAGES.map((language) => (
                <Choice key={language.code} selected={language.code === locale} lang={language.code} onClick={() => language.code !== locale && void choose(language.code)}>
                  {language.label}
                </Choice>
              ))}
            </div>
            {locale !== "en" ? <p className="mt-2 text-xs text-ink-muted">{tc("unreviewedLanguage")}</p> : null}
          </Row>
          <Row label={t("appearance")}>
            <div role="radiogroup" aria-label={t("appearance")} className="flex flex-wrap gap-2">
              <Choice selected={theme !== "dark"} onClick={() => selectTheme("light")}>
                <Sun aria-hidden className="size-4" strokeWidth={1.75} />
                {t("light")}
              </Choice>
              <Choice selected={theme === "dark"} onClick={() => selectTheme("dark")}>
                <Moon aria-hidden className="size-4" strokeWidth={1.75} />
                {t("dark")}
              </Choice>
            </div>
          </Row>
        </dl>
      </section>

      <div className="mt-6 max-w-3xl">
        <Button variant="secondary" className="min-h-12 w-full sm:w-auto" onClick={() => void signOut()}>
          <LogOut aria-hidden className="size-4" strokeWidth={1.75} />
          {tc("signOut")}
        </Button>
      </div>
    </>
  );
}
