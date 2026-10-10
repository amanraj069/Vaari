"use client";

/**
 * MethodAndSources: how the numbers were made, read from the results file. Every input with its
 * label and the conversions the measures use, each with its source (a link where the file names
 * one). Nothing here is typed by hand.
 *
 * It closes the page as one card that opens on demand: the reader who wants the evidence clicks
 * anywhere on it; everyone else sees a one-line summary. Closed, the details stay in the page
 * (for crawlers and the tests) but are inert and invisible, so nobody tabs into hidden links.
 */
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ProofResults } from "@/shared";
import { AssumptionsList, Ledger, LedgerRow, SourceLine } from "@/components/proof/assumptions-list";
import { formatNumber } from "@/lib/proof";

function constantValues(name: string, constant: { value: number | string; date?: unknown }): Record<string, string | number> {
  if (name === "burnCombustionFactor") return { value: Math.round(Number(constant.value) * 100) };
  const value = name.endsWith("Rupees") || name.startsWith("rent") ? formatNumber(Number(constant.value), "rupees") : constant.value;
  return { value, date: typeof constant.date === "string" ? constant.date : "" };
}

export function MethodAndSources({ results }: { results: ProofResults }) {
  const t = useTranslations("proof");
  const [open, setOpen] = useState(false);
  const constants = Object.entries(results.assumptions.constants).filter(([name]) => t.has(`con_${name}`));

  return (
    <section aria-labelledby="method-title" className="mt-20 overflow-hidden rounded-card border border-line bg-surface">
      {/* The title is the toggle; its ::after stretches over the whole header so the card is one big target.
          Its 44px tap height is given back with -my-2, so the header's padding reads an even 20px. */}
      <div className="relative flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-5 transition-colors duration-300 hover:bg-ink/[0.03] sm:flex-nowrap sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl">
            <button
              id="method-title"
              type="button"
              aria-expanded={open}
              aria-controls="method-details"
              onClick={() => setOpen((value) => !value)}
              className="-my-2 inline-flex min-h-11 items-center text-left after:absolute after:inset-0 after:rounded-card"
            >
              {t("methodTitle")}
            </button>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{t("methodBody")}</p>
        </div>
        {/* The visible state; the button's aria-expanded says the same to screen readers. */}
        <span aria-hidden className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-line-strong bg-paper px-4 text-sm font-medium">
          {open ? t("methodHide") : t("methodShow")}
          <ChevronDown className={`size-4 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </span>
      </div>

      {/* Height eases from 0 to the content's own (grid rows 0fr -> 1fr) while the content fades in and
          settles a few pixels, a beat behind; closing reverses it. Reduced motion: instant. */}
      <div id="method-details" className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div inert={!open} className={`min-h-0 overflow-hidden transition-[visibility] duration-500 motion-reduce:transition-none ${open ? "visible" : "invisible"}`}>
          <div
            className={`space-y-12 border-t border-line p-5 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:p-6 lg:p-8 ${
              open ? "translate-y-0 opacity-100 delay-100" : "-translate-y-2 opacity-0"
            }`}
          >
            <AssumptionsList results={results} />

            <Ledger id="conversions-title" title={t("conversionsTitle")} statementColumn={t("columnConversion")}>
              {constants.map(([name, constant]) => (
                <LedgerRow key={name} statement={t(`con_${name}`, constantValues(name, constant))} sources={<SourceLine source={constant.source} url={constant.sourceUrl} />} />
              ))}
            </Ledger>
          </div>
        </div>
      </div>
    </section>
  );
}
