"use client";

/**
 * ShortfallPanel: where Vaari cannot save everyone. The same simulated seasons with half the
 * machines (the capacityShortfall scenario): too few machines for the acres booked, so every way of
 * working leaves farmers unreached. Shows farmers not reached by their last waiting day, base season
 * next to the shortfall, median with the 10th-90th percentile spread. Rendered only when the
 * results file has the scenario (files written before it existed do not).
 */
import { useTranslations } from "next-intl";
import type { ProofResults } from "@/shared";
import { POLICY_ORDER, formatNumber } from "@/lib/proof";

export function ShortfallPanel({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const shortfall = results.scenarios.capacityShortfall;
  if (!shortfall) return null;
  const base = results.scenarios.base;
  const cell = (spread: { median: number; p10: number; p90: number } | null | undefined) =>
    spread ? (
      <>
        <span className="block font-medium">{formatNumber(spread.median, "fields")}</span>
        <span className="block text-xs text-ink-muted">{t("spread", { low: formatNumber(spread.p10, "fields"), high: formatNumber(spread.p90, "fields") })}</span>
      </>
    ) : (
      "—"
    );

  return (
    <section aria-labelledby="shortfall-title" className="mt-12 rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 id="shortfall-title" className="font-display text-2xl">{t("shortfallTitle")}</h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">{t("shortfallBody", { machines: shortfall.machines, baseMachines: base.machines })}</p>
      <div className="relative mt-4 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="shortfall-title">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">{t("metric_fieldsLate")}</caption>
          <thead>
            <tr className="border-b border-line text-left text-ink-muted">
              <th scope="col" className="py-2 pr-4 font-normal">{t("metric_fieldsLate")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">{t("shortfallBase", { machines: base.machines })}</th>
              <th scope="col" className="py-2 text-right font-normal">{t("shortfallHalf", { machines: shortfall.machines })}</th>
            </tr>
          </thead>
          <tbody>
            {POLICY_ORDER.map((policy) => (
              <tr key={policy} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-medium">{t(`policy_${policy}`)}</th>
                <td className="py-2 pr-4 text-right tabular">{cell(base.results.fieldsLate[policy])}</td>
                <td className="py-2 text-right tabular">{cell(shortfall.results.fieldsLate[policy])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-muted">{t("shortfallNote", { runs: results.runs })}</p>
    </section>
  );
}
