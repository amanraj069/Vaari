/**
 * The WhatsApp sign-in card on the main sign-in page. A green-tinted WhatsApp icon on the left,
 * a headline ("Sign in with WhatsApp"; the "For farmers" label above it names the audience), one
 * line on how, and an arrow on the right. Tapping goes to /farmer/signin.
 */
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { WhatsAppGlyph } from "./whatsapp-start";

export function WhatsAppSignInCard() {
  const t = useTranslations("signin");
  return (
    <Link
      href="/farmer/signin"
      className="card-lift group flex min-h-12 items-center gap-3 rounded-card border border-line bg-surface p-4 transition-colors duration-150 hover:border-ink/50 sm:p-5"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-field-soft text-field sm:size-11">
        <WhatsAppGlyph className="size-[1.375rem] sm:size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg leading-tight sm:text-xl">{t("farmerPhoneAction")}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-ink-muted sm:text-sm">{t("farmerPhoneActionBody")}</span>
      </span>
      <ArrowRight aria-hidden className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.75} />
    </Link>
  );
}
