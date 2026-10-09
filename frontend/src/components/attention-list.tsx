/**
 * AttentionList: farmers who said "I cannot wait longer" from their slot link. Their held promise
 * stands until the operator publishes a plan; the next published plan gives them an earlier date if
 * one exists, never a later one. The operator sees who they are, their new last day, and their
 * current promise. Shown on the board and on the plan page; nothing when the list is empty.
 */
import { Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AttentionItem } from "@/shared";
import { useDates } from "@/lib/dates";

export function AttentionList({ items }: { items: AttentionItem[] }) {
  const t = useTranslations("operator");
  const dates = useDates();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="attention-title" className="mt-5 rounded-card border border-wheat-deep/30 bg-wheat-soft/60 p-5">
      <h2 id="attention-title" className="flex items-center gap-2 font-medium">
        <Hourglass aria-hidden className="size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
        {t("attentionTitle", { count: items.length })}
      </h2>
      <p className="mt-1 text-sm">{t("attentionBody")}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item.fieldId}>
            <span className="font-medium tabular">#{String(item.token).padStart(3, "0")}</span>{" "}
            {t("attentionItem", {
              name: item.farmerName,
              village: item.villageName,
              date: dates.full(item.burnDeadlineDate),
              promise: item.promise
                ? item.promise.kind === "firm"
                  ? dates.short(item.promise.date)
                  : dates.range(item.promise.startDate, item.promise.endDate)
                : t("attentionNoPromise"),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
