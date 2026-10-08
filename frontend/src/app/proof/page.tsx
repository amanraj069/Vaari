/**
 * Proof page. The results table is drawn in full (three policies, six measures) so a visitor sees
 * exactly what will be compared, but every cell says "Not run" until the 200-season simulation
 * has really run: no estimated numbers, ever (CLAUDE.md hard rule 4).
 */
import { FlaskConical, Hourglass, Ruler } from "lucide-react";
import { useTranslations } from "next-intl";
import { SimulatedBadge } from "@/components/simulated-badge";
import { AsideCard, PageColumns, PageHeader, PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";

export default function ProofPage() {
  const t = useTranslations("proof");
  const metrics = ["metric1", "metric2", "metric3", "metric4", "metric5", "metric6"] as const;
  const assumptions = ["assumption1", "assumption2", "assumption3"] as const;
  const policies = [
    { key: "colQueue", vaari: false },
    { key: "colNearest", vaari: false },
    { key: "colVaari", vaari: true },
  ] as const;
  return (
    <>
      <TopBar />
      <PageMain>
        <PageHeader className="mb-8" badge={<SimulatedBadge />} title={t("title")} description={t("body")} />
        <PageColumns
          main={
            <section aria-labelledby="proof-table" className="overflow-hidden rounded-card border border-line bg-surface">
              <div role="status" className="flex items-start gap-3 border-b border-line bg-wheat-soft/40 px-5 py-4">
                <Hourglass aria-hidden className="mt-0.5 size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
                <div>
                  <p className="font-medium">{t("notRunTitle")}</p>
                  <p className="text-sm text-ink-muted">{t("notRunBody")}</p>
                </div>
              </div>
              {/* Scrolls sideways inside the card on a phone; the page itself never does. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left">
                  <caption id="proof-table" className="px-5 pb-1 pt-4 text-left font-display text-xl">
                    {t("tableCaption")}
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-sm text-ink-muted">
                      <th scope="col" className="px-5 py-3 font-medium">{t("colMeasure")}</th>
                      {policies.map((policy) => (
                        <th key={policy.key} scope="col" className={`px-4 py-3 font-medium ${policy.vaari ? "bg-field-soft/50 text-field" : ""}`}>
                          {t(policy.key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((key) => (
                      <tr key={key} className="border-b border-line last:border-b-0">
                        <th scope="row" className="px-5 py-4 align-top font-normal">{t(key)}</th>
                        {policies.map((policy) => (
                          <td key={policy.key} className={`px-4 py-4 align-top ${policy.vaari ? "bg-field-soft/50" : ""}`}>
                            <span className="inline-flex whitespace-nowrap rounded-full border border-dashed border-ink-muted/50 px-2 py-0.5 text-xs text-ink-muted">{t("cellPending")}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="flex items-start gap-2 border-t border-line px-5 py-4 text-sm text-ink-muted">
                <Ruler aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                {t("spreadNote")}
              </p>
            </section>
          }
          aside={
            <AsideCard icon={<FlaskConical className="size-5" strokeWidth={1.75} />} title={t("assumptionsTitle")}>
              <ul className="space-y-3">
                {assumptions.map((key) => (
                  <li key={key} className="border-l-2 border-wheat pl-3">{t(key)}</li>
                ))}
              </ul>
            </AsideCard>
          }
        />
      </PageMain>
    </>
  );
}
