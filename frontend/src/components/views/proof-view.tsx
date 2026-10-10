"use client";

/**
 * The proof (public /proof and /dashboard/proof): does a promised date actually help? Read top to bottom like a short report: the answer
 * (one sentence and four stat tiles), the three ways of working being compared, one season
 * replayed side by side, every measure with its spread, what happens if our assumptions are
 * wrong, and the method with every source. Rule:
 * the page shows only numbers read from data/sim/results.json (via GET /public/proof). With no
 * readable results it says so calmly, with a way to try again; never a placeholder number.
 */
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { proofResultsSchema } from "@/shared";
import { KeyTakeaways } from "@/components/proof/key-takeaways";
import { MethodAndSources } from "@/components/proof/method-and-sources";
import { ProofHero } from "@/components/proof/proof-hero";
import { ResultsTable } from "@/components/proof/results-table";
import { SeasonReplay } from "@/components/proof/season-replay";
import { ShortfallPanel } from "@/components/proof/shortfall-panel";
import { SweepChart } from "@/components/proof/sweep-chart";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button, Skeleton, StateMessage } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export function ProofView() {
  const t = useTranslations("proof");
  const proof = useQuery({
    queryKey: ["proof"],
    queryFn: () => api("public/proof", proofResultsSchema, {}, { redirectOn401: false }),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  return (
    <>
      {proof.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only" role="status">{t("loading")}</span>
          <Skeleton className="h-[26rem]" />
          <Skeleton className="h-40" />
        </div>
      ) : proof.isError ? (
        // No readable results (not run yet, or being rewritten): one calm, centred composition with
        // the page's question, a waiting state and a way to try again. Never a command or a file name.
        <section aria-labelledby="proof-unavailable-title" className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center py-10 text-center">
          <SimulatedBadge />
          <h1 id="proof-unavailable-title" className="mt-4 font-display text-3xl leading-tight tracking-tight sm:text-4xl">{t("title")}</h1>
          <p className="mt-3 text-ink-muted">{t("body")}</p>
          <div className="mt-8 w-full">
            <StateMessage
              tone="neutral"
              icon={BarChart3}
              title={t("unavailableTitle")}
              body={t("unavailableBody")}
              action={<Button onClick={() => proof.refetch()}>{t("retryLabel")}</Button>}
            />
          </div>
        </section>
      ) : (
        <>
          <ProofHero results={proof.data} />
          <div className="mt-20">
            <ResultsTable results={proof.data} />
          </div>
          <SeasonReplay replay={proof.data.replay} runs={proof.data.runs} seasonStartDate={proof.data.seasonStartDate} />
          <KeyTakeaways results={proof.data} />
          <SweepChart results={proof.data} />
          <ShortfallPanel results={proof.data} />
          <MethodAndSources results={proof.data} />
        </>
      )}
    </>
  );
}
