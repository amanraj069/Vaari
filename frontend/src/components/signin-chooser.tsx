"use client";

/**
 * The content half of /signin, for three audiences in the same kind of block. The small label names
 * the audience; the card says only what to do, so nothing is said twice: farmers (sign in with
 * WhatsApp), then village helpers, operators and officers ("Log in / Register", full width, which
 * opens their sign-in page where they pick the role; then "or"; then Continue with Google), then the
 * demo people (their cards, no box around them), listed in place so a judge sees them without a
 * click; on wide screens they fill the rest of the column down to the picture's bottom edge.
 * "Log in / Register" opens the role last used (from the address, ?pick=<role>, or this browser),
 * else village helper.
 */
import { KeyRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DemoAccounts, type DemoPerson } from "./demo-accounts";
import { GoogleSignIn, OrDivider } from "./google-sign-in";
import { ROLE_STORAGE_KEY } from "./staff-auth-card";
import { isStaffRole, type StaffRole } from "./staff-signin-panel";
import { ButtonLink } from "./ui";
import { WhatsAppSignInCard } from "./whatsapp-signin-card";

const SECTION = "card-lift rounded-card border border-line bg-surface p-4 sm:p-5";

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
    <div className="flex h-full flex-col">
      <section aria-labelledby="signin-farmers">
        <Eyebrow id="signin-farmers">{t("eyebrowFarmers")}</Eyebrow>
        <WhatsAppSignInCard />
      </section>

      <section aria-labelledby="signin-staff" className="mt-5 sm:mt-6 lg:mt-5">
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

      <section
        aria-labelledby="signin-demo"
        className="mt-5 sm:mt-6 lg:mt-5 lg:flex lg:flex-1 lg:flex-col"
      >
        <Eyebrow id="signin-demo">{t("demoTitle")}</Eyebrow>
        <DemoAccounts people={people} />
      </section>
    </div>
  );
}
