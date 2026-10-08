/**
 * Proof page. The results table stays empty until the 200-season simulation has really run:
 * no estimated numbers, ever (CLAUDE.md hard rule 4).
 */
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { SimulatedBadge } from "@/components/simulated-badge";
import { TopBar } from "@/components/top-bar";
import { StateMessage } from "@/components/ui";

export default function ProofPage() {
  const t = useTranslations("proof");
  const metrics = ["metric1", "metric2", "metric3", "metric4", "metric5", "metric6"] as const;
  const assumptions = ["assumption1", "assumption2", "assumption3"] as const;
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-10 sm:px-6">
        <SimulatedBadge />
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">{t("body")}</p>
        <div className="mt-8">
          <StateMessage title={t("notRunTitle")} body={t("notRunBody")} />
        </div>
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="font-display text-2xl">{t("metricsTitle")}</h2>
            <ul className="mt-3 space-y-2">
              {metrics.map((key) => (
                <li key={key} className="border-l-2 border-wheat pl-3">{t(key)}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-muted">{t("spreadNote")}</p>
          </section>
          <section>
            <h2 className="flex items-center gap-2 font-display text-2xl">
              <FlaskConical aria-hidden className="size-5" strokeWidth={1.75} />
              {t("assumptionsTitle")}
            </h2>
            <ul className="mt-3 space-y-2 text-ink-muted">
              {assumptions.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
