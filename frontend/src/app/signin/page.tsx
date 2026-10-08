/**
 * Sign-in. Always answers "am I signed in?": a signed-in visitor sees who they are and a way in;
 * a failed or role-less Google sign-in gets a plain explanation instead of a silent bounce.
 */
import { AlertTriangle, Satellite, Sprout, Wind } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { meSchema } from "@/shared";
import { DemoButton } from "@/components/demo-buttons";
import { GoogleLogo } from "@/components/google-logo";
import { LandingPhoto } from "@/components/landing-photo";
import { PageHeader, PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { serverConfig } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

/**
 * The right half on wide screens: the landing's sunrise photo with the promise in one line and the
 * three things Vaari is for, so signing in still says what the product is. Hidden on phones, where
 * the accounts come first.
 */
async function SignInPhotoPanel() {
  const t = await getTranslations("landing");
  const points = [
    { icon: Wind, title: t("airTitle"), body: t("airBody") },
    { icon: Sprout, title: t("sowTitle"), body: t("sowBody") },
    { icon: Satellite, title: t("dataTitle"), body: t("dataBody") },
  ];
  return (
    <div aria-hidden className="relative isolate hidden min-h-[36rem] overflow-hidden rounded-card border border-line lg:block">
      <LandingPhoto name="hero" position="72% center" sizes="(min-width: 1024px) 50vw, 0px" />
      <div className="photo-wash-panel absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 p-8">
        <p className="font-display text-4xl leading-tight tracking-tight">
          {t.rich("heroTitle", { em: (chunks) => <em className="text-wheat-deep">{chunks}</em> })}
        </p>
        <p className="mt-3 max-w-md text-ink">{t("heroBody")}</p>
        <ul className="mt-6 grid gap-3">
          {points.map((point) => (
            <li key={point.title} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-surface/80">
                <point.icon className="size-5 text-wheat-deep" strokeWidth={1.5} />
              </span>
              <span className="text-sm">
                <span className="block font-medium text-ink">{point.title}</span>
                <span className="text-ink-muted">{point.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

async function currentUser() {
  const response = await apiFetch("/me").catch(() => null);
  if (!response?.ok) return null;
  const parsed = meSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("signin");
  const { error } = await searchParams;
  const me = await currentUser();
  if (me) redirect("/api/auth/resume");
  const cognitoOn = serverConfig.authMode === "cognito";
  const personas = [
    { role: "farmer" as const, name: t("farmerCard"), detail: t("farmerCardRole"), variant: "accent" as const },
    { role: "operator" as const, name: t("operatorCard"), detail: t("operatorCardRole"), variant: "primary" as const },
    { role: "facilitator" as const, name: t("facilitatorCard"), detail: t("facilitatorCardRole"), variant: "primary" as const },
  ];
  return (
    <>
      <TopBar />
      <PageMain>
        <div className="grid items-stretch gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="max-w-xl">
            <PageHeader title={t("title")} />

            {error ? (
              <div role="alert" className="mt-6 flex gap-2 rounded-card border border-ember/40 bg-ember-soft/50 p-5 text-ember-deep">
                <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
                <p>{error === "no_role" ? t("errorNoRole") : error === "unavailable" ? t("errorUnavailable") : t("errorGeneric")}</p>
              </div>
            ) : null}

            {serverConfig.demoMode ? (
              <section className="mt-8">
                <h2 className="text-lg font-medium">{t("demoTitle")}</h2>
                <p className="mt-1 text-ink-muted">{t("demoBody")}</p>
                <ul className="mt-4 space-y-3">
                  {personas.map((persona) => (
                    // Same layout for every persona: text left and button right on wider screens,
                    // button full width under the text on phones.
                    <li key={persona.role} className="grid gap-4 rounded-card border border-line bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="font-display text-xl">{persona.name}</p>
                        <p className="text-sm text-ink-muted">{persona.detail}</p>
                      </div>
                      <DemoButton role={persona.role} label={t("useAccount")} variant={persona.variant} className="w-full sm:w-auto" />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-10 border-t border-line pt-6">
              {cognitoOn ? (
                <a href="/api/auth/login" className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-control border border-line-strong bg-surface font-medium hover:border-ink/50">
                  <GoogleLogo />
                  {t("google")}
                </a>
              ) : (
                <p className="text-sm text-ink-muted">{t("googleOff")}</p>
              )}
            </section>
          </div>
          <SignInPhotoPanel />
        </div>
      </PageMain>
    </>
  );
}
