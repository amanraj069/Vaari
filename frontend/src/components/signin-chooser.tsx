"use client";

/**
 * The content half of /signin, for two audiences in the same kind of card. The small label names the
 * audience; the card says only what to do, so nothing is said twice: farmers (sign in with
 * WhatsApp), then village helpers, operators and officers ("Log in / Register",
 * full width, which opens their sign-in page where they pick the role; then "or"; then Continue with
 * Google). At the bottom, pinned to the picture's bottom edge, "Try the demo accounts" swaps this
 * whole section for the demo people, with a way back. "Log in / Register" opens the role last used
 * (from the address, ?pick=<role>, or this browser), else village helper.
 */
import { ArrowLeft, ChevronRight, KeyRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DemoAccounts, type DemoPerson } from "./demo-accounts";
import { GoogleSignIn, OrDivider } from "./google-sign-in";
import { ROLE_STORAGE_KEY } from "./staff-auth-card";
import { isStaffRole, type StaffRole } from "./staff-signin-panel";
import { Button, ButtonLink } from "./ui";
import { WhatsAppSignInCard } from "./whatsapp-signin-card";

const SECTION = "rounded-card border border-line bg-surface p-4 sm:p-5";
const EASE = [0.22, 1, 0.36, 1] as const;

/** A small label over each audience's card; uppercase and letter-spacing only for Latin script. */
function Eyebrow({ id, children }: { id: string; children: string }) {
  const latin = useLocale() === "en";
  return (
    <p
      id={id}
      className={`mb-2 text-xs font-medium text-wheat-deep ${latin ? "uppercase tracking-[0.14em]" : ""}`}
    >
      {children}
    </p>
  );
}

export function SignInChooser({
  people,
  googleOn,
  initialPick = null,
}: {
  people: DemoPerson[];
  googleOn: boolean;
  initialPick?: StaffRole | null;
}) {
  const t = useTranslations("signin");
  const [view, setView] = useState<"main" | "demo">("main");
  const [lastRole, setLastRole] = useState<StaffRole | null>(initialPick);
  const addressPick = useSearchParams().get("pick");
  useEffect(() => {
    if (isStaffRole(addressPick)) return setLastRole(addressPick);
    try {
      const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
      if (isStaffRole(saved)) setLastRole((current) => current ?? saved);
    } catch {}
  }, [addressPick]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "main" ? (
        <motion.div
          key="main"
          className="flex h-full flex-col"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <section aria-labelledby="signin-farmers">
            <Eyebrow id="signin-farmers">{t("eyebrowFarmers")}</Eyebrow>
            <WhatsAppSignInCard />
          </section>

          <section aria-labelledby="signin-staff" className="mt-5 sm:mt-6">
            <Eyebrow id="signin-staff">{t("eyebrowStaff")}</Eyebrow>
            <div className={SECTION}>
              <ButtonLink
                href={`/signin/${lastRole ?? "helper"}`}
                variant="accent"
                className="min-h-12 w-full"
              >
                <KeyRound aria-hidden className="size-5" strokeWidth={1.75} />
                {t("loginRegister")}
              </ButtonLink>
              <OrDivider label={t("or")} />
              <GoogleSignIn href="/api/auth/login" on={googleOn} />
            </div>
          </section>

                      <button
              type="button"
              onClick={() => setView("demo")}
              className={`group mt-5 flex min-h-14 w-full items-center gap-3 text-left sm:mt-6 transition-colors duration-150 hover:border-ink/50 lg:mt-auto ${SECTION}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-tight">
                  {t("demoOpen")}
                </span>
                <span className="mt-0.5 block text-[0.8125rem] text-ink-muted sm:text-sm">
                  {t("demoToggleBody")}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-0.5"
                strokeWidth={1.75}
              />
            </button>
          
        </motion.div>
      ) : (
        <motion.section
          key="demo"
          aria-labelledby="signin-demo-title"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <Button
            variant="quiet"
            className="-ml-3 min-h-11 px-3 text-ink-muted hover:text-ink"
            onClick={() => setView("main")}
          >
            <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
            {t("demoBack")}
          </Button>
          <h2
            id="signin-demo-title"
            className="mt-2 font-display text-xl leading-tight sm:text-2xl"
          >
            {t("demoTitle")}
          </h2>
          <p className="mb-4 mt-1 text-sm text-ink-muted">
            {t("demoToggleBody")}
          </p>
          <DemoAccounts people={people} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}
