"use client";

/**
 * MethodAndSources: how the numbers were made, read from the results file. Every input with its
 * label, the conversions the measures use, each with its source (a link where the file names one),
 * and the one command that writes the file again. Nothing here is typed by hand.
 */
import { Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProofResults } from "@/shared";
import { AssumptionsList, SourceLine } from "@/components/proof/assumptions-list";
import { formatNumber } from "@/lib/proof";

function constantValues(name: string, constant: { value: number | string; date?: unknown }): Record<string, string | number> {
  if (name === "burnCombustionFactor") return { value: Math.round(Number(constant.value) * 100) };
  const value = name.endsWith("Rupees") || name.startsWith("rent") ? formatNumber(Number(constant.value), "rupees") : constant.value;
  return { value, date: typeof constant.date === "string" ? constant.date : "" };
}

export function MethodAndSources({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const constants = Object.entries(results.assumptions.constants).filter(([name]) => t.has(`con_${name}`));

  return (
    <section aria-labelledby="method-title" className="mt-14 border-t border-line pt-10">
      <h2 id="method-title" className="font-display text-2xl">{t("methodTitle")}</h2>
      <p className="mt-1 max-w-3xl text-ink-muted">{t("methodBody")}</p>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <AssumptionsList results={results} />
        <div className="space-y-6">
          <section aria-labelledby="conversions-title" className="rounded-card border border-line bg-surface p-5">
            <h3 id="conversions-title" className="font-display text-xl">{t("conversionsTitle")}</h3>
            <ul className="mt-3 space-y-3">
              {constants.map(([name, constant]) => (
                <li key={name} className="border-l-2 border-field pl-3 text-sm">
                  {t(`con_${name}`, constantValues(name, constant))}
                  <SourceLine source={constant.source} url={constant.sourceUrl} />
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="reproduce-title" className="rounded-card border border-line bg-surface p-5">
            <h3 id="reproduce-title" className="font-display text-xl">{t("reproduceTitle")}</h3>
            <p className="mt-1 text-sm text-ink-muted">{t("reproduceBody")}</p>
            <p className="mt-3 flex items-start gap-2 overflow-x-auto rounded-control bg-ink px-4 py-3 font-mono text-sm text-paper">
              <Terminal aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              <code>{`cd backend && ${results.generatedBy}`}</code>
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
