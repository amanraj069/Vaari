"use client";

/**
 * PlanChangesList: what approving a draft does, farmer by farmer, before anything is published.
 * This is the operator's "see the consequences, then confirm" moment: first dates, windows that
 * become firm, moves inside a promise, and (in ember, never hidden) promises that must break.
 */
import { BellRing, CalendarCheck2, CalendarPlus, CircleDashed, MoveRight, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PlanChangesView, PromiseView } from "@/shared";
import { useDates } from "@/lib/dates";

type Row = { fieldId: string; token: number; farmerName: string; villageName: string; detail: string };

function Group({ icon: Icon, title, rows, tone = "neutral" }: { icon: LucideIcon; title: string; rows: Row[]; tone?: "neutral" | "risk" }) {
  if (rows.length === 0) return null;
  return (
    <details open={tone === "risk" || rows.length <= 4} className={`rounded-control border p-3 ${tone === "risk" ? "border-ember/40 bg-ember-soft/50" : "border-line bg-surface"}`}>
      <summary className={`flex cursor-pointer items-center gap-2 font-medium ${tone === "risk" ? "text-ember-deep" : ""}`}>
        <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
        {title}
      </summary>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.fieldId} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium tabular">#{String(row.token).padStart(3, "0")}</span>
            <span>{row.farmerName}</span>
            <span className="text-ink-muted">· {row.villageName}</span>
            <span className="ml-auto tabular">{row.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PlanChangesList({ changes, brokenProven }: { changes: PlanChangesView; brokenProven: boolean | null }) {
  const t = useTranslations("plan");
  const dates = useDates();
  const promiseText = (promise: PromiseView | null) =>
    promise === null ? t("unplacedDate") : promise.kind === "firm" ? dates.short(promise.date) : dates.range(promise.startDate, promise.endDate);
  const total =
    changes.promised.length + changes.firmed.length + changes.moved.length + changes.broken.length + changes.rePromised.length + changes.unplaced.length;
  if (total === 0) return <p className="text-sm text-ink-muted">{t("changesNone")}</p>;
  return (
    <div className="space-y-2">
      <Group
        icon={BellRing}
        tone="risk"
        title={t("broken", { count: changes.broken.length })}
        rows={changes.broken.map((item) => ({ ...item, detail: `${promiseText(item.previous)} → ${promiseText(item.next)}` }))}
      />
      {changes.broken.length > 0 && brokenProven ? <p className="px-1 text-xs text-ink-muted">{t("brokenProven")}</p> : null}
      <Group icon={CalendarPlus} title={t("promised", { count: changes.promised.length })} rows={changes.promised.map((item) => ({ ...item, detail: promiseText(item.promise) }))} />
      <Group icon={CalendarCheck2} title={t("firmed", { count: changes.firmed.length })} rows={changes.firmed.map((item) => ({ ...item, detail: dates.short(item.date) }))} />
      <Group
        icon={Sparkles}
        title={t("rePromised", { count: changes.rePromised.length })}
        rows={changes.rePromised.map((item) => ({ ...item, detail: `${promiseText(item.previous)} → ${promiseText(item.next)}` }))}
      />
      <Group
        icon={MoveRight}
        title={t("moved", { count: changes.moved.length })}
        rows={changes.moved.map((item) => ({
          ...item,
          detail: `${item.fromDate ? dates.short(item.fromDate) : "—"} → ${item.toDate ? dates.short(item.toDate) : t("unplacedDate")}`,
        }))}
      />
      <Group icon={CircleDashed} tone="risk" title={t("unplaced", { count: changes.unplaced.length })} rows={changes.unplaced.map((item) => ({ ...item, detail: "" }))} />
    </div>
  );
}

/**
 * The same changes in one line, for the decision bar: one chip per kind of change with its count
 * (a promise that breaks first, in ember). Every chip is an icon and words, never colour alone.
 */
export function PlanChangesSummary({ changes }: { changes: PlanChangesView }) {
  const t = useTranslations("plan");
  const chips: { key: string; icon: LucideIcon; text: string; risk: boolean; count: number }[] = [
    { key: "broken", icon: BellRing, text: t("broken", { count: changes.broken.length }), risk: true, count: changes.broken.length },
    { key: "unplaced", icon: CircleDashed, text: t("unplaced", { count: changes.unplaced.length }), risk: true, count: changes.unplaced.length },
    { key: "promised", icon: CalendarPlus, text: t("promised", { count: changes.promised.length }), risk: false, count: changes.promised.length },
    { key: "firmed", icon: CalendarCheck2, text: t("firmed", { count: changes.firmed.length }), risk: false, count: changes.firmed.length },
    { key: "rePromised", icon: Sparkles, text: t("rePromised", { count: changes.rePromised.length }), risk: false, count: changes.rePromised.length },
    { key: "moved", icon: MoveRight, text: t("moved", { count: changes.moved.length }), risk: false, count: changes.moved.length },
  ].filter((chip) => chip.count > 0);
  if (chips.length === 0) return <p className="text-sm text-ink-muted">{t("changesNone")}</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${chip.risk ? "border-ember/40 bg-ember-soft font-medium text-ember-deep" : "border-line bg-surface"}`}
        >
          <chip.icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          {chip.text}
        </li>
      ))}
    </ul>
  );
}
