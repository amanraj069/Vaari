/**
 * The privacy notice: what Vaari keeps, why, who processes it, who sees what, how long, and how to
 * have it deleted. Plain words and short sections, every string from the messages files. Rendered
 * on the server (no client code), so crawlers and phones without JavaScript get the whole text.
 * The deletion section has a stable id (`/privacy#deletion`) for links from WhatsApp and the
 * footer. Deletion is by email only until the WhatsApp bot handles "delete my data".
 */
import { useTranslations } from "next-intl";
import { Languages, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { PAGE_TITLE } from "./page-shell";
import { ButtonLink } from "./ui";

// Section ids, in page order; also the table of contents. "deletion" is linked from outside: keep it.
const SECTIONS = ["who", "collect", "why", "processors", "access", "retention", "deletion"] as const;
type SectionId = (typeof SECTIONS)[number];

const FARMER_DATA = ["collectFarmerPhone", "collectFarmerVillage", "collectFarmerFieldSize", "collectFarmerHarvestDay", "collectFarmerWaitingLimit", "collectFarmerBookings", "collectFarmerWhatsapp"] as const;

export function PrivacyNotice({ contactEmail }: { contactEmail: string }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const reviewed = useTranslations("meta")("reviewed") === "yes";
  const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent(t("emailSubject"))}`;
  // The address in a sentence is text to read or copy (break-all: long addresses never scroll sideways
  // on a 360px phone); the tap target is the full-size button in the deletion section.
  const emailText = (chunks: ReactNode) => <strong className="break-all font-medium text-ink">{chunks}</strong>;

  const section = (id: SectionId, children: ReactNode) => (
    // scroll-mt: the sticky top bar must not cover a heading reached by #anchor.
    // Full page width like every other page: on wide screens the heading sits in its own column so
    // the text beside it keeps a readable line length; on phones they stack.
    <section key={id} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 border-t border-line pt-8 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <h2 id={`${id}-title`} className="font-display text-2xl leading-snug">{t(`${id}Title`)}</h2>
      <div className="mt-3 max-w-3xl space-y-3 text-base leading-relaxed text-ink-muted lg:mt-0">{children}</div>
    </section>
  );
  const list = (items: string[]) => (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-wheat-deep">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );

  return (
    <article>
      <header>
        <p className="text-sm text-ink-muted">{t("updated")}</p>
        <h1 className={`mt-2 ${PAGE_TITLE}`}>{t("title")}</h1>
        <p className="mt-3 max-w-3xl text-lg text-ink-muted">{t("lead")}</p>
        {reviewed ? null : (
          <p className="mt-4 flex items-start gap-2 text-sm text-ink-muted">
            <Languages aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{tc("unreviewedLanguage")}. {t("reviewNote")}</span>
          </p>
        )}
      </header>

      <nav aria-labelledby="privacy-contents" className="mt-8">
        <h2 id="privacy-contents" className="text-sm font-medium text-ink-muted">{t("contents")}</h2>
        <ol className="mt-3 flex flex-wrap gap-2 text-sm">
          {SECTIONS.map((id) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex min-h-11 min-w-11 items-center rounded-full border border-line-strong px-4 hover:border-ink/50">{t(`${id}Title`)}</a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {section("who", <p>{t.rich("whoBody", { email: emailText, address: contactEmail })}</p>)}
        {section(
          "collect",
          <>
            <p>{t("collectFarmersLead")}</p>
            {list(FARMER_DATA.map((key) => t(key)))}
            <p className="pt-2">{t("collectStaffLead")}</p>
            {list([t("collectStaffGoogle")])}
          </>,
        )}
        {section("why", list([t("whyPurpose"), t("whyNoAds"), t("whyNoSelling")]))}
        {section(
          "processors",
          <>
            <p>{t("processorsLead")}</p>
            {list([t("processorsMeta"), t("processorsAws")])}
          </>,
        )}
        {section("access", list([t("accessFarmers"), t("accessHelpers"), t("accessOperators"), t("accessOfficers")]))}
        {section("retention", list([t("retentionBookings"), t("retentionVoice")]))}
        {section(
          "deletion",
          <>
            <p className="text-ink">{t.rich("deletionBody", { email: emailText, address: contactEmail })}</p>
            <p>{t("deletionWhatToSay")}</p>
            <p>{t("deletionWhen")}</p>
            <p>{t("deletionWhatsappSoon")}</p>
            <ButtonLink href={mailto} className="mt-2">
              <Mail aria-hidden className="size-4" strokeWidth={1.75} />
              {t("deletionButton")}
            </ButtonLink>
          </>,
        )}
      </div>
    </article>
  );
}
