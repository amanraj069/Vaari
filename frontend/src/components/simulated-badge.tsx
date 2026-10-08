import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

/** Honesty rule: simulated is labelled simulated, on every page that shows demo data. */
export function SimulatedBadge({ demoDate }: { demoDate?: string }) {
  const t = useTranslations("common");
  return (
    <span
      title={t("simulatedLong")}
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-muted/50 px-2.5 py-0.5 text-xs text-ink-muted"
    >
      <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
      {t("simulated")}
      {demoDate ? <span className="tabular">· {t("demoClock", { date: demoDate })}</span> : null}
    </span>
  );
}
