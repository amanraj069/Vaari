"use client";

/**
 * ProofHero: the page's first screen. Three short lines ("Same seasons. Three ways to schedule."
 * and the measured difference), a lead naming where the data comes from, then "How we ran the
 * comparison" in four steps. The difference line is computed from the results file (farmers who
 * burned, summed over every base season, Vaari against the phone queue); with no gain it says so.
 * The photo is a decorative AI-generated illustration, labelled as such.
 */
import { BarChart3, Satellite, Sprout, Tractor } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { ProofResults } from "@/shared";
import { SimulatedBadge } from "@/components/simulated-badge";
import { formatNumber, reductionVsQueue } from "@/lib/proof";

function Step({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full border border-wheat-deep/40 text-wheat-deep">
        {icon}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">{body}</span>
      </span>
    </li>
  );
}

export function ProofHero({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const base = results.scenarios.base;
  const fewer = reductionVsQueue(base.totals.fieldsLate, "vaari");
  // The headline's assumption, read from the file: shown under the lead whenever it is not 0.
  const sooner = Number(results.assumptions.inputs.daysSoonerWithoutDate?.value ?? 0);
  const days = sooner > 0 ? sooner : null;
  const icon = "size-5";
  return (
    <>
      {/* Dark in both themes: the photo in its real colours, light words on a scrim (see .on-photo). */}
      <section aria-labelledby="proof-title" className="on-photo relative overflow-hidden rounded-card border border-line bg-paper text-ink">
        <div aria-hidden className="absolute inset-0">
          <Image src="/proof/drone-img.png" alt="" fill priority sizes="(min-width: 1280px) 1280px, 100vw" quality={80} className="object-cover" style={{ objectPosition: "60% 40%" }} />
        </div>
        <div aria-hidden className="photo-scrim absolute inset-0" />
        <div className="relative max-w-3xl p-6 sm:p-10 lg:p-14">
          <div className="flex flex-wrap items-center gap-2">
            <p className="rounded-full border border-wheat-deep/40 px-3 py-1 text-xs font-medium eyebrow text-wheat-deep">{t("heroEyebrow")}</p>
            <SimulatedBadge />
          </div>
          <h1 id="proof-title" className="mt-5 font-display text-4xl leading-[1.05] tracking-tight sm:text-6xl">
            <span className="block">{t("heroLine1")}</span>
            <span className="block">{t("heroLine2")}</span>
            <span className="block text-wheat-deep">{fewer !== null && fewer > 0 ? t("heroLine3", { pct: fewer }) : t("heroLine3NoGain")}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">{t("heroLead", { runs: results.runs })}</p>
          {days !== null ? <p className="mt-3 max-w-2xl text-sm text-ink-muted">{t("heroAssumption", { days })}</p> : null}
          <p className="mt-4 text-xs text-ink-muted">{t("heroPhoto")}</p>
        </div>
      </section>

      <section aria-labelledby="how-title" className="mt-6 rounded-card border border-line bg-surface p-6 sm:p-8">
        <h2 id="how-title" className="font-display text-2xl">{t("howTitle")}</h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <Step icon={<Satellite className={icon} strokeWidth={1.75} />} title={t("howStep1Title")} body={t("howStep1Body")} />
          <Step icon={<Sprout className={icon} strokeWidth={1.75} />} title={t("howStep2Title")} body={t("howStep2Body", { runs: results.runs, centres: base.centres, farmers: formatNumber(base.fieldsPerSeason, "fields"), machines: base.machines })} />
          <Step icon={<Tractor className={icon} strokeWidth={1.75} />} title={t("howStep3Title")} body={t("howStep3Body")} />
          <Step icon={<BarChart3 className={icon} strokeWidth={1.75} />} title={t("howStep4Title")} body={t("howStep4Body")} />
        </ol>
      </section>
    </>
  );
}
