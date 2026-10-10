"use client";

/**
 * SweepChart ("What if our assumptions are wrong?"): the share of farmers not reached in time as
 * one input changes, for every input at once, as a 2 x 2 grid of small multiples on the same kind
 * of axis: how busy the season is, how long farmers wait, how much sooner a farmer with no date
 * gives up, how often rentals come back late. Each panel: one line per policy (median over all
 * runs) with its 10th-90th percentile band, the base season's value marked, short direct labels at
 * the line ends and a tooltip on every point. "Show data" (top right) flips the card to its back,
 * where the same numbers sit in a table; "Show chart" flips it back. One shared legend above.
 * Lines draw in once when a panel first scrolls into view (not with reduced motion).
 */
import { LineChart, Table2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { PolicyKey, ProofResults } from "@/shared";
import { POLICY_COLOUR, POLICY_ORDER, formatNumber, sweepValueLabel } from "@/lib/proof";
import { Rise, SectionHeader } from "@/components/proof/section-header";

// Drawn at about the width a panel is shown, so 11px text stays 11px on a laptop.
const WIDTH = 560;
const HEIGHT = 290;
const MARGIN = { left: 40, right: 74, top: 18, bottom: 46 };
const LABEL_GAP = 14;
// Every card's note, front and back, under its title: full width, written to about the same length
// (close to two full lines) and given the same two lines' space on wide screens, so all charts and
// tables start on one line.
const NOTE = "mt-2.5 text-xs leading-5 text-ink-muted md:min-h-10";
// One face of a panel's two-sided card.
const FACE = "flex min-w-0 flex-col rounded-card border border-line bg-surface p-5 [backface-visibility:hidden] [grid-area:1/1]";

type Sweep = ProofResults["sweeps"][number];

function niceMax(value: number): number {
  const step = value <= 10 ? 2 : value <= 30 ? 5 : 10;
  return Math.max(step, Math.ceil(value / step) * step);
}

function SweepPanel({ sweep, index }: { sweep: Sweep; index: number }) {
  const t = useTranslations("proof");
  const reduceMotion = useReducedMotion();
  const points = sweep.points;
  const xs = points.map((point) => point.value);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const top = niceMax(Math.max(...points.flatMap((point) => POLICY_ORDER.map((policy) => point.results.fieldsLatePct[policy]?.p90 ?? 0))));
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (value: number) => MARGIN.left + ((value - minX) / Math.max(maxX - minX, 1e-9)) * plotWidth;
  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, step) => (top / 4) * step);
  const pct = (value: number) => formatNumber(value, "percent");
  const valueLabel = (value: number) => sweepValueLabel(sweep.parameter, value);
  const title = t(`sweepTitle_${sweep.parameter}`);
  const [flipped, setFlipped] = useState(false);
  const frontButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  // The face being hidden becomes inert, so focus moves to the toggle on the face coming into view.
  const flip = (toBack: boolean) => {
    setFlipped(toBack);
    requestAnimationFrame(() => (toBack ? backButton : frontButton).current?.focus({ preventScroll: true }));
  };
  const header = (back: boolean) => (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-display text-lg leading-snug">{title}</h3>
      {/* A small pill drawn inside a full 44px tap target (the button itself is transparent). */}
      <button
        ref={back ? backButton : frontButton}
        type="button"
        onClick={() => flip(!back)}
        aria-label={`${back ? t("showChart") : t("showData")}: ${title}`}
        className="group -my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-full px-2 focus-visible:outline-offset-0"
      >
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 text-[0.8125rem] font-medium text-ink-muted transition-colors group-hover:border-ink/40 group-hover:text-ink">
          {back ? <LineChart aria-hidden className="size-3.5" strokeWidth={1.75} /> : <Table2 aria-hidden className="size-3.5" strokeWidth={1.75} />}
          {back ? t("showChart") : t("showData")}
        </span>
      </button>
    </div>
  );

  // Short direct labels at the right end, pushed apart so they never overlap.
  const last = points.at(-1)!;
  const labels = POLICY_ORDER.map((policy) => ({ policy, y: y(last.results.fieldsLatePct[policy]?.median ?? 0) })).sort((left, right) => right.y - left.y);
  for (let step = 1; step < labels.length; step += 1) {
    if (labels[step - 1]!.y - labels[step]!.y < LABEL_GAP) labels[step]!.y = labels[step - 1]!.y - LABEL_GAP;
  }
  // Each line draws in once; the panels follow one another a beat apart.
  const draw = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { pathLength: 0, opacity: 0 },
          whileInView: { pathLength: 1, opacity: 1 },
          viewport: { once: true, amount: 0.4 },
          transition: { duration: 1.1, ease: [0.22, 1, 0.36, 1] as const, delay },
        };
  const fade = (delay: number) => (reduceMotion ? {} : { initial: { opacity: 0 }, whileInView: { opacity: 1 }, viewport: { once: true, amount: 0.4 }, transition: { duration: 0.8, delay } });
  const baseDelay = 0.1 + (index % 2) * 0.12;

  return (
    // A two-sided card: the chart on the front, its numbers on the back. Both faces share one grid
    // cell, so the card keeps the height of the taller one; the hidden face is inert.
    <Rise delay={(index % 2) * 0.08} className="min-w-0 [perspective:1600px]">
      <div
        className={`grid h-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
      >
        <div inert={flipped} aria-hidden={flipped} className={`${FACE} ${flipped ? "pointer-events-none" : ""}`}>
          {header(false)}
          <p className={NOTE}>{t(`sweepNote_${sweep.parameter}`, { base: sweep.base ?? "" })}</p>
          {/* Never narrower than readable: on a phone the panel's chart scrolls sideways. */}
          <div className="mt-3 overflow-x-auto" tabIndex={flipped ? -1 : 0} role="region" aria-label={title}>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full min-w-[22rem]" role="img" aria-label={title}>
              <text x={MARGIN.left} y={10} className="fill-ink-muted text-[10px]">{`${t("sweepAxisY")} (%)`}</text>
              {ticks.map((tick) => (
                <g key={tick}>
                  <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
                  <text x={MARGIN.left - 7} y={y(tick) + 4} textAnchor="end" className="fill-ink-muted text-[10px] tabular">
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
                  y={MARGIN.top + plotHeight + 16}
                  textAnchor="middle"
                  className={`text-[10px] tabular ${value === sweep.base ? "fill-ink font-semibold" : "fill-ink-muted"}`}
                >
                  {valueLabel(value)}
                </text>
              ))}
              <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-ink-muted text-[10px]">
                {sweep.base !== null ? t("sweepAxisXBase", { axis: t(`sweepAxisX_${sweep.parameter}`), base: valueLabel(sweep.base) }) : t(`sweepAxisX_${sweep.parameter}`)}
              </text>

              {POLICY_ORDER.map((policy: PolicyKey, order) => {
                const present = points
                  .map((point) => ({ value: point.value, cell: point.results.fieldsLatePct[policy] }))
                  .filter((item): item is { value: number; cell: { median: number; p10: number; p90: number } } => item.cell !== null);
                const band = [...present.map((item) => `${x(item.value)},${y(item.cell.p90)}`), ...[...present].reverse().map((item) => `${x(item.value)},${y(item.cell.p10)}`)].join(" ");
                return (
                  <g key={policy}>
                    <motion.polygon points={band} style={{ fill: POLICY_COLOUR[policy] }} fillOpacity={0.09} {...fade(baseDelay + 0.5)} />
                    <motion.polyline
                      points={present.map((item) => `${x(item.value)},${y(item.cell.median)}`).join(" ")}
                      fill="none"
                      style={{ stroke: POLICY_COLOUR[policy] }}
                      strokeWidth={policy === "vaari" ? 2.4 : 1.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      {...draw(baseDelay + order * 0.12)}
                    />
                    {present.map((item) => (
                      <g key={item.value}>
                        <motion.circle
                          cx={x(item.value)}
                          cy={y(item.cell.median)}
                          r={3.5}
                          style={{ fill: POLICY_COLOUR[policy] }}
                          className="stroke-surface"
                          strokeWidth={1.5}
                          {...fade(baseDelay + 0.9)}
                        />
                        <circle cx={x(item.value)} cy={y(item.cell.median)} r={11} fill="transparent">
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
                <motion.g key={label.policy} {...fade(baseDelay + 1)}>
                  <line x1={x(maxX) + 7} x2={x(maxX) + 16} y1={label.y} y2={label.y} style={{ stroke: POLICY_COLOUR[label.policy] }} strokeWidth={2} />
                  <text x={x(maxX) + 20} y={label.y + 3.5} className="fill-ink text-[10.5px]">
                    {t(`policyShort_${label.policy}`)}
                  </text>
                </motion.g>
              ))}
            </svg>
          </div>
        </div>
        <div inert={!flipped} aria-hidden={!flipped} className={`${FACE} [transform:rotateY(180deg)] ${flipped ? "" : "pointer-events-none"}`}>
          {header(true)}
          <p className={NOTE}>{t("sweepDataNote")}</p>
          <div className="mt-4 overflow-x-auto" tabIndex={flipped ? 0 : -1} role="region" aria-label={`${t("sweepData")}: ${title}`}>
            <table className="w-full min-w-[24rem] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t(`sweepAxisX_${sweep.parameter}`)}
                  </th>
                  {POLICY_ORDER.map((policy) => (
                    <th key={policy} scope="col" className="py-2 pr-3 text-right font-medium">
                      {t(`policy_${policy}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.value} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2 pr-3 align-top font-normal tabular">
                      {valueLabel(point.value)}
                      {point.value === sweep.base ? <span className="ml-2 text-ink-muted">{t("sweepBaseMark")}</span> : null}
                    </th>
                    {POLICY_ORDER.map((policy) => {
                      const cell = point.results.fieldsLatePct[policy];
                      return (
                        <td key={policy} className="py-2 pr-3 text-right tabular last:pr-0">
                          {cell ? (
                            <>
                              <span className={`block text-sm ${policy === "vaari" ? "font-semibold" : ""}`}>{`${pct(cell.median)}%`}</span>
                              <span className="block whitespace-nowrap text-[0.68rem] text-ink-muted">{`${pct(cell.p10)}–${pct(cell.p90)}%`}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Rise>
  );
}

export function SweepChart({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const legend = (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 rounded-full border border-line bg-surface px-4 py-2 text-sm" aria-label={t("sweepLegend")}>
      {POLICY_ORDER.map((policy) => (
        <li key={policy} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: POLICY_COLOUR[policy] }} />
          {t(`policy_${policy}`)}
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby="sweep-title" className="mt-20 min-w-0">
      <SectionHeader id="sweep-title" title={t("sweepTitle")} body={t("sweepBody", { runs: results.sweepRuns, centre: results.sweeps[0]?.centre ?? "" })} aside={legend} />
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {results.sweeps.map((sweep, index) => (
          <SweepPanel key={sweep.parameter} sweep={sweep} index={index} />
        ))}
      </div>
    </section>
  );
}
