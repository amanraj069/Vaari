"use client";

/**
 * SeasonReplay ("Where the difference shows up"): how one simulated season ended across the whole
 * district under each way of working, side by side on the same fields, drawn on the district's
 * real outline (OpenStreetMap) with the state border and a small inset of Punjab locating it. Each
 * dot is one farmer's field around its real village; squares are the machine centres:
 * sown by the last day of the wheat sowing optimum, sown after it, or burned because the farmer
 * waited too long (a cross, so it never rests on colour alone). The caption under each map gives
 * the same counts in words. The season is the run with the median gap between the phone queue and
 * Vaari, read from the results file's replay; nothing is typed by hand.
 */
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { PolicyKey, Replay } from "@/shared";
import { useDates } from "@/lib/dates";
import { POLICY_COLOUR, POLICY_ORDER, countOutcomes, dayToIso, districtLayout, formatNumber, outcomeOf, type Outcome } from "@/lib/proof";
import { Rise, SectionHeader } from "@/components/proof/section-header";

// The district is taller than it is wide; the inset of Punjab sits in the top-right corner.
const WIDTH = 380;
const HEIGHT = 560;
const INSET = { x: WIDTH - 96, y: 12, size: 84 };
const OUTCOME_COLOUR: Record<Exclude<Outcome, "unresolved">, string> = {
  onTime: "var(--color-season-ontime)",
  late: "var(--color-season-late)",
  burned: "var(--color-season-burned)",
};

function Dot({ outcome, x, y, size = 1 }: { outcome: Outcome; x: number; y: number; size?: number }) {
  if (outcome === "burned")
    return (
      <g strokeWidth={1.6 * size} strokeLinecap="round" style={{ stroke: OUTCOME_COLOUR.burned }}>
        <line x1={x - 2.4 * size} y1={y - 2.4 * size} x2={x + 2.4 * size} y2={y + 2.4 * size} />
        <line x1={x - 2.4 * size} y1={y + 2.4 * size} x2={x + 2.4 * size} y2={y - 2.4 * size} />
      </g>
    );
  if (outcome === "unresolved") return <circle cx={x} cy={y} r={2 * size} className="fill-none stroke-line-strong" strokeWidth={1} />;
  return <circle cx={x} cy={y} r={2.2 * size} style={{ fill: OUTCOME_COLOUR[outcome] }} />;
}

function Legend({ optimumDate }: { optimumDate: string }) {
  const t = useTranslations("proof");
  const items: { outcome: Exclude<Outcome, "unresolved">; label: string }[] = [
    { outcome: "onTime", label: t("outcomeOnTime", { date: optimumDate }) },
    { outcome: "late", label: t("outcomeLate", { date: optimumDate }) },
    { outcome: "burned", label: t("outcomeBurned") },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-2 text-[0.8125rem] sm:gap-x-5 sm:rounded-full sm:text-sm">
      {items.map((item) => (
        <li key={item.outcome} className="flex items-center gap-2">
          <svg aria-hidden width={12} height={12} viewBox="-6 -6 12 12">
            <Dot outcome={item.outcome} x={0} y={0} size={1.8} />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function PolicyMap({ replay, policy, optimumDate, seasonStartDate }: { replay: Replay; policy: PolicyKey; optimumDate: string; seasonStartDate: string }) {
  const t = useTranslations("proof");
  const dates = useDates();
  const layout = useMemo(() => districtLayout(replay, WIDTH, HEIGHT, 18, 2.4, INSET), [replay]);
  const counts = countOutcomes(replay, policy);
  const villageName = new Map(replay.villages.map((village) => [village.id, village.name]));
  const date = (value: number) => dates.dayMonth(dayToIso(seasonStartDate, value));
  // Counts in Indian grouping (2,109); `burned` stays a number for the plural rule.
  const summary = { onTime: formatNumber(counts.onTime, "fields"), late: formatNumber(counts.late, "fields"), burned: counts.burned, date: optimumDate };
  const clipId = `district-clip-${policy}`;
  return (
    <figure className="flex w-full min-w-0 flex-col rounded-card border border-line bg-surface p-4 sm:p-5">
      <figcaption className="flex items-center gap-2 font-display text-lg">
        <span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: POLICY_COLOUR[policy] }} />
        {t(`policy_${policy}`)}
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("mapLabel", { policy: t(`policy_${policy}`), ...summary })} className="mt-3 h-auto w-full">
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={12} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Outside Punjab is shaded; Punjab is paper; the district sits on top with its real outline. */}
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="fill-line/50" />
          <path d={layout.statePath} className="fill-paper stroke-ink-muted" strokeWidth={1.2} strokeDasharray="5 3" />
          {layout.districts.map((district) => (
            <path key={district.name} d={district.path} className="fill-surface stroke-ink-muted" strokeWidth={1.1} strokeLinejoin="round" />
          ))}
        </g>
        {layout.fields.map(({ field, x, y }) => {
          const outcome = outcomeOf(field, policy, replay.optimumLastDay);
          const sown = field.sownDay[policy];
          return (
            <g key={field.id}>
              <Dot outcome={outcome} x={x} y={y} />
              {/* A larger invisible target carries the tooltip. */}
              <circle cx={x} cy={y} r={4} fill="transparent">
                <title>
                  {`${t("fieldTitle", { acres: field.acres, village: villageName.get(field.villageId) ?? "", ready: date(field.readyDay), deadline: date(field.burnDeadline) })} ${
                    sown !== null ? t("fieldSown", { date: date(sown) }) : outcome === "burned" ? t("fieldBurned") : ""
                  }`}
                </title>
              </circle>
            </g>
          );
        })}
        {layout.centres.map((centre) => (
          <g key={centre.id}>
            <rect x={centre.x - 3.5} y={centre.y - 3.5} width={7} height={7} rx={1.5} className="fill-ink stroke-surface" strokeWidth={1.5} />
            <title>{t("centreTitle", { name: centre.name, machines: centre.machines })}</title>
          </g>
        ))}
        {/* District names on top of the fields, with a halo so they read over the dots. */}
        {layout.districts.map((district) => (
          <text key={district.name} x={district.label.x} y={district.label.y} textAnchor="middle" className="fill-ink text-[11px] font-semibold eyebrow" paintOrder="stroke" stroke="var(--color-surface)" strokeWidth={4} strokeLinejoin="round">
            {district.name}
          </text>
        ))}
        {/* Where the district is: Punjab with the district filled. */}
        <g aria-hidden>
          <rect x={INSET.x - 6} y={INSET.y - 6} width={INSET.size + 12} height={INSET.size + 12} rx={8} className="fill-surface stroke-line" strokeWidth={1} />
          <path d={layout.inset.statePath} className="fill-paper stroke-ink-muted" strokeWidth={0.8} />
          <path d={layout.inset.districtPath} className="fill-wheat stroke-wheat-deep" strokeWidth={0.6} />
          <text x={INSET.x + INSET.size / 2} y={INSET.y + INSET.size + 16} textAnchor="middle" className="fill-ink-muted text-[9px]">
            {replay.boundaries.state.name}
          </text>
        </g>
      </svg>
      <p className="mt-3 text-[0.8125rem] text-ink-muted sm:mt-4 sm:text-sm">{t("mapCaption", summary)}</p>
    </figure>
  );
}

export function SeasonReplay({ replay, runs, seasonStartDate }: { replay: Replay; runs: number; seasonStartDate: string }) {
  const t = useTranslations("proof");
  const dates = useDates();
  const optimumDate = dates.dayMonth(dayToIso(seasonStartDate, replay.optimumLastDay));
  return (
    <section aria-labelledby="replay-title" className="mt-14 sm:mt-20">
      <SectionHeader id="replay-title" title={t("replayTitle")} body={t("replayBody", { runs })} aside={<Legend optimumDate={optimumDate} />} />
      {/* The three maps rise one after another, a beat apart. */}
      <div className="mt-6 grid gap-4 sm:mt-8 md:grid-cols-2 xl:grid-cols-3">
        {POLICY_ORDER.map((policy, index) => (
          <Rise key={policy} delay={index * 0.1} className="flex min-w-0">
            <PolicyMap replay={replay} policy={policy} optimumDate={optimumDate} seasonStartDate={seasonStartDate} />
          </Rise>
        ))}
      </div>
    </section>
  );
}
