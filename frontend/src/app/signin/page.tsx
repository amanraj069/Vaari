/**
 * Sign-in. Always answers "am I signed in?": a signed-in visitor sees who they are and a way in;
 * a failed or role-less Google sign-in gets a plain explanation instead of a silent bounce.
 */
import { AlertTriangle, ArrowRight, CircleCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { meSchema } from "@/shared";
import { DemoButton } from "@/components/demo-buttons";
import { TopBar } from "@/components/top-bar";
import { ButtonLink } from "@/components/ui";
import { ROLE_HOME, serverConfig } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

async function currentUser() {
  const response = await apiFetch("/me").catch(() => null);
  if (!response?.ok) return null;
  const parsed = meSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("signin");
  const tr = await getTranslations("roles");
  const { error } = await searchParams;
  const me = await currentUser();
  const cognitoOn = serverConfig.authMode === "cognito";
  const personas = [
    { role: "farmer" as const, name: t("farmerCard"), detail: t("farmerCardRole"), variant: "accent" as const },
    { role: "operator" as const, name: t("operatorCard"), detail: t("operatorCardRole"), variant: "primary" as const },
  ];
  return (
    <>
      <TopBar signedIn={Boolean(me) || error === "no_role"} />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-10">
        <h1 className="font-display text-4xl">{t("title")}</h1>

        {me?.needsOnboarding ? (
          <div role="status" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-wheat-deep/30 bg-wheat-soft p-4">
            <p>{t("finishSetup")}</p>
            <ButtonLink href="/welcome" variant="accent">
              {t("finishSetupAction")}
              <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
            </ButtonLink>
          </div>
        ) : me?.role ? (
          <div role="status" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-field/30 bg-field-soft/60 p-4">
            <p className="flex items-center gap-2">
              <CircleCheck aria-hidden className="size-5 text-field" strokeWidth={1.75} />
              {t("signedInAs", { name: me.name, role: tr(me.role) })}
            </p>
            <ButtonLink href={ROLE_HOME[me.role] ?? "/"}>
              {t("goToApp")}
              <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
            </ButtonLink>
          </div>
        ) : error ? (
          <div role="alert" className="mt-6 flex gap-2 rounded-[8px] border border-ember/40 bg-ember-soft/50 p-4 text-ember-deep">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
            <p>{error === "no_role" ? t("errorNoRole") : t("errorGeneric")}</p>
          </div>
        ) : null}

        {serverConfig.demoMode ? (
          <section className="mt-8">
            <h2 className="text-lg font-medium">{t("demoTitle")}</h2>
            <p className="mt-1 text-ink-muted">{t("demoBody")}</p>
            <ul className="mt-4 space-y-3">
              {personas.map((persona) => (
                <li key={persona.role} className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-line bg-surface p-4">
                  <div>
                    <p className="font-display text-xl">{persona.name}</p>
                    <p className="text-sm text-ink-muted">{persona.detail}</p>
                  </div>
                  <DemoButton role={persona.role} label={t("useAccount")} variant={persona.variant} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10 border-t border-line pt-6">
          {cognitoOn ? (
            <a href="/api/auth/login" className="inline-flex min-h-12 w-full items-center justify-center rounded-[8px] border border-line-strong bg-surface font-medium hover:border-ink/50">
              {t("google")}
            </a>
          ) : (
            <p className="text-sm text-ink-muted">{t("googleOff")}</p>
          )}
        </section>
      </main>
    </>
  );
}
