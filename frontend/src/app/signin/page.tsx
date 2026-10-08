import { useTranslations } from "next-intl";
import { DemoButton } from "@/components/demo-buttons";
import { TopBar } from "@/components/top-bar";

export default function SignInPage() {
  const t = useTranslations("signin");
  const cognitoOn = process.env.AUTH_MODE === "cognito";
  const personas = [
    { role: "farmer" as const, name: t("farmerCard"), detail: t("farmerCardRole"), variant: "accent" as const },
    { role: "operator" as const, name: t("operatorCard"), detail: t("operatorCardRole"), variant: "primary" as const },
  ];
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-10">
        <h1 className="font-display text-4xl">{t("title")}</h1>
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
                <DemoButton role={persona.role} label="→" variant={persona.variant} />
              </li>
            ))}
          </ul>
        </section>
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
