"use client";

/**
 * AssumptionsList: every input of the simulated seasons, read from the results file, each with
 * its label ("Assumed" or "Real range") and the source it leans on, where it names one. Nothing here is typed by
 * hand: the values come from data/sim/assumptions.json as copied into the results.
 */
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AssumptionInput, ProofResults } from "@/shared";

function values(name: string, input: AssumptionInput): Record<string, string | number> {
  const raw = input as AssumptionInput & { firstReadyDay?: number; lastReadyDay?: number };
  if (name.includes("Chance")) return { value: Math.round(Number(input.value) * 1000) / 10 };
  if (input.values) {
    const mean = input.values.reduce((sum, item) => sum + item, 0) / input.values.length;
    return { min: Math.min(...input.values), max: Math.max(...input.values), mean: Math.round(mean * 10) / 10 };
  }
  return {
    value: input.value ?? "",
    min: input.min ?? "",
    max: input.max ?? "",
    first: raw.firstReadyDay ?? "",
    last: raw.lastReadyDay ?? "",
  };
}

/** The source an input or conversion leans on, as a link when the results file names one. */
export function SourceLine({ source, url }: { source: string; url?: string }) {
  const t = useTranslations("proof");
  if (!url) return <span className="mt-1 block text-xs text-ink-muted">{source}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1 text-xs text-sky underline underline-offset-2">
      <span>{source}</span>
      <ExternalLink aria-hidden className="mt-px size-3 shrink-0" strokeWidth={1.75} />
      <span className="sr-only">{t("opensNewTab")}</span>
    </a>
  );
}

export function AssumptionsList({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const inputs = Object.entries(results.assumptions.inputs).filter(([name]) => t.has(`in_${name}`));
  return (
    <section aria-labelledby="assumptions-title" className="rounded-card border border-line bg-surface p-5">
      <h2 id="assumptions-title" className="font-display text-xl">{t("assumptionsTitle")}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t("assumptionsBody")}</p>
      <ul className="mt-4 space-y-3">
        {inputs.map(([name, input]) => (
          <li key={name} className={`border-l-2 pl-3 text-sm ${input.label === "real range" ? "border-field" : "border-wheat"}`}>
            <span
              className={`mr-2 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                input.label === "real range" ? "border-field/30 bg-field-soft text-field" : "border-wheat-deep/30 bg-wheat-soft text-wheat-deep"
              }`}
            >
              {t(`label_${input.label}`)}
            </span>
            {t(`in_${name}`, values(name, input))}
            {input.source ? <SourceLine source={input.source} url={input.sourceUrl} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
