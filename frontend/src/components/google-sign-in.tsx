/** "Continue with Google" (Cognito's hosted flow), and the quiet "or" rule between ways in. */
import { useTranslations } from "next-intl";
import { GoogleLogo } from "./google-logo";

export function GoogleSignIn({ href, on }: { href: string; on: boolean }) {
  const t = useTranslations("signin");
  if (!on) return <p className="text-sm text-ink-muted">{t("googleOff")}</p>;
  return (
    <a href={href} className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-control border border-line-strong bg-surface font-medium transition-colors duration-150 hover:border-ink/50">
      <GoogleLogo />
      {t("google")}
    </a>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-sm text-ink-muted">
      <span aria-hidden className="h-px flex-1 bg-line" />
      {label}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}
