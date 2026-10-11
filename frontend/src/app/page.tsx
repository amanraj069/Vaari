/**
 * Landing, in four parts that share one width and one heading pattern: a full-bleed hero says what
 * Vaari promises; the problem shows why it matters (the smoke, sourced numbers and a chart of real
 * NASA FIRMS detections in one panel); the fix shows how a promised date replaces the wait; the
 * close returns to the opening photo with the two demo roles. What is simulated is said in the hero,
 * the close and the site footer. Every number is from a cited source or
 * computed from data/ (fire-season.json); photos are labelled AI-generated illustrations.
 */
import { CalendarCheck2, ChevronDown, Cpu, Flame, PhoneOff, Satellite, Sprout, Ticket, Tractor, UserCheck, Users, Wind, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDates } from "@/lib/dates";
import { DemoButton } from "@/components/demo-buttons";
import { FireSeasonChart, fireSeasonFacts } from "@/components/fire-season-chart";
import { FireEmbers } from "@/components/fire-embers";
import { LandingPhoto } from "@/components/landing-photo";
import { PAGE_FRAME } from "@/components/page-shell";
import { CountUp, DrawLine, HeroParallax, HeroScrollFade, InViewState, Reveal, RevealImage, Stagger, StaggerItem, Stamp, TokenArrive } from "@/components/landing-motion";
import { SimulatedBadge } from "@/components/simulated-badge";
import { TopBar } from "@/components/top-bar";
import { Timeline } from "@/components/timeline";
import { Pill } from "@/components/ui";
import fireSeason from "@/data/fire-season.json";

const EXAMPLE_DATE = "2026-11-01";

function ExampleToken() {
  const t = useTranslations("landing");
  const tf = useTranslations("farmer");
  const dates = useDates();
  return (
    <TokenArrive className="mx-auto w-full max-w-sm">
      <figure aria-label={t("exampleLabel")} className="relative">
        <div className="absolute -top-3.5 right-6 z-10 rotate-2 whitespace-nowrap rounded-full border border-dashed border-ink-muted/60 bg-paper px-2.5 py-0.5 text-xs text-ink-muted">
          {t("exampleLabel")}
        </div>
        <div className="ticket-notch rounded-card border border-line bg-surface p-5 sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium eyebrow text-ink-muted">{tf("token")}</p>
              <p className="mt-1 font-display text-[1.75rem] leading-none tabular sm:text-4xl">#018</p>
            </div>
            <Stamp>
              <Pill kind="firm" size="lg">{tf("firm")}</Pill>
            </Stamp>
          </div>
          <div className="my-4 border-t border-dashed border-line-strong sm:my-6" />
          <p className="text-sm text-ink-muted sm:text-base">{tf("machineComes")}</p>
          <p className="mt-1 font-display text-xl sm:text-3xl">{dates.weekday(EXAMPLE_DATE)}</p>
          <p className="font-display text-[2.625rem] leading-[1.05] tracking-tight sm:text-6xl">{dates.dayMonth(EXAMPLE_DATE)}</p>
          <div className="mt-6 sm:mt-8">
            <Timeline current="planned" />
          </div>
        </div>
      </figure>
    </TokenArrive>
  );
}

/**
 * The hero headline, word by word: each word rises out of a soft blur in turn, and the last
 * (Vaari) gets a wheat underline drawn like a signature. Plain CSS (globals.css), so it plays from
 * the first paint, before any JavaScript. The message's <em> marks the highlighted words.
 */
function HeroTitle({ message }: { message: string }) {
  const parts = message.split(/(<em>.*?<\/em>)/).filter(Boolean);
  let wordIndex = 0;
  const words = (text: string) =>
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        const index = wordIndex++;
        return (
          <span key={index}>
            <span className="hero-word" style={{ ["--i" as string]: index }}>{word}</span>{" "}
          </span>
        );
      });
  return (
    <>
      {parts.map((part, partIndex) => {
        const highlighted = part.match(/^<em>(.*)<\/em>$/);
        if (!highlighted) return <span key={partIndex}>{words(part)}</span>;
        return (
          <em key={partIndex} className="relative whitespace-nowrap text-wheat-deep">
            {words(highlighted[1]!)}
            <svg aria-hidden viewBox="0 0 200 14" preserveAspectRatio="none" className="hero-swash pointer-events-none absolute -bottom-[0.02em] left-0 h-[0.16em] w-[calc(100%-0.3em)] text-wheat" style={{ ["--i" as string]: wordIndex }}>
              <path d="M3 10 C 45 4, 110 2, 197 7" pathLength={1} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </em>
        );
      })}
    </>
  );
}

/** The platform's one page frame (page-shell.tsx): the landing lines up with the top bar and every app page. */
const CONTAINER = PAGE_FRAME;
/** Every section below the hero has the same vertical rhythm. */
const SECTION_SPACE = "py-14 sm:py-20 md:py-28";

const EYEBROW_TONE = { ember: "text-ember-deep", field: "text-field", wheat: "text-wheat-deep" } as const;

/**
 * The one heading pattern every section uses (icon + eyebrow, serif headline, optional lead), so
 * the sections read as one page. Its pieces rise in turn inside the parent Stagger.
 */
function SectionHeading({ id, icon: Icon, eyebrow, tone, title, body }: { id: string; icon: LucideIcon; eyebrow: string; tone: keyof typeof EYEBROW_TONE; title: string; body?: string }) {
  return (
    <>
      <StaggerItem>
        <p className={`flex items-center gap-2 text-xs font-medium eyebrow sm:text-sm ${EYEBROW_TONE[tone]}`}>
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          {eyebrow}
        </p>
      </StaggerItem>
      <StaggerItem>
        <h2 id={id} className="mt-3 max-w-2xl font-display text-[1.875rem] leading-[1.1] tracking-tight sm:mt-4 sm:text-5xl sm:leading-[1.06]">{title}</h2>
      </StaggerItem>
      {body ? (
        <StaggerItem>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted sm:mt-5 sm:text-lg">{body}</p>
        </StaggerItem>
      ) : null}
    </>
  );
}

function Hero() {
  const t = useTranslations("landing");
  const strip = [
    { icon: Wind, title: t("airTitle"), body: t("airBody") },
    { icon: Sprout, title: t("sowTitle"), body: t("sowBody") },
    { icon: Satellite, title: t("dataTitle"), body: t("dataBody") },
  ];
  return (
    <section aria-labelledby="hero-title" className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
      {/* The photo develops in, drifts slower than the page, and sits right of the text on wide
          screens (the wash fades it out under the words). */}
      <HeroParallax className="hero-photo-in absolute inset-0">
        <LandingPhoto name="hero" priority zoom position="78% center" />
      </HeroParallax>
      <div aria-hidden className="photo-wash-hero absolute inset-0" />

      <HeroScrollFade className={`relative flex flex-1 flex-col justify-center pb-8 pt-28 sm:pb-10 sm:pt-40 ${CONTAINER}`}>
        <p className="hero-rise text-xs font-medium eyebrow text-wheat-deep sm:text-sm" style={{ ["--i" as string]: 0 }}>{t("eyebrow")}</p>
        <h1 id="hero-title" className="mt-4 max-w-2xl font-display text-[2.625rem] leading-[1.04] tracking-tight sm:mt-5 sm:text-7xl sm:leading-[1.02] lg:text-[5.5rem]">
          <HeroTitle message={t.raw("heroTitle") as string} />
        </h1>
        <p className="hero-rise mt-4 flex items-center gap-2 text-sm text-ink-muted" style={{ ["--i" as string]: 6 }}>
          <span lang="pa" className="font-display text-xl text-ink sm:text-2xl">ਵਾਰੀ</span>
          <span>{t("heroMeaning")}</span>
        </p>
        <p className="hero-rise mt-5 max-w-xl text-base leading-relaxed text-ink sm:mt-6 sm:text-xl" style={{ ["--i" as string]: 7 }}>{t("heroBody")}</p>
        <div className="hero-rise mt-7 flex flex-wrap gap-3 sm:mt-9 sm:gap-4" style={{ ["--i" as string]: 8 }}>
          <DemoButton role="farmer" label={t("tryFarmer")} variant="accent" className="w-full sm:w-auto" />
          <DemoButton role="operator" label={t("tryOperator")} className="w-full sm:w-auto" />
        </div>
      </HeroScrollFade>

      <div className="relative">
        <span aria-hidden className="hero-rule absolute inset-x-0 top-0 block h-px bg-line" />
        <ul className={`grid gap-4 py-5 sm:grid-cols-3 sm:gap-0 sm:py-7 ${CONTAINER}`}>
          {strip.map((item, index) => (
            <li key={item.title} className={`hero-rise flex items-center gap-4 ${index > 0 ? "sm:border-l sm:border-line sm:pl-6" : ""}`} style={{ ["--i" as string]: 10 + index }}>
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-surface/80 backdrop-blur-sm sm:size-12">
                <item.icon className="size-5 text-wheat-deep sm:size-6" strokeWidth={1.5} />
              </span>
              <span>
                <span className="block text-[0.9375rem] font-medium sm:text-base">{item.title}</span>
                <span className="block text-[0.8125rem] text-ink-muted sm:text-sm">{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <a href="#problem" className="hero-rise absolute -top-14 left-1/2 hidden size-11 -translate-x-1/2 place-items-center rounded-full border border-line-strong bg-surface/80 text-ink-muted backdrop-blur-sm transition-colors hover:text-ink md:grid" style={{ ["--i" as string]: 14 }} aria-label={t("scrollCue")}>
          <ChevronDown aria-hidden className="size-5 motion-safe:animate-bounce" strokeWidth={1.75} />
        </a>
      </div>
    </section>
  );
}

/**
 * The problem in one section: the story and the smoke side by side, then one evidence panel
 * (sourced figures over the FIRMS chart), then the turn to the fix.
 */
function Problem() {
  const t = useTranslations("landing");
  const facts = fireSeasonFacts();
  const stats = [
    // The Tribune, 2 October 2025: "663 hotspot villages across eight districts ... 6,815 of the
    // 10,909 farm fires reported in 2024". The link is in the messages (stat1SourceUrl).
    { value: 10909, label: t("stat1Label"), source: t("stat1Source"), url: t("stat1SourceUrl") },
    { value: 663, label: t("stat2Label"), source: t("stat1Source"), url: t("stat1SourceUrl") },
    { value: fireSeason.detectionsBySeason["2024"], label: t("stat3Label"), source: t("stat3Source"), url: null },
    { value: facts.optimumShare, suffix: "%", label: t("stat4Label"), source: t("stat3Source"), url: null },
  ];
  return (
    <section id="problem" aria-labelledby="problem-title" className={`scroll-mt-4 ${SECTION_SPACE}`}>
      <div className={CONTAINER}>
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-10 lg:gap-16">
          <Stagger>
            <SectionHeading id="problem-title" icon={Flame} eyebrow={t("problemEyebrow")} tone="ember" title={t("problemTitle")} body={t("problemBody")} />
            <StaggerItem>
              <blockquote className="relative mt-6 max-w-xl pl-4 sm:mt-8 sm:pl-5">
                <DrawLine axis="y" className="absolute inset-y-0 left-0 w-0.5 bg-wheat" />
                <p className="font-display text-xl leading-snug sm:text-2xl">{t("fact1")}</p>
                <footer className="mt-2 text-sm text-ink-muted">{t("fact1Source")}</footer>
              </blockquote>
            </StaggerItem>
          </Stagger>
          <RevealImage className="relative aspect-[4/3] overflow-hidden rounded-card border border-line">
            {/* Burning stubble: the photo's fire line runs right of centre, so keep that in frame. */}
            <LandingPhoto
              name="smoke"
              position="62% center"
              imgClassName="scale-[1.14] origin-[62%_60%]"
              sizes="(min-width: 768px) 50vw, 100vw"
            />
            <div aria-hidden className="ember-glow absolute inset-0" />
            <FireEmbers />
          </RevealImage>
        </div>

        <Reveal className="mt-10 overflow-hidden rounded-card border border-line bg-surface sm:mt-14 md:mt-20">
          <Stagger as="dl" gap={0.1} className="grid grid-cols-2 gap-px border-b border-line bg-line lg:grid-cols-4">
            {stats.map((stat) => (
              <StaggerItem key={stat.label} className="flex flex-col bg-surface p-4 sm:p-7">
                <dt className="order-2 mt-2 text-[0.8125rem] leading-snug text-ink sm:text-base">{stat.label}</dt>
                <dd className="order-1 font-display text-[1.75rem] leading-none tracking-tight text-ember-deep tabular sm:text-5xl">
                  <CountUp value={stat.value} suffix={stat.suffix} />
                </dd>
                <dd className="order-3 mt-2 text-xs text-ink-muted">
                  {stat.url ? (
                    <a href={stat.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2 hover:text-ink">
                      {stat.source}
                    </a>
                  ) : (
                    stat.source
                  )}
                </dd>
              </StaggerItem>
            ))}
          </Stagger>
          <InViewState>
            <FireSeasonChart framed={false} />
          </InViewState>
        </Reveal>

        <Reveal>
          <p className="mt-10 max-w-3xl font-display text-xl leading-snug sm:mt-12 sm:text-3xl md:mt-16">{t("problemTurn")}</p>
        </Reveal>
      </div>
    </section>
  );
}

/** The fix: what Vaari changes (before and after, the example token), then how it decides. */
function Fix() {
  const t = useTranslations("landing");
  const dates = useDates();
  const steps = [
    { icon: Cpu, title: t("how1Title"), body: t("how1Body") },
    { icon: UserCheck, title: t("how2Title"), body: t("how2Body") },
    { icon: CalendarCheck2, title: t("how3Title"), body: t("how3Body") },
  ];
  return (
    <section id="how" aria-labelledby="how-title" className={`scroll-mt-4 border-y border-line bg-surface/60 ${SECTION_SPACE}`}>
      <div className={`grid items-center gap-12 md:grid-cols-2 md:gap-14 lg:gap-16 ${CONTAINER}`}>
        <Stagger>
          <SectionHeading id="how-title" icon={Ticket} eyebrow={t("fixEyebrow")} tone="field" title={t("fixTitle")} body={t("fixBody")} />
          <StaggerItem className="mt-6 grid max-w-xl gap-3 sm:mt-8 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <PhoneOff aria-hidden className="size-4" strokeWidth={1.75} />
                {t("beforeLabel")}
              </p>
              <p className="mt-1.5 font-display text-lg leading-snug sm:mt-2 sm:text-xl">{t("beforeQuote")}</p>
            </div>
            <div className="rounded-card border border-field/30 bg-field-soft/60 p-4 sm:p-5">
              <p className="flex items-center gap-2 text-sm text-field">
                <Ticket aria-hidden className="size-4" strokeWidth={1.75} />
                {t("afterLabel")}
              </p>
              <p className="mt-1.5 font-display text-lg leading-snug sm:mt-2 sm:text-xl">{t("afterQuote", { date: dates.short(EXAMPLE_DATE) })}</p>
            </div>
          </StaggerItem>
        </Stagger>
        <ExampleToken />
      </div>

      <div className={`mt-12 sm:mt-16 md:mt-20 ${CONTAINER}`}>
        <Reveal>
          <h3 className="font-display text-xl sm:text-3xl">{t("howTitle")}</h3>
        </Reveal>
        <Stagger as="ol" gap={0.15} className="mt-5 grid gap-6 sm:mt-6 sm:gap-8 md:grid-cols-3 md:gap-10">
          {steps.map((step, index) => (
            <StaggerItem as="li" key={step.title} className="relative pt-4 sm:pt-5">
              <DrawLine className="absolute inset-x-0 top-0 h-0.5 bg-ink" />
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="tabular">0{index + 1}</span>
                <step.icon aria-hidden className="size-4" strokeWidth={1.75} />
              </p>
              <h4 className="mt-1.5 text-lg font-medium sm:mt-2 sm:text-xl">{step.title}</h4>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted sm:mt-2 sm:text-base">{step.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/**
 * The close: back to the opening photo, with the two people the demo lets you be. On the left the
 * invitation (one click, and the simulated label); on the right one card per person: what you will
 * see first, who you are, what you do, and the way in under a dashed tear line like a token's. The
 * cards are the same height with their buttons on one line, whatever the text's length or language.
 */
function Closing() {
  const t = useTranslations("landing");
  const roles = [
    {
      key: "farmer",
      icon: Sprout,
      badge: "bg-wheat-soft text-wheat-deep",
      hint: t("tryFarmerHint"),
      title: t("farmerRoleTitle"),
      body: t("farmerRoleBody"),
      button: <DemoButton role="farmer" label={t("tryFarmer")} variant="accent" className="w-full" />,
    },
    {
      key: "operator",
      icon: Tractor,
      badge: "bg-ink text-paper",
      hint: t("tryOperatorHint"),
      title: t("operatorRoleTitle"),
      body: t("operatorRoleBody"),
      button: <DemoButton role="operator" label={t("tryOperator")} className="w-full" />,
    },
  ];
  return (
    <section aria-labelledby="closing-title" className={SECTION_SPACE}>
      <div className={CONTAINER}>
        <Reveal className="relative isolate overflow-hidden rounded-card border border-line">
          <LandingPhoto name="hero" position="80% 70%" sizes="(min-width: 1280px) 1280px, 100vw" />
          <div aria-hidden className="photo-wash-closing absolute inset-0" />
          <Stagger gap={0.12} className="relative grid items-center gap-7 p-4 sm:gap-10 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-14 lg:p-14">
            <div className="px-1 pt-2 sm:p-0">
              <SectionHeading id="closing-title" icon={Users} eyebrow={t("rolesTitle")} tone="wheat" title={t("closingTitle")} body={t("closingBody")} />
              <StaggerItem>
                <p className="mt-5 sm:mt-7">
                  <SimulatedBadge />
                </p>
              </StaggerItem>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              {roles.map((role) => (
                <StaggerItem as="li" key={role.key} className="flex">
                  <article
                    aria-labelledby={`closing-role-${role.key}`}
                    className="lift-card flex w-full flex-col rounded-card border border-line bg-surface/95 p-5 shadow-[0_24px_48px_-32px_rgb(0_0_0/0.5)] backdrop-blur-md sm:p-6"
                  >
                    <div className="flex items-center gap-3">
                      <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full ${role.badge}`}>
                        <role.icon className="size-5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 text-xs font-medium leading-snug text-ink-muted">{role.hint}</span>
                    </div>
                    <h3 id={`closing-role-${role.key}`} className="mt-5 font-display text-xl leading-snug sm:text-[1.375rem]">
                      {role.title}
                    </h3>
                    <p className="mt-2 flex-1 text-[0.8125rem] leading-relaxed text-ink-muted sm:text-sm">{role.body}</p>
                    <div className="mt-5 border-t border-dashed border-line-strong pt-5 sm:mt-6">{role.button}</div>
                  </article>
                </StaggerItem>
              ))}
            </ul>
          </Stagger>
        </Reveal>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      <TopBar overlay />
      {/* overflow-x-clip: a reveal mid-flight (the token's tilt, the stamp's overshoot) must never
          widen a phone screen; clip, unlike hidden, leaves vertical scrolling alone. */}
      <main className="overflow-x-clip">
        <Hero />
        <Problem />
        <Fix />
        <Closing />
      </main>
    </>
  );
}
