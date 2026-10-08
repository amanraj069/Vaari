"use client";

/**
 * TokenCard: each promise is a numbered queue token, like a mandi token. The date is the biggest
 * thing on the card. Firm dates and windows look different, and a moved date says why, right here.
 */
import { useQuery } from "@tanstack/react-query";
import { BellRing, ChevronDown, History, Phone, Sparkles, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { whySchema, type FarmerField } from "@/shared";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { FuseBar } from "./fuse-bar";
import { Pill, Spinner } from "./ui";

const HISTORY_LABEL = {
  first_promise: "historyFirst",
  narrowed: "historyNarrowed",
  breakdown: "historyBreakdown",
  rain: "historyRain",
  manual_move: "historyManual",
  replan: "historyReplan",
  kept: "historyKept",
} as const;

export function TokenCard({ field, today, operatorPhone }: { field: FarmerField; today: string; operatorPhone?: string }) {
  const t = useTranslations("farmer");
  const ts = useTranslations("slot");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dates = useDates();
  const [whyOpen, setWhyOpen] = useState(false);
  const why = useQuery({
    queryKey: ["why", field.id, field.plannedDate, locale],
    queryFn: () => api(`fields/${field.id}/why?lang=${locale}`, whySchema),
    enabled: whyOpen,
  });
  const promise = field.promise;
  // Same rule as the slot page: a promise that runs past the farmer's last day is said out loud.
  const promiseLastDate = promise ? (promise.kind === "firm" ? promise.date : promise.endDate) : null;
  const late = field.state !== "done" && promiseLastDate !== null && promiseLastDate > field.burnDeadlineDate;

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      {field.notice?.kind === "broken" ? (
        <div className="flex items-start gap-2 border-b border-ember/30 bg-ember-soft/60 px-5 py-3 text-ember-deep">
          <BellRing aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
          <p className="text-base">{t("brokenNotice")}</p>
        </div>
      ) : late ? (
        <div role="alert" className="flex items-start gap-2 border-b border-ember/30 bg-ember-soft/60 px-5 py-3 text-ember-deep">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="text-base font-medium">{ts("lateTitle", { date: dates.full(field.burnDeadlineDate) })}</p>
            <p className="text-sm">{ts("lateBody")}</p>
          </div>
        </div>
      ) : field.notice?.kind === "firmed" ? (
        <div className="flex items-start gap-2 border-b border-field/30 bg-field-soft/60 px-5 py-3 text-field">
          <BellRing aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
          <p className="text-base">{t("firmedNotice")}</p>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div>
          <p className="text-xs font-medium eyebrow text-ink-muted">{t("token")}</p>
          <p className="font-display text-4xl leading-none tabular">#{String(field.token).padStart(3, "0")}</p>
        </div>
        {promise ? (
          <Pill kind={promise.kind} size="lg">
            {promise.kind === "firm" ? t("firm") : t("window")}
          </Pill>
        ) : (
          <Pill kind="unplanned" size="lg">
            {t("noDate")}
          </Pill>
        )}
      </div>
      <p className="px-5 pt-1 text-base text-ink-muted">
        {t("acresInVillage", { acres: tc("acres", { acres: field.acres }), village: field.villageName })}
      </p>

      <div className="mx-5 my-4 border-t border-dashed border-line-strong" />

      <div className="px-5" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={promise ? JSON.stringify(promise) : "none"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            {promise?.kind === "firm" ? (
              <>
                <p className="text-base text-ink-muted">{t("machineComes")}</p>
                <p className="font-display text-3xl leading-tight">{dates.weekday(promise.date)}</p>
                <p className="font-display text-5xl leading-none tracking-tight sm:text-6xl">{dates.dayMonth(promise.date)}</p>
              </>
            ) : promise?.kind === "window" ? (
              <>
                <p className="text-base text-ink-muted">{t("machineBetween")}</p>
                <p className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">{dates.range(promise.startDate, promise.endDate)}</p>
                <p className="mt-1 text-base text-ink-muted">{t("windowBody")}</p>
              </>
            ) : (
              <>
                <p className="font-display text-3xl">{t("noDate")}</p>
                <p className="mt-1 text-base text-ink-muted">{t("noDateBody")}</p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {field.fieldsAhead !== null ? <p className="mt-3 text-lg">{t("fieldsAhead", { count: field.fieldsAhead })}</p> : null}
      </div>

      <div className="px-5 pt-4">
        <FuseBar readyDate={field.readyDate} deadlineDate={field.burnDeadlineDate} plannedDate={field.plannedDate} today={today} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 px-5">
        <button
          type="button"
          aria-expanded={whyOpen}
          onClick={() => setWhyOpen((open) => !open)}
          className="inline-flex min-h-12 items-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-base font-medium hover:border-ink/50"
        >
          <Sparkles aria-hidden className="size-5 text-wheat-deep" strokeWidth={1.75} />
          {t("why")}
          <ChevronDown aria-hidden className={`size-4 transition-transform ${whyOpen ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </button>
        {operatorPhone ? (
          <a href={`tel:${operatorPhone.replace(/\s/g, "")}`} className="inline-flex min-h-12 items-center gap-2 rounded-control px-4 text-base text-ink-muted hover:text-ink">
            <Phone aria-hidden className="size-5" strokeWidth={1.75} />
            {t("callOperator")}
          </a>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {whyOpen ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mx-5 mt-3 rounded-control bg-paper p-4">
              {why.isPending ? (
                <Spinner label={t("whyLoading")} />
              ) : why.isError ? (
                <p className="text-ember-deep">{tc("errorBody")}</p>
              ) : (
                <ul className="space-y-2">
                  {why.data.reasons.map((reason, index) => (
                    <li key={`${reason.code}-${index}`} className="flex gap-2 text-base">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-wheat-deep" />
                      {reason.text}
                    </li>
                  ))}
                  {why.data.earlierPossible ? <li className="text-base text-ink-muted">{t("whyEarlier")}</li> : null}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {field.history.length > 1 ? (
        <details className="group mx-5 mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <History aria-hidden className="size-4" strokeWidth={1.75} />
            {t("history")}
          </summary>
          <ol className="mb-2 space-y-1.5 border-l border-line pl-4">
            {field.history.map((item) => (
              <li key={item.version} className={`text-sm ${item.state === "held" ? "text-ink" : "text-ink-muted line-through decoration-ink-muted/40"}`}>
                <span className="font-medium">{t(HISTORY_LABEL[item.reason])}</span>
                {item.promise ? (
                  <span className="tabular">
                    {" · "}
                    {item.promise.kind === "firm" ? dates.short(item.promise.date) : dates.range(item.promise.startDate, item.promise.endDate)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="h-5" />
    </article>
  );
}
