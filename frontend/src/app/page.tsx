/**
 * Landing, in four parts that share one width and one heading pattern: a full-bleed hero says what
 * Vaari promises; the problem shows why it matters (the smoke, sourced numbers and a chart of real
 * NASA FIRMS detections in one panel); the fix shows how a promised date replaces the wait; the
 * close returns to the opening photo with the two demo roles. Fine print (yield cost, what is
 * simulated, credits) lives in the footer. Every number is from CLAUDE.md's sourced facts or
 * computed from data/ (fire-season.json); photos are labelled AI-generated illustrations.
 */
import { CalendarCheck2, ChevronDown, Cpu, Flame, FlaskConical, PhoneOff, Satellite, Sprout, Ticket, UserCheck, Wheat, Wind, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDates } from "@/lib/dates";
import { DemoButton } from "@/components/demo-buttons";
import { FireSeasonChart, fireSeasonFacts } from "@/components/fire-season-chart";
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
        <div className="ticket-notch rounded-card border border-line bg-surface p-7 sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium eyebrow text-ink-muted">{tf("token")}</p>
              <p className="font-display text-4xl leading-none tabular">#018</p>
            </div>
            <Stamp>
              <Pill kind="firm" size="lg">{tf("firm")}</Pill>
            </Stamp>
          </div>
          <div className="my-6 border-t border-dashed border-line-strong" />
          <p className="text-ink-muted">{tf("machineComes")}</p>
          <p className="font-display text-3xl">{dates.weekday(EXAMPLE_DATE)}</p>
          <p className="font-display text-6xl leading-none tracking-tight">{dates.dayMonth(EXAMPLE_DATE)}</p>
          <div className="mt-8">
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
const SECTION_SPACE = "py-20 md:py-28";

const EYEBROW_TONE = { ember: "text-ember-deep", field: "text-field", wheat: "text-wheat-deep" } as const;

/**
 * The one heading pattern every section uses (icon + eyebrow, serif headline, optional lead), so
 * the sections read as one page. Its pieces rise in turn inside the parent Stagger.
 */
function SectionHeading({ id, icon: Icon, eyebrow, tone, title, body }: { id: string; icon: LucideIcon; eyebrow: string; tone: keyof typeof EYEBROW_TONE; title: string; body?: string }) {
  return (
    <>
      <StaggerItem>
        <p className={`flex items-center gap-2 text-sm font-medium eyebrow ${EYEBROW_TONE[tone]}`}>
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          {eyebrow}
        </p>
      </StaggerItem>
      <StaggerItem>
        <h2 id={id} className="mt-4 max-w-2xl font-display text-4xl leading-[1.06] tracking-tight sm:text-5xl">{title}</h2>
      </StaggerItem>
      {body ? (
        <StaggerItem>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">{body}</p>
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

      <HeroScrollFade className={`relative flex flex-1 flex-col justify-center pb-10 pt-36 sm:pt-40 ${CONTAINER}`}>
        <p className="hero-rise text-xs font-medium eyebrow text-wheat-deep sm:text-sm" style={{ ["--i" as string]: 0 }}>{t("eyebrow")}</p>
        <h1 id="hero-title" className="mt-5 max-w-2xl font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl lg:text-[5.5rem]">
          <HeroTitle message={t.raw("heroTitle") as string} />
        </h1>
        <p className="hero-rise mt-4 flex items-center gap-2 text-sm text-ink-muted" style={{ ["--i" as string]: 6 }}>
          <span lang="pa" className="font-display text-2xl text-ink">ਵਾਰੀ</span>
          <span>{t("heroMeaning")}</span>
        </p>
        <p className="hero-rise mt-6 max-w-xl text-lg leading-relaxed text-ink sm:text-xl" style={{ ["--i" as string]: 7 }}>{t("heroBody")}</p>
        <div className="hero-rise mt-9 grid gap-4 sm:flex sm:flex-wrap sm:gap-5" style={{ ["--i" as string]: 8 }}>
          <div className="flex flex-col gap-1.5">
            <DemoButton role="farmer" label={t("tryFarmer")} variant="accent" className="w-full sm:w-auto" />
            <span className="text-center text-sm text-ink-muted">{t("tryFarmerHint")}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <DemoButton role="operator" label={t("tryOperator")} className="w-full sm:w-auto" />
            <span className="text-center text-sm text-ink-muted">{t("tryOperatorHint")}</span>
          </div>
        </div>
        <p className="hero-rise mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted" style={{ ["--i" as string]: 9 }}>
          {t("tryNote")} <SimulatedBadge />
        </p>
      </HeroScrollFade>

      <div className="relative">
        <span aria-hidden className="hero-rule absolute inset-x-0 top-0 block h-px bg-line" />
        <ul className={`grid gap-5 py-6 sm:grid-cols-3 sm:gap-0 sm:py-7 ${CONTAINER}`}>
          {strip.map((item, index) => (
            <li key={item.title} className={`hero-rise flex items-center gap-4 ${index > 0 ? "sm:border-l sm:border-line sm:pl-6" : ""}`} style={{ ["--i" as string]: 10 + index }}>
              <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full border border-line-strong bg-surface/80 backdrop-blur-sm">
                <item.icon className="size-6 text-wheat-deep" strokeWidth={1.5} />
              </span>
              <span>
                <span className="block font-medium">{item.title}</span>
                <span className="block text-sm text-ink-muted">{item.body}</span>
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
    { value: 10909, label: t("stat1Label"), source: t("stat1Source") },
    { value: 663, label: t("stat2Label"), source: t("stat1Source") },
    { value: fireSeason.detectionsBySeason["2024"], label: t("stat3Label"), source: t("stat3Source") },
    { value: facts.optimumShare, suffix: "%", label: t("stat4Label"), source: t("stat3Source") },
  ];
  return (
    <section id="problem" aria-labelledby="problem-title" className={`scroll-mt-4 ${SECTION_SPACE}`}>
      <div className={CONTAINER}>
        <div className="grid items-center gap-10 md:grid-cols-2 lg:gap-16">
          <Stagger>
            <SectionHeading id="problem-title" icon={Flame} eyebrow={t("problemEyebrow")} tone="ember" title={t("problemTitle")} body={t("problemBody")} />
            <StaggerItem>
              <blockquote className="relative mt-8 max-w-xl pl-5">
                <DrawLine axis="y" className="absolute inset-y-0 left-0 w-0.5 bg-wheat" />
                <p className="font-display text-2xl leading-snug">{t("fact1")}</p>
                <footer className="mt-2 text-sm text-ink-muted">{t("fact1Source")}</footer>
              </blockquote>
            </StaggerItem>
          </Stagger>
          <RevealImage className="relative aspect-[4/3] overflow-hidden rounded-card border border-line">
            {/* Burning stubble: the photo's fire line runs right of centre, so keep that in frame. */}
            <LandingPhoto name="smoke" position="62% center" sizes="(min-width: 768px) 50vw, 100vw" />
            <div aria-hidden className="ember-glow absolute inset-0" />
          </RevealImage>
        </div>

        <Reveal className="mt-14 overflow-hidden rounded-card border border-line bg-surface md:mt-20">
          <Stagger as="dl" gap={0.1} className="grid grid-cols-2 gap-px border-b border-line bg-line lg:grid-cols-4">
            {stats.map((stat) => (
              <StaggerItem key={stat.label} className="flex flex-col bg-surface p-4 sm:p-7">
                <dt className="order-2 mt-2 text-sm text-ink sm:text-base">{stat.label}</dt>
                <dd className="order-1 font-display text-3xl leading-none tracking-tight text-ember-deep tabular sm:text-5xl">
                  <CountUp value={stat.value} suffix={stat.suffix} />
                </dd>
                <dd className="order-3 mt-2 text-xs text-ink-muted">{stat.source}</dd>
              </StaggerItem>
            ))}
          </Stagger>
          <InViewState>
            <FireSeasonChart framed={false} />
          </InViewState>
        </Reveal>

        <Reveal>
          <p className="mt-12 max-w-3xl font-display text-2xl leading-snug sm:text-3xl md:mt-16">{t("problemTurn")}</p>
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
      <div className={`grid items-center gap-14 md:grid-cols-2 lg:gap-16 ${CONTAINER}`}>
        <Stagger>
          <SectionHeading id="how-title" icon={Ticket} eyebrow={t("fixEyebrow")} tone="field" title={t("fixTitle")} body={t("fixBody")} />
          <StaggerItem className="mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-5">
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <PhoneOff aria-hidden className="size-4" strokeWidth={1.75} />
                {t("beforeLabel")}
              </p>
              <p className="mt-2 font-display text-xl">{t("beforeQuote")}</p>
            </div>
            <div className="rounded-card border border-field/30 bg-field-soft/60 p-5">
              <p className="flex items-center gap-2 text-sm text-field">
                <Ticket aria-hidden className="size-4" strokeWidth={1.75} />
                {t("afterLabel")}
              </p>
              <p className="mt-2 font-display text-xl">{t("afterQuote", { date: dates.short(EXAMPLE_DATE) })}</p>
            </div>
          </StaggerItem>
        </Stagger>
        <ExampleToken />
      </div>

      <div className={`mt-16 md:mt-20 ${CONTAINER}`}>
        <Reveal>
          <h3 className="font-display text-2xl sm:text-3xl">{t("howTitle")}</h3>
        </Reveal>
        <Stagger as="ol" gap={0.15} className="mt-6 grid gap-8 md:grid-cols-3 md:gap-10">
          {steps.map((step, index) => (
            <StaggerItem as="li" key={step.title} className="relative pt-5">
              <DrawLine className="absolute inset-x-0 top-0 h-0.5 bg-ink" />
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="tabular">0{index + 1}</span>
                <step.icon aria-hidden className="size-4" strokeWidth={1.75} />
              </p>
              <h4 className="mt-2 text-xl font-medium">{step.title}</h4>
              <p className="mt-2 text-ink-muted">{step.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/**
 * The close: back to the opening photo, with the two people the demo lets you be. Their cards are
 * the page's last call to action (they replace a separate roles section).
 */
function Closing() {
  const t = useTranslations("landing");
  const roles = [
    { title: t("farmerRoleTitle"), body: t("farmerRoleBody"), button: <DemoButton role="farmer" label={t("tryFarmer")} variant="accent" className="w-full sm:w-auto" /> },
    { title: t("operatorRoleTitle"), body: t("operatorRoleBody"), button: <DemoButton role="operator" label={t("tryOperator")} className="w-full sm:w-auto" /> },
  ];
  return (
    <section aria-labelledby="closing-title" className={SECTION_SPACE}>
      <div className={CONTAINER}>
        <Reveal className="relative isolate overflow-hidden rounded-card border border-line">
          <LandingPhoto name="hero" position="80% 70%" sizes="(min-width: 1280px) 1280px, 100vw" />
          <div aria-hidden className="photo-wash-closing absolute inset-0" />
          <Stagger gap={0.12} className="relative grid items-end gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.15fr] lg:gap-12 lg:p-14">
            <div>
              <SectionHeading id="closing-title" icon={Sprout} eyebrow={t("rolesTitle")} tone="wheat" title={t("closingTitle")} body={t("closingBody")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {roles.map((role) => (
                <StaggerItem as="article" key={role.title} className="lift-card flex flex-col rounded-card border border-line bg-surface/90 p-6 backdrop-blur-md">
                  <h3 className="font-display text-2xl">{role.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{role.body}</p>
                  <div className="mt-5">{role.button}</div>
                </StaggerItem>
              ))}
            </div>
          </Stagger>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * Fine print, kept on the page because honesty is part of the product: the yield cost behind the
 * dates, what is simulated, the fire map's status, and photo and data credits.
 */
function LandingFooter() {
  const t = useTranslations("landing");
  const notes = [
    { icon: Wheat, title: t("factsTitle"), body: t("fact2"), source: t("fact2Source") },
    { icon: FlaskConical, title: t("honestyTitle"), body: t("honestyBody") },
    { icon: Satellite, title: t("fireMapTitle"), body: t("fireMapPending") },
  ];
  return (
    <footer className="border-t border-line">
      <Stagger gap={0.1} className={`grid gap-10 py-14 md:grid-cols-3 md:gap-12 ${CONTAINER}`}>
        {notes.map((note) => (
          <StaggerItem key={note.title}>
            <h2 className="flex items-center gap-2 font-medium">
              <note.icon aria-hidden className="size-4 text-wheat-deep" strokeWidth={1.75} />
              {note.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{note.body}</p>
            {note.source ? <p className="mt-2 text-xs text-ink-muted">{note.source}</p> : null}
          </StaggerItem>
        ))}
      </Stagger>
      <div className="border-t border-line">
        <div className={`flex flex-col gap-1.5 py-6 text-sm text-ink-muted ${CONTAINER}`}>
          <p>{t("footerPhotos")}</p>
          <p>{t("footerCredits")}</p>
        </div>
      </div>
    </footer>
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
      <LandingFooter />
    </>
  );
}
