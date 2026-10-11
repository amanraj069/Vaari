"use client";

/**
 * KeyTakeaways: four findings in one row, each an icon, a short title and one sentence whose
 * numbers come from the results file (base season): fewer farmers who burned, shorter waits, less
 * smoke, and dates farmers can rely on. "Fewer" compares totals over all seasons; "median season"
 * values are the median of the per-season figures. A finding that did not improve says so plainly.
 */
import { CalendarCheck, Clock, IndianRupee, Users, Wind } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { ProofResults } from "@/shared";
import { formatNumber, reductionVsQueue } from "@/lib/proof";
import { Rise, SectionHeader } from "@/components/proof/section-header";

function Takeaway({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3 sm:gap-4">
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full border border-wheat-deep/40 text-wheat-deep sm:size-14">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg leading-snug sm:text-xl">{title}</span>
        <span className="mt-1 block text-[0.8125rem] text-ink-muted sm:text-sm">{body}</span>
      </span>
    </li>
  );
}

export function KeyTakeaways({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const base = results.scenarios.base;
  const median = (metric: "medianWaitDays" | "pm25Kg" | "incomePerMachineRupees", policy: "phone_queue" | "vaari") => base.results[metric][policy]?.median ?? 0;
  // Each takeaway claims only what the file shows: "shorter waits" only when Vaari's median wait is
  // shorter; otherwise the centre's income, when that is higher.
  const shorterWait = median("medianWaitDays", "vaari") < median("medianWaitDays", "phone_queue");
  const incomeGain =
    median("incomePerMachineRupees", "phone_queue") > 0
      ? Math.round((100 * (median("incomePerMachineRupees", "vaari") - median("incomePerMachineRupees", "phone_queue"))) / median("incomePerMachineRupees", "phone_queue"))
      : 0;
  const farmers = reductionVsQueue(base.totals.fieldsLate, "vaari");
  const smoke = reductionVsQueue(base.totals.pm25Kg, "vaari");
  const seasons = base.pairedWithQueue.fieldsLate.vaari;
  const promises = base.results.promisesKeptPct.vaari;
  const icon = "size-6";
  return (
    <section aria-labelledby="takeaways-title" className="mt-14 sm:mt-20">
      <SectionHeader id="takeaways-title" title={t("takeawaysTitle")} />
      <Rise className="mt-6 sm:mt-8">
        <ul className="grid gap-6 rounded-card border border-line bg-surface p-5 sm:grid-cols-2 sm:gap-8 sm:p-8 xl:grid-cols-4">
          <Takeaway
            icon={<Users className={icon} strokeWidth={1.5} />}
            title={t("takeFarmersTitle")}
            body={
              farmers !== null && farmers > 0
                ? t("takeFarmersBody", { pct: farmers, runs: results.runs, better: formatNumber(seasons.betterPct, "percent") })
                : t("takeFarmersNone", { runs: results.runs })
            }
          />
          {shorterWait || incomeGain <= 0 ? (
            <Takeaway
              icon={<Clock className={icon} strokeWidth={1.5} />}
              title={t(shorterWait ? "takeWaitTitle" : "takeWaitSameTitle")}
              body={t("takeWaitBody", { vaari: Number(formatNumber(median("medianWaitDays", "vaari"), "days")), queue: Number(formatNumber(median("medianWaitDays", "phone_queue"), "days")) })}
            />
          ) : (
            <Takeaway
              icon={<IndianRupee className={icon} strokeWidth={1.5} />}
              title={t("takeIncomeTitle")}
              body={t("takeIncomeBody", {
                pct: incomeGain,
                vaari: formatNumber(median("incomePerMachineRupees", "vaari"), "rupees"),
                queue: formatNumber(median("incomePerMachineRupees", "phone_queue"), "rupees"),
              })}
            />
          )}
          <Takeaway
            icon={<Wind className={icon} strokeWidth={1.5} />}
            title={t("takeSmokeTitle")}
            body={
              smoke !== null && smoke > 0
                ? t("takeSmokeBody", { pct: smoke, runs: results.runs, vaari: formatNumber(median("pm25Kg", "vaari"), "kg"), queue: formatNumber(median("pm25Kg", "phone_queue"), "kg") })
                : t("takeSmokeNone", { runs: results.runs })
            }
          />
          <Takeaway
            icon={<CalendarCheck className={icon} strokeWidth={1.5} />}
            title={t("takePromisesTitle")}
            body={promises ? t("takePromisesBody", { pct: formatNumber(promises.median, "percent") }) : t("kpiPromisesNote")}
          />
        </ul>
      </Rise>
      <p className="mt-3 text-xs text-ink-muted sm:mt-4 sm:text-center">{t("kpiFootnote", { runs: results.runs })}</p>
    </section>
  );
}
