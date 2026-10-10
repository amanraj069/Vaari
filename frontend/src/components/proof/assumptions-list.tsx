"use client";

/**
 * AssumptionsList: every input of the simulated seasons, read from the results file, each with
 * its label ("Assumed" or "Real range") and the source it leans on, where it names one. Nothing here is
 * typed by hand: the values come from data/sim/assumptions.json as copied into the results. Shown as
 * a quiet ledger (label | what went in | source by short name), the source column the narrowest.
 */
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { AssumptionInput, ProofResults } from "@/shared";
import { shortSource } from "@/lib/proof";

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

/** The inputs shown on the page: those with a sentence in the messages files. */
export function shownInputs(results: ProofResults, has: (key: string) => boolean) {
  return Object.entries(results.assumptions.inputs).filter(([name]) => has(`in_${name}`));
}

/**
 * The source an input or conversion leans on, as its short name(s) ("CEEW CHC study, 2025"): a quiet
 * link when the results file names one, the full citation in the tooltip and for screen readers.
 */
export function SourceLine({ source, url }: { source: string; url?: string }) {
  const t = useTranslations("proof");
  const names = shortSource(source);
  const label = names.join(" · ");
  if (!url) {
    return (
      <span title={source} className="block py-2.5 text-sm text-ink-muted">
        <span aria-hidden>{label}</span>
        <span className="sr-only">{source}</span>
      </span>
    );
  }
  return (
    // Block with 12px padding: one line of text is a 44px target; the arrow follows the name.
    <a href={url} target="_blank" rel="noreferrer" title={source} className="group block py-3 text-sm text-ink-muted transition-colors hover:text-ink">
      <span aria-hidden className="underline decoration-ink/20 underline-offset-4 transition-colors group-hover:decoration-ink/60">
        {label}
      </span>
      {/* Inline, so it follows the last word when a name wraps. */}
      <ArrowUpRight aria-hidden className="ml-1 inline size-3.5 align-[-2px] opacity-60 transition-[opacity,transform] group-hover:-translate-y-px group-hover:translate-x-px group-hover:opacity-100" strokeWidth={1.75} />
      <span className="sr-only">{`${source} ${t("opensNewTab")}`}</span>
    </a>
  );
}

// Columns on wide screens: the label (inputs only), what went in, and its source (narrower).
const COLUMNS_INPUT = "md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,15rem)]";
const COLUMNS_PLAIN = "md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]";

/** One ledger: a heading, then rows of "statement | source", with the column names above on wide screens. */
export function Ledger({ id, title, body, statementColumn, labelColumn, children }: { id: string; title: string; body?: string; statementColumn: string; labelColumn?: string; children: ReactNode }) {
  const t = useTranslations("proof");
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="font-display text-xl">{title}</h3>
      {body ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{body}</p> : null}
      <div aria-hidden className={`mt-5 hidden gap-x-8 border-b border-line pb-2 text-xs font-medium text-ink-muted md:grid ${labelColumn ? COLUMNS_INPUT : COLUMNS_PLAIN}`}>
        {labelColumn ? <span>{labelColumn}</span> : null}
        <span>{statementColumn}</span>
        <span>{t("columnSource")}</span>
      </div>
      <ul className="divide-y divide-line border-b border-line max-md:mt-4 max-md:border-t">{children}</ul>
    </section>
  );
}

/** A ledger row: an optional label, the statement, and its sources (stacked on phones). */
export function LedgerRow({ label, statement, sources }: { label?: ReactNode; statement: ReactNode; sources: ReactNode }) {
  return (
    <li className={`grid gap-x-8 gap-y-0.5 py-1.5 md:items-center ${label ? COLUMNS_INPUT : COLUMNS_PLAIN}`}>
      {label ? <div className="pt-2 md:pt-0">{label}</div> : null}
      <div className="min-w-0 py-1.5 text-sm leading-relaxed text-ink">{statement}</div>
      <div className="min-w-0">{sources}</div>
    </li>
  );
}

/** "Real range" or "Assumed", quietly: a filled or hollow dot and the word, never a coloured pill. */
function Basis({ label }: { label: AssumptionInput["label"] }) {
  const t = useTranslations("proof");
  const real = label === "real range";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span aria-hidden className={`size-1.5 rounded-full ${real ? "bg-field" : "border border-wheat-deep"}`} />
      {t(`label_${label}`)}
    </span>
  );
}

export function AssumptionsList({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  return (
    <Ledger id="assumptions-title" title={t("assumptionsTitle")} body={t("assumptionsBody")} statementColumn={t("columnInput")} labelColumn={t("columnBasis")}>
      {shownInputs(results, (key) => t.has(key)).map(([name, input]) => (
        <LedgerRow
          key={name}
          label={<Basis label={input.label} />}
          statement={t(`in_${name}`, values(name, input))}
          sources={
            input.source || input.alsoSource ? (
              <>
                {input.source ? <SourceLine source={input.source} url={input.sourceUrl} /> : null}
                {input.alsoSource ? <SourceLine source={input.alsoSource} url={input.alsoSourceUrl} /> : null}
              </>
            ) : (
              // The label already says it; a dash keeps the column quiet (hidden on phones, where it
              // would sit alone under the row). Screen readers still hear why there is no source.
              <>
                <span aria-hidden className="block py-2.5 text-sm text-ink-muted max-md:hidden">—</span>
                {input.label === "assumed" ? <span className="sr-only">{t("noSource")}</span> : null}
              </>
            )
          }
        />
      ))}
    </Ledger>
  );
}
