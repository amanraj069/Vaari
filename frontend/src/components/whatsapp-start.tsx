/**
 * "Do it all on WhatsApp": the farmer's way into Vaari without the web. A small chat drawn in the
 * page's own tokens shows what happens (the farmer writes "hey", Vaari answers with its menu, the
 * same three choices the bot really sends), and one button opens WhatsApp with Vaari's number and a
 * greeting typed in, in the page's language ("hey", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "नमस्ते"). The worker reads the
 * script of that first message, so the bot answers in the same language. Hidden when no number is
 * configured.
 */
import {
  CheckCheck,
  ChevronLeft,
  Mic,
  Paperclip,
  Phone,
  Smile,
  Video,
} from "lucide-react";
import { useTranslations } from "next-intl";

/** wa.me link for the WhatsApp Business number (digits with country code), with the greeting typed in. */
export function whatsappStartUrl(number: string, greeting: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(greeting)}`;
}

/** The WhatsApp glyph (speech bubble with a handset), in the current text colour. */
export function WhatsAppGlyph({
  className = "size-5",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * A phone showing the first exchange of the chat. It has one fixed size (17 x 34.5rem, or 17 x 28rem
 * when `short`) in every language and theme: the frame never grows, the chat is anchored at the
 * bottom like a real one (a short phone shows less of its top), and longer Punjabi or Hindi text is
 * clipped inside its bubble. Text sizes are fixed for the same reason. Decorative content is hidden
 * from screen readers; the figure has one label.
 */
function PhoneMockup({ short = false }: { short?: boolean }) {
  const t = useTranslations("whatsappStart");
  const tr = useTranslations("request");
  const time = "9:41";
  const greeting = t("startMessage");
  return (
    <figure
      role="img"
      aria-label={t("illustrationLabel", { greeting })}
      className={`relative mx-auto ${short ? "h-[28rem]" : "h-[34.5rem]"} w-[17rem] shrink-0`}
    >
      {/* Side buttons: silent switch and volume on the left, power on the right. */}
      <span
        aria-hidden
        className="absolute -left-[3px] top-24 h-6 w-[3px] rounded-l-sm bg-ink dark:bg-line-strong"
      />
      <span
        aria-hidden
        className="absolute -left-[3px] top-36 h-11 w-[3px] rounded-l-sm bg-ink dark:bg-line-strong"
      />
      <span
        aria-hidden
        className="absolute -left-[3px] top-[12.5rem] h-11 w-[3px] rounded-l-sm bg-ink dark:bg-line-strong"
      />
      <span
        aria-hidden
        className="absolute -right-[3px] top-40 h-16 w-[3px] rounded-r-sm bg-ink dark:bg-line-strong"
      />

      <div
        aria-hidden
        className="h-full w-full rounded-[2.75rem] bg-ink p-[0.55rem] ring-1 ring-ink/10 dark:bg-paper dark:ring-line-strong"
      >
        <div className="relative flex h-full flex-col overflow-hidden rounded-[2.25rem] bg-paper">
          {/* Status bar and the camera island, on WhatsApp's header colour. */}
          <div className="relative flex h-9 shrink-0 items-center justify-between bg-field px-6 text-[11px] font-semibold text-paper">
            <span className="tabular">{time}</span>
            <span className="absolute left-1/2 top-2 h-[1.35rem] w-[5.5rem] -translate-x-1/2 rounded-full bg-ink dark:bg-paper" />
            <span className="flex items-center gap-1">
              <svg
                viewBox="0 0 16 10"
                className="h-2.5 w-4"
                fill="currentColor"
              >
                <rect x="0" y="7" width="3" height="3" rx="0.6" />
                <rect x="4.3" y="5" width="3" height="5" rx="0.6" />
                <rect x="8.6" y="2.5" width="3" height="7.5" rx="0.6" />
                <rect x="12.9" y="0" width="3" height="10" rx="0.6" />
              </svg>
              <svg viewBox="0 0 24 11" className="h-2.5 w-[1.4rem]" fill="none">
                <rect
                  x="0.5"
                  y="0.5"
                  width="20"
                  height="10"
                  rx="2.5"
                  stroke="currentColor"
                  opacity="0.5"
                />
                <rect
                  x="2"
                  y="2"
                  width="14"
                  height="7"
                  rx="1.4"
                  fill="currentColor"
                />
                <rect
                  x="21.5"
                  y="3.5"
                  width="1.6"
                  height="4"
                  rx="0.8"
                  fill="currentColor"
                  opacity="0.5"
                />
              </svg>
            </span>
          </div>

          {/* Chat header. */}
          <div className="flex h-14 shrink-0 items-center gap-2 bg-field px-3 text-paper">
            <ChevronLeft className="size-5 shrink-0" strokeWidth={2} />
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper font-display text-lg text-field">
              V
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[14px] font-semibold">
                Vaari
              </span>
              <span className="flex items-center gap-1 truncate text-[11px] opacity-85">
                <WhatsAppGlyph className="size-3 shrink-0" />
                {t("chatOnline")}
              </span>
            </span>
            <Video className="size-[1.15rem] shrink-0" strokeWidth={1.75} />
            <Phone className="size-4 shrink-0" strokeWidth={1.75} />
          </div>

          {/* Messages, anchored at the bottom on a quiet dotted wallpaper. */}
          <div
            className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden px-3 pb-3 text-[13px] leading-snug"
            style={{
              backgroundImage:
                "radial-gradient(var(--color-line) 1px, transparent 1.2px)",
              backgroundSize: "14px 14px",
            }}
          >
            <span className="mx-auto max-w-[70%] truncate rounded-md bg-surface px-2 py-0.5 text-[11px] text-ink-muted">
              {tr("today")}
            </span>
            <div className="ml-auto flex max-w-[75%] items-end gap-1.5 rounded-xl rounded-tr-sm bg-field-soft px-3 py-1.5 text-ink">
              <span className="truncate">{greeting}</span>
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-ink-muted">
                {time}
                <CheckCheck className="size-3.5 text-sky" strokeWidth={2} />
              </span>
            </div>
            <div className="mr-auto w-[85%] rounded-xl rounded-tl-sm border border-line bg-surface px-3 py-2 text-ink">
              <p className="line-clamp-3 h-[3.85em]">{t("chatBody")}</p>
              <p className="mt-0.5 text-right text-[10px] text-ink-muted">
                {time}
              </p>
            </div>
            <ul className="mr-auto w-[85%] space-y-1">
              {[t("chatDate"), t("chatWhy"), t("chatWait")].map((label) => (
                <li
                  key={label}
                  className="flex h-9 items-center justify-center truncate rounded-xl border border-line bg-surface px-2 font-medium text-field"
                >
                  <span className="truncate">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Message bar. */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-t border-line bg-surface px-2.5 pb-2">
            <span className="flex h-9 flex-1 items-center gap-2 rounded-full border border-line bg-paper px-3 text-ink-muted">
              <Smile className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="h-2 flex-1 rounded-full bg-line" />
              <Paperclip className="size-4 shrink-0" strokeWidth={1.75} />
            </span>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-field text-paper">
              <Mic className="size-4" strokeWidth={2} />
            </span>
          </div>
          {/* Home indicator. */}
          <span className="absolute bottom-1.5 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-ink/40" />
        </div>
      </div>
    </figure>
  );
}

/**
 * "Do it all on WhatsApp": card with the header, phone mockup illustration, and Open WhatsApp action button.
 * The date-specific body text, "Example chat" tag, and "Prefer to chat?" lead line are removed so the card is clean.
 * No WHATSAPP_BUSINESS_NUMBER on the Next server: nothing (there is no chat to open).
 */
export function WhatsAppStart({
  number,
  className = "",
  fill = false,
}: {
  number: string | null;
  className?: string;
  fill?: boolean;
}) {
  const t = useTranslations("whatsappStart");
  if (!number) return null;
  return (
    <section
      aria-labelledby="whatsapp-start-title"
      className={`rounded-card border border-line bg-surface p-4 sm:p-6 ${fill ? "flex h-full flex-col" : ""} ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-field-soft text-field sm:size-11">
          <WhatsAppGlyph className="size-[1.375rem] sm:size-6" />
        </span>
        <h2
          id="whatsapp-start-title"
          className="font-display text-lg leading-tight sm:text-2xl"
        >
          {t("title")}
        </h2>
      </div>
      {/* A picture of a phone is wasted space on a phone: from the small-tablet width up only. */}
      <div
        className={`${fill ? "mt-4" : "mt-5"} hidden sm:block ${fill ? "sm:flex sm:flex-1 sm:flex-col sm:items-center sm:justify-center" : ""}`}
      >
        <PhoneMockup short={fill} />
      </div>
      <a
        href={whatsappStartUrl(number, t("startMessage"))}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-field bg-transparent px-4 text-base font-medium text-field transition-colors duration-150 hover:bg-field-soft"
      >
        <WhatsAppGlyph className="size-5" />
        {t("cta")}
      </a>
    </section>
  );
}
