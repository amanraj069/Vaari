"use client";

/**
 * ResultsTable: every measure for the three policies in the base season, as one comparison table,
 * grouped (farmers and air, wheat, the machine centre). The median is the number and the 10th to
 * 90th percentile sits under it: never one run. Policy columns share one width and right-align
 * tabular figures, so a row reads across at a glance; it sits on the platform's card surface with
 * hairlines inside and no icons. The
 * colours rank each row: soft green best, soft wheat second, soft ember worst (ties share a
 * colour); the best is also set in semibold and every place is named for screen readers, so it
 * never rests on colour alone. Rows with no fair ranking stay plain. Distance is left out: driving less is not a better season for a farmer.
 * A measure that does not apply says so (the baselines make no promises; the queue is the
 * baseline for delay).
 * Phones (below md): the same numbers as one card per measure, the three ways of working side by
 * side as small ranked tiles, so nothing scrolls sideways; the table takes over from md.
 */
import { useTranslations } from "next-intl";
import type { ProofMetricKey, ProofResults } from "@/shared";
import { POLICY_ORDER, formatNumber, rankPolicies, type Rank } from "@/lib/proof";
import { Rise, SectionHeader } from "@/components/proof/section-header";

const GROUPS: { key: string; metrics: ProofMetricKey[] }[] = [
  { key: "farmers", metrics: ["fieldsLate", "acresBurned", "strawBurnedTonnes", "pm25Kg", "promisesKeptPct", "daysWithoutDate"] },
  // "Acres sown after 15 November" is left out: it counts a field burned and sown the next day as on
  // time, so it rewards burning. Wheat lost (acres weighted by days late) measures the wheat cost.
  { key: "wheat", metrics: ["wheatLostKg"] },
  { key: "centre", metrics: ["acresPerMachine", "incomePerMachineRupees"] },
];
// Each cell's place on its row: soft green best, soft wheat second, soft ember worst.
const RANK_FILL: Record<Rank, string> = { best: "bg-field-soft", second: "bg-wheat-soft", worst: "bg-ember-soft" };
const RANK_EDGE: Record<Rank, string> = { best: "border-field/30", second: "border-wheat-deep/30", worst: "border-ember/30" };

export function ResultsTable({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  // Every measure is reported for the base season (the other seasons stay in the results file).
  const scenario = results.scenarios.base;
  const unitOf = (metric: ProofMetricKey) => results.metrics.find((item) => item.key === metric)?.unit ?? "";
  const show = (metric: ProofMetricKey, value: number) => {
    const unit = unitOf(metric);
    return unit === "days" ? t("unit_days", { value: Number(formatNumber(value, unit)) }) : t(`unit_${unit}`, { value: formatNumber(value, unit) });
  };
  const constant = (name: string) => results.assumptions.constants[name]?.value;
  const rent = constant("rentRupeesPerAcre");
  const breakEven = constant("breakEvenAcresPerMachine");
  const labelValues = {
    rent: rent !== undefined ? formatNumber(Number(rent), "rupees") : "",
    straw: String(constant("strawTonnesPerAcre") ?? ""),
    pm: String(constant("pm25GramsPerKgStrawBurned") ?? ""),
  };

  return (
    <section aria-labelledby="results-title" className="min-w-0">
      <SectionHeader
        id="results-title"
        title={t("tableTitle", { runs: results.runs })}
        body={t("scenarioNote_base")}
        aside={
          <p className="rounded-2xl border border-line-strong bg-surface px-4 py-1.5 text-[0.8125rem] font-medium sm:rounded-full sm:text-sm">
            {t("scenario_base", { centres: scenario.centres, machines: scenario.machines, fields: formatNumber(scenario.fieldsPerSeason, "fields") })}
          </p>
        }
      />

      {/* On the platform's card surface, like every other panel; hairlines inside, no icons. On a phone it
          scrolls sideways (keyboard users can focus and scroll it). `relative` keeps the screen-reader-only
          "best" labels (absolutely positioned) inside the scroll box, or they widen the page. */}
      <Rise className="mt-6 sm:mt-8">
        <div className="md:hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs text-ink-muted">
            <p>{t("tableCaption", { runs: results.runs })}</p>
            <p className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {(["best", "second", "worst"] as const).map((rank) => (
                <span key={rank} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={`size-3 rounded-[3px] border ${RANK_EDGE[rank]} ${RANK_FILL[rank]}`} />
                  {t(`rank_${rank}`)}
                </span>
              ))}
            </p>
          </div>
          {GROUPS.map((group) => (
            <section key={group.key} aria-label={t(`group_${group.key}`)} className="mt-5">
              <h3 className="mb-2 text-[0.7rem] font-semibold eyebrow text-ink-muted">{t(`group_${group.key}`)}</h3>
              <ul className="space-y-2">
                {group.metrics.map((metric) => {
                  const cells = scenario.results[metric];
                  const ranks = rankPolicies(results, metric, cells);
                  return (
                    <li key={metric} className="rounded-card border border-line bg-surface p-3.5">
                      <p className="text-sm font-medium leading-snug">
                        {t(`metric_${metric}`, labelValues)}
                        {metric === "acresPerMachine" && breakEven !== undefined ? (
                          <span className="mt-0.5 block text-[0.7rem] font-normal text-ink-muted">{t("breakEven", { acres: String(breakEven) })}</span>
                        ) : null}
                      </p>
                      <dl className="mt-2.5 grid grid-cols-3 gap-1.5">
                        {POLICY_ORDER.map((policy) => {
                          const cell = cells[policy];
                          const rank = ranks[policy];
                          return (
                            <div key={policy} className={`min-w-0 rounded-control border px-2 py-1.5 ${rank ? `${RANK_FILL[rank]} ${RANK_EDGE[rank]}` : "border-line"}`}>
                              <dt className="truncate text-[0.7rem] text-ink-muted">{t(`policyShort_${policy}`)}</dt>
                              {cell === null ? (
                                <dd className="text-xs leading-snug text-ink-muted">
                                  {t("notApplicable")}
                                  {rank ? <span className="sr-only">{`, ${t(`rank_${rank}`)}`}</span> : null}
                                </dd>
                              ) : (
                                <>
                                  <dd className={`break-words font-display text-[0.9375rem] leading-tight tabular ${rank === "best" ? "font-semibold" : ""}`}>
                                    {show(metric, cell.median)}
                                    {rank ? <span className="sr-only">{`, ${t(`rank_${rank}`)}`}</span> : null}
                                  </dd>
                                  <dd className="mt-0.5 text-[0.625rem] leading-tight text-ink-muted tabular">
                                    {metric === "worstDelayVsQueueDays" && policy === "phone_queue"
                                      ? t("baseline")
                                      : t("spread", { low: formatNumber(cell.p10, unitOf(metric)), high: formatNumber(cell.p90, unitOf(metric)) })}
                                  </dd>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div className="relative hidden overflow-x-auto rounded-card border border-line bg-surface md:block" tabIndex={0} role="region" aria-labelledby="results-title">
          <table className="w-full min-w-[44rem] table-fixed border-collapse text-left">
            <caption className="border-b border-line px-6 py-3 text-left text-xs text-ink-muted">
              <span className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <span>{t("tableCaption", { runs: results.runs })}</span>
                <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                  {(["best", "second", "worst"] as const).map((rank) => (
                    <span key={rank} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className={`size-3 rounded-[3px] border ${RANK_EDGE[rank]} ${RANK_FILL[rank]}`} />
                      {t(`rank_${rank}`)}
                    </span>
                  ))}
                </span>
              </span>
            </caption>
            <colgroup>
              <col />
              {POLICY_ORDER.map((policy) => (
                <col key={policy} className="w-[10.5rem] lg:w-[13rem]" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-line bg-paper">
                {/* The measure column stays put while the policy columns scroll sideways on a phone. */}
                <th scope="col" className="sticky left-0 z-[1] bg-paper py-3 pl-6 pr-4 align-bottom text-xs font-medium text-ink-muted">
                  {t("colMeasure")}
                </th>
                {POLICY_ORDER.map((policy) => (
                  <th key={policy} scope="col" className="px-4 py-3 text-right align-bottom font-normal last:pr-6">
                    <span className="block whitespace-nowrap font-display text-base text-ink">{t(`policy_${policy}`)}</span>
                    <span className="mt-0.5 block text-[0.7rem] text-ink-muted">{t(`rule_${policy}`)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {GROUPS.map((group) => (
              <tbody key={group.key}>
                <tr>
                  <th scope="colgroup" colSpan={POLICY_ORDER.length + 1} className="border-b border-line pb-1.5 pl-6 pt-5 text-left text-[0.7rem] font-semibold eyebrow text-ink-muted">
                    {t(`group_${group.key}`)}
                  </th>
                </tr>
                {group.metrics.map((metric) => {
                  const cells = scenario.results[metric];
                  const ranks = rankPolicies(results, metric, cells);
                  return (
                    <tr key={metric} className="border-b border-line last:border-b-0">
                      <th scope="row" className="sticky left-0 z-[1] bg-surface py-2.5 pl-6 pr-4 align-middle text-sm font-normal leading-snug">
                        {t(`metric_${metric}`, labelValues)}
                        {metric === "acresPerMachine" && breakEven !== undefined ? (
                          <span className="mt-0.5 block text-[0.7rem] text-ink-muted">{t("breakEven", { acres: String(breakEven) })}</span>
                        ) : null}
                      </th>
                      {POLICY_ORDER.map((policy) => {
                        const cell = cells[policy];
                        const rank = ranks[policy];
                        const isBest = rank === "best";
                        return (
                          <td key={policy} className={`px-4 py-2.5 text-right align-middle last:pr-6 ${rank ? RANK_FILL[rank] : ""}`}>
                            {cell === null ? (
                              <span className="text-sm text-ink-muted">
                                {t("notApplicable")}
                                {rank ? <span className="sr-only">{`, ${t(`rank_${rank}`)}`}</span> : null}
                              </span>
                            ) : (
                              <>
                                <span className={`block font-display text-lg leading-tight tabular ${isBest ? "font-semibold" : ""}`}>
                                  {show(metric, cell.median)}
                                  {rank ? <span className="sr-only">{`, ${t(`rank_${rank}`)}`}</span> : null}
                                </span>
                                <span className="block text-[0.68rem] leading-tight text-ink-muted tabular">
                                  {metric === "worstDelayVsQueueDays" && policy === "phone_queue"
                                    ? t("baseline")
                                    : t("spread", { low: formatNumber(cell.p10, unitOf(metric)), high: formatNumber(cell.p90, unitOf(metric)) })}
                                </span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </Rise>
    </section>
  );
}
