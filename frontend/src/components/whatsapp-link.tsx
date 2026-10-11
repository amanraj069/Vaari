/**
 * "See all my fields": opens WhatsApp with Vaari's number and the message "my fields" typed in.
 * The bot answers with a one-time link to every field booked with the sender's number. The message
 * is a command for the bot, so it stays in English in every language; the button and its help are
 * translated.
 */
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export const MY_FIELDS_MESSAGE = "my fields";

/** wa.me link for a WhatsApp Business number (digits with country code). */
export function myFieldsUrl(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(MY_FIELDS_MESSAGE)}`;
}

export function SeeAllMyFields({ number }: { number: string }) {
  const t = useTranslations("slot");
  return (
    <div>
      <a
        href={myFieldsUrl(number)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-[0.9375rem] font-medium sm:text-base hover:border-ink/50"
      >
        <MessageCircle aria-hidden className="size-5 text-field" strokeWidth={1.75} />
        {t("seeAllMyFields")}
      </a>
      <p className="mt-2 text-[0.8125rem] text-ink-muted sm:text-sm">{t("seeAllMyFieldsHelp")}</p>
    </div>
  );
}
