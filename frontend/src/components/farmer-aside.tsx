"use client";

/**
 * The farmer's side panel on wide screens (it follows the main column on phones): how a date
 * works, in three lines, and who plans the machines. It answers the questions a farmer has about
 * the token without crowding the token itself.
 */
import { BellRing, CalendarCheck2, CircleHelp, Phone, Tractor } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog } from "./dialog";
import { AsideCard } from "./page-shell";
import { Button, Pill } from "./ui";

export function DateGuideContent() {
  const t = useTranslations("farmer");
  return (
    <ul className="space-y-3.5">
      <li className="space-y-1.5 rounded-control border border-line bg-paper/60 p-4">
        <Pill kind="firm">{t("firm")}</Pill>
        <p className="text-sm leading-relaxed text-ink">{t("asideFirm")}</p>
      </li>
      <li className="space-y-1.5 rounded-control border border-line bg-paper/60 p-4">
        <Pill kind="window">{t("window")}</Pill>
        <p className="text-sm leading-relaxed text-ink">{t("asideWindow")}</p>
      </li>
      <li className="flex gap-3 rounded-control border border-line bg-wheat-soft/30 p-4">
        <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
        <p className="text-sm leading-relaxed text-ink">{t("asideMoved")}</p>
      </li>
    </ul>
  );
}

export function DateGuideButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("farmer");
  const tc = useTranslations("common");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("asideHowTitle")}
        aria-label={t("asideHowTitle")}
        className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-ink-muted shadow-sm transition-colors duration-150 hover:border-ink/50 hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wheat-deep sm:size-11"
      >
        <CircleHelp className="size-5 sm:size-[22px]" strokeWidth={1.8} aria-hidden />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("asideHowTitle")}
        closeLabel={tc("close")}
        footer={
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {tc("close")}
          </Button>
        }
      >
        <DateGuideContent />
      </Dialog>
    </>
  );
}

export function DateGuide() {
  const t = useTranslations("farmer");
  return (
    <AsideCard icon={<CalendarCheck2 className="size-5" strokeWidth={1.75} />} title={t("asideHowTitle")}>
      <DateGuideContent />
    </AsideCard>
  );
}

export function MachineCentre({ chcName, operatorPhone }: { chcName: string; operatorPhone?: string }) {
  const t = useTranslations("farmer");
  return (
    <AsideCard icon={<Tractor className="size-5" strokeWidth={1.75} />} title={t("asideOperatorTitle")}>
      <p>{t("asideOperatorBody", { chc: chcName })}</p>
      {operatorPhone ? (
        <a
          href={`tel:${operatorPhone.replace(/\s/g, "")}`}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line-strong bg-paper px-4 text-ink hover:border-ink/50"
        >
          <Phone aria-hidden className="size-5" strokeWidth={1.75} />
          {t("callOperator")}
        </a>
      ) : null}
    </AsideCard>
  );
}
