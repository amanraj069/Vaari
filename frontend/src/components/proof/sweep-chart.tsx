"use client";

/**
 * SweepChart: the share of farmers not reached in time as one input changes (how busy the season
 * is, how long farmers wait, how much sooner a farmer with no date gives up), one line per policy
 * (median over all runs) with its 10th-90th percentile band. A toggle picks the input; the base
 * season's value is marked on the axis. One axis, thin marks, a legend and direct labels (identity
 * never rests on colour alone), a tooltip on every point, and the same numbers as a table.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PolicyKey, ProofResults, SweepParameter } from "@/shared";
import { POLICY_COLOUR, POLICY_ORDER, formatNumber, sweepValueLabel } from "@/lib/proof";

// Drawn at about the width it is shown, so 11-12px text stays 11-12px on a laptop.
const WIDTH = 1040;
const HEIGHT = 340;
const MARGIN = { left: 48, right: 170, top: 24, bottom: 48 };
const LABEL_GAP = 16;

function niceMax(value: number): number {
  const step = value <= 10 ? 2 : value <= 30 ? 5 : 10;
  return Math.max(step, Math.ceil(value / step) * step);
}

export function SweepChart({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const [parameter, setParameter] = useState<SweepParameter>(results.sweeps[0]!.parameter);
  const sweep = results.sweeps.find((item) => item.parameter === parameter) ?? results.sweeps[0]!;
  const points = sweep.points;
  const xs = points.map((point) => point.value);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const top = niceMax(Math.max(...points.flatMap((point) => POLICY_ORDER.map((policy) => point.results.fieldsLatePct[policy]?.p90 ?? 0))));
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (value: number) => MARGIN.left + ((value - minX) / Math.max(maxX - minX, 1)) * plotWidth;
  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => (top / 4) * index);
  const pct = (value: number) => formatNumber(value, "percent");

  // Direct labels at the right end, pushed apart so they never overlap.
  const last = points.at(-1)!;
  const labels = POLICY_ORDER.map((policy) => ({ policy, y: y(last.results.fieldsLatePct[policy]?.median ?? 0) })).sort((left, right) => right.y - left.y);
  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index - 1]!.y - labels[index]!.y < LABEL_GAP) labels[index]!.y = labels[index - 1]!.y - LABEL_GAP;
  }

  const chartTitle = t(`sweepTitle_${sweep.parameter}`);
  const valueLabel = (value: number) => sweepValueLabel(sweep.parameter, value);

  return (
    <section aria-labelledby="sweep-title" className="mt-10 min-w-0">
      <h2 id="sweep-title" className="font-display text-2xl">
        {t("sweepTitle")}
      </h2>
      <p className="mt-1 max-w-3xl text-ink-muted">{t("sweepBody", { runs: results.sweepRuns, centre: sweep.centre })}</p>
      <div role="group" aria-label={t("sweepPick")} className="mt-3 flex flex-wrap gap-2">
        {results.sweeps.map((item) => (
          <button
            key={item.parameter}
            type="button"
            aria-pressed={item.parameter === sweep.parameter}
            onClick={() => setParameter(item.parameter)}
            className={`min-h-11 rounded-control border px-4 text-sm font-medium ${item.parameter === sweep.parameter ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface hover:border-ink/50"}`}
          >
            {t(`sweepTitle_${item.parameter}`)}
          </button>
        ))}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">{t(`sweepNote_${sweep.parameter}`, { base: sweep.base ?? "" })}</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-hidden>
        {POLICY_ORDER.map((policy) => (
          <li key={policy} className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full" style={{ background: POLICY_COLOUR[policy] }} />
            {t(`policy_${policy}`)}
          </li>
        ))}
      </ul>
      <div className="mt-2 rounded-card border border-line bg-surface p-3">
        {/* Never narrower than readable: on a phone the chart scrolls sideways inside its card. */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={chartTitle}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full min-w-[40rem]" role="img" aria-label={chartTitle}>
            <text x={MARGIN.left} y={12} className="fill-ink-muted text-[11px]">{`${t("sweepAxisY")} (%)`}</text>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-ink-muted text-[11px] tabular">
                  {pct(tick)}
                </text>
              </g>
            ))}
            {/* The base season's value: a dashed guide and a bold tick label. */}
            {sweep.base !== null && xs.includes(sweep.base) ? (
              <line x1={x(sweep.base)} x2={x(sweep.base)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="stroke-line-strong" strokeWidth={1} strokeDasharray="3 4" />
            ) : null}
            {xs.map((value) => (
              <text
                key={value}
                x={x(value)}
                y={MARGIN.top + plotHeight + 18}
                textAnchor="middle"
                className={`text-[11px] tabular ${value === sweep.base ? "fill-ink font-semibold" : "fill-ink-muted"}`}
              >
                {valueLabel(value)}
              </text>
            ))}
            <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-ink-muted text-[11px]">
              {sweep.base !== null ? t("sweepAxisXBase", { axis: t(`sweepAxisX_${sweep.parameter}`), base: valueLabel(sweep.base) }) : t(`sweepAxisX_${sweep.parameter}`)}
            </text>

            {POLICY_ORDER.map((policy: PolicyKey) => {
              const cells = points.map((point) => ({ value: point.value, cell: point.results.fieldsLatePct[policy] }));
              const present = cells.filter((item) => item.cell !== null) as { value: number; cell: { median: number; p10: number; p90: number } }[];
              const band = [...present.map((item) => `${x(item.value)},${y(item.cell.p90)}`), ...[...present].reverse().map((item) => `${x(item.value)},${y(item.cell.p10)}`)].join(" ");
              return (
                <g key={policy}>
                  <polygon points={band} style={{ fill: POLICY_COLOUR[policy] }} fillOpacity={0.1} />
                  <polyline
                    points={present.map((item) => `${x(item.value)},${y(item.cell.median)}`).join(" ")}
                    fill="none"
                    style={{ stroke: POLICY_COLOUR[policy] }}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  {present.map((item) => (
                    <g key={item.value}>
                      <circle cx={x(item.value)} cy={y(item.cell.median)} r={4} style={{ fill: POLICY_COLOUR[policy] }} className="stroke-surface" strokeWidth={2} />
                      <circle cx={x(item.value)} cy={y(item.cell.median)} r={12} fill="transparent">
                        <title>
                          {t("sweepPoint", {
                            policy: t(`policy_${policy}`),
                            at: t(`sweepAt_${sweep.parameter}`, { value: valueLabel(item.value) }),
                            median: pct(item.cell.median),
                            low: pct(item.cell.p10),
                            high: pct(item.cell.p90),
                          })}
                        </title>
                      </circle>
                    </g>
                  ))}
                </g>
              );
            })}
            {labels.map((label) => (
              <g key={label.policy}>
                <line x1={x(maxX) + 8} x2={x(maxX) + 20} y1={label.y} y2={label.y} style={{ stroke: POLICY_COLOUR[label.policy] }} strokeWidth={2} />
                <text x={x(maxX) + 24} y={label.y + 4} className="fill-ink text-[12px]">
                  {t(`policy_${label.policy}`)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <details className="mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-sky underline underline-offset-2">{t("sweepTable")}</summary>
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={`${t("sweepTable")}: ${chartTitle}`}>
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t(`sweepAxisX_${sweep.parameter}`)}
                </th>
                {POLICY_ORDER.map((policy) => (
                  <th key={policy} scope="col" className="py-2 pr-4 font-medium">
                    {t(`policy_${policy}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.value} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-2 pr-4 font-normal tabular">
                    {valueLabel(point.value)}
                    {point.value === sweep.base ? <span className="ml-2 text-ink-muted">{t("sweepBaseMark")}</span> : null}
                  </th>
                  {POLICY_ORDER.map((policy) => {
                    const cell = point.results.fieldsLatePct[policy];
                    return (
                      <td key={policy} className="py-2 pr-4 tabular">
                        {cell ? `${pct(cell.median)}% (${pct(cell.p10)}–${pct(cell.p90)}%)` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
