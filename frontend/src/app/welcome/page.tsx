import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { TopBar } from "@/components/top-bar";
import { ButtonLink } from "@/components/ui";

export default function WelcomePage() {
  const t = useTranslations("welcome");
  return (
    <>
      <TopBar signedIn />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-10">
        <h1 className="font-display text-4xl">{t("title")}</h1>
        <p className="mt-3 text-lg text-ink-muted">{t("body")}</p>
        <div className="mt-6">
          <LanguageSwitcher />
        </div>
        <ButtonLink href="/farmer" className="mt-8 min-h-12 w-full text-lg">
          {t("continue")}
        </ButtonLink>
      </main>
    </>
  );
}
