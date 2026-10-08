/**
 * The farmer's side panel on wide screens (it follows the main column on phones): how a date
 * works, in three lines, and who plans the machines. It answers the questions a farmer has about
 * the token without crowding the token itself.
 */
import { BellRing, CalendarCheck2, Phone, Tractor } from "lucide-react";
import { useTranslations } from "next-intl";
import { AsideCard } from "./page-shell";
import { Pill } from "./ui";

export function DateGuide() {
  const t = useTranslations("farmer");
  return (
    <AsideCard icon={<CalendarCheck2 className="size-5" strokeWidth={1.75} />} title={t("asideHowTitle")}>
      <ul className="space-y-4">
        <li className="space-y-1.5">
          <Pill kind="firm">{t("firm")}</Pill>
          <p>{t("asideFirm")}</p>
        </li>
        <li className="space-y-1.5">
          <Pill kind="window">{t("window")}</Pill>
          <p>{t("asideWindow")}</p>
        </li>
        <li className="flex gap-2 border-t border-line pt-4">
          <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
          <p>{t("asideMoved")}</p>
        </li>
      </ul>
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
