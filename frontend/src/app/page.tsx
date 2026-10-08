/**
 * Landing: understandable in 20 seconds. The promise (a date), who it is for, how it decides,
 * what is real, and one click into the demo as a farmer or an operator.
 */
import { CalendarCheck2, Cpu, Flame, Satellite, UserCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { DemoButton } from "@/components/demo-buttons";
import { SimulatedBadge } from "@/components/simulated-badge";
import { TopBar } from "@/components/top-bar";
import { Timeline } from "@/components/timeline";
import { Pill } from "@/components/ui";

function ExampleToken() {
  const t = useTranslations("landing");
  const tf = useTranslations("farmer");
  const format = useFormatter();
  const exampleDate = new Date("2026-11-01T00:00:00Z");
  return (
    <figure aria-label={t("exampleLabel")} className="relative mx-auto w-full max-w-sm">
      <div className="absolute -top-3.5 right-6 z-10 rotate-2 whitespace-nowrap rounded-full border border-dashed border-ink-muted/60 bg-paper px-2.5 py-0.5 text-xs text-ink-muted">
        {t("exampleLabel")}
      </div>
      <div className="ticket-notch rounded-card border border-line bg-surface p-7 sm:p-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium eyebrow text-ink-muted">{tf("token")}</p>
            <p className="font-display text-4xl leading-none tabular">#018</p>
          </div>
          <Pill kind="firm" size="lg">{tf("firm")}</Pill>
        </div>
        <div className="my-6 border-t border-dashed border-line-strong" />
        <p className="text-ink-muted">{tf("machineComes")}</p>
        <p className="font-display text-3xl">{format.dateTime(exampleDate, { weekday: "long", timeZone: "UTC" })}</p>
        <p className="font-display text-6xl leading-none tracking-tight">{format.dateTime(exampleDate, { day: "numeric", month: "short", timeZone: "UTC" })}</p>
        <div className="mt-8">
          <Timeline current="planned" />
        </div>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  const t = useTranslations("landing");
  const steps = [
    { icon: Cpu, title: t("how1Title"), body: t("how1Body") },
    { icon: UserCheck, title: t("how2Title"), body: t("how2Body") },
    { icon: CalendarCheck2, title: t("how3Title"), body: t("how3Body") },
  ];
  return (
    <>
      <TopBar />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 md:grid-cols-[1.2fr_1fr] md:gap-16 md:pb-28 md:pt-24">
          <div>
            <p className="text-sm font-medium eyebrow text-wheat-deep">{t("eyebrow")}</p>
            <h1 className="mt-5 font-display text-4xl leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">{t("heroTitle")}</h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-muted">{t("heroBody")}</p>
            <div className="mt-10 grid gap-3 sm:flex sm:flex-wrap sm:gap-4">
              <DemoButton role="farmer" label={t("tryFarmer")} variant="accent" className="w-full sm:w-auto" />
              <DemoButton role="operator" label={t("tryOperator")} className="w-full sm:w-auto" />
            </div>
            <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">
              {t("tryNote")} <SimulatedBadge />
            </p>
          </div>
          <ExampleToken />
        </section>

        <section className="border-y border-line bg-surface/60">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-2">
            <h2 className="font-display text-3xl md:col-span-2">{t("rolesTitle")}</h2>
            <article className="rounded-card border border-line bg-surface p-6">
              <h3 className="font-display text-2xl">{t("farmerRoleTitle")}</h3>
              <p className="mt-2 text-ink-muted">{t("farmerRoleBody")}</p>
              <div className="mt-5"><DemoButton role="farmer" label={t("tryFarmer")} variant="accent" /></div>
            </article>
            <article className="rounded-card border border-line bg-surface p-6">
              <h3 className="font-display text-2xl">{t("operatorRoleTitle")}</h3>
              <p className="mt-2 text-ink-muted">{t("operatorRoleBody")}</p>
              <div className="mt-5"><DemoButton role="operator" label={t("tryOperator")} /></div>
            </article>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="font-display text-3xl">{t("howTitle")}</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="border-t-2 border-ink pt-4">
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="tabular">0{index + 1}</span>
                  <step.icon aria-hidden className="size-4" strokeWidth={1.75} />
                </p>
                <h3 className="mt-2 text-xl font-medium">{step.title}</h3>
                <p className="mt-2 text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-20 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl">{t("factsTitle")}</h2>
            <dl className="mt-5 space-y-5">
              {[
                [t("fact1"), t("fact1Source")],
                [t("fact2"), t("fact2Source")],
              ].map(([fact, source]) => (
                <div key={source} className="border-l-2 border-wheat pl-4">
                  <dt className="text-lg">{fact}</dt>
                  <dd className="mt-1 text-sm text-ink-muted">{source}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="space-y-4">
            <div className="rounded-card border border-dashed border-ink-muted/50 p-5">
              <h2 className="flex items-center gap-2 font-medium"><Satellite aria-hidden className="size-4" strokeWidth={1.75} />{t("honestyTitle")}</h2>
              <p className="mt-2 text-sm text-ink-muted">{t("honestyBody")}</p>
            </div>
            <div className="rounded-card border border-line bg-surface p-5">
              <h2 className="flex items-center gap-2 font-medium"><Flame aria-hidden className="size-4 text-ember" strokeWidth={1.75} />{t("fireMapTitle")}</h2>
              <p className="mt-2 text-sm text-ink-muted">{t("fireMapPending")}</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
