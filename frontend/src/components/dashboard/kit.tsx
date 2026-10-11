"use client";

/**
 * The dashboard's building blocks, so every role's pages read as one product: a page heading
 * (context line, title, the page's main action), panels with a header row, stat cards with a
 * small picture of the number, a meter, a segmented filter, a search box, and the "what to do
 * now" card that tells someone new exactly what the next step is. Flat, bordered, quiet.
 */
import { Search, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { EASE_OUT, RISE, STAGGER } from "./motion";

export function DashHeader({ context, title, description, meta, actions }: { context?: ReactNode; title: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <motion.header variants={RISE} className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {context ? <p className="text-sm text-ink-muted">{context}</p> : null}
        <h1 className="mt-1 font-display text-[26px] leading-tight sm:text-[30px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[15px] text-ink-muted">{description}</p> : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </motion.header>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "p-5",
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <motion.section variants={RISE} aria-labelledby={title && id ? id : undefined} className={`min-w-0 rounded-card border border-line bg-surface ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-t-[inherit] border-b border-line bg-sunken/70 px-5 py-4">
          <div className="min-w-0">
            <h2 id={id} className="text-base font-semibold">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </motion.section>
  );
}

/** A thin bar for a share: a coloured fill on a neutral track, so the colour is only the amount. */
export function Meter({ value, max, tone = "good", label }: { value: number; max: number; tone?: "good" | "risk" | "warn" | "accent"; label?: string }) {
  const share = max <= 0 ? 0 : Math.min(1, value / max);
  const fill = { good: "bg-field", risk: "bg-ember", warn: "bg-wheat", accent: "bg-wheat-deep" }[tone];
  return (
    <div role={label ? "meter" : undefined} aria-label={label} aria-valuenow={label ? value : undefined} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? max : undefined} className="h-1.5 w-full overflow-hidden rounded-full bg-line/80">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

/** Parts of a whole as one bar with 2px gaps; every part also has a word somewhere next to it. */
export function SplitBar({ parts }: { parts: { key: string; value: number; colour: string }[] }) {
  const shown = parts.filter((part) => part.value > 0);
  if (shown.length === 0) return <div aria-hidden className="h-1.5 w-full rounded-full bg-line" />;
  return (
    <div aria-hidden className="flex h-1.5 w-full gap-0.5">
      {shown.map((part) => (
        <span key={part.key} className="h-full rounded-full" style={{ flexGrow: part.value, background: part.colour }} />
      ))}
    </div>
  );
}

/**
 * A filter drawn like the sign-in page's helper / operator / officer switch: one track of equal
 * tiles (icon, word, count) with the chosen tile sliding under the choice. A radiogroup: one tab
 * stop, arrow keys move and choose. On phones it takes the full width; from sm up each tile is
 * at least 7.5rem wide, so Punjabi and Hindi labels fit.
 */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: Value; label: string; count?: number; icon?: LucideIcon }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const slideId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = Math.max(0, options.findIndex((option) => option.value === value));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid w-full gap-1 rounded-card border border-line bg-paper p-1.5 sm:ml-auto sm:w-auto"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const checked = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-control px-1 py-1.5 text-sm font-medium sm:px-2 sm:py-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:min-w-[7.5rem] sm:flex-row sm:gap-1.5"
          >
            {checked ? (
              <motion.span layoutId={`segmented-${slideId}`} aria-hidden className="absolute inset-0 rounded-control border border-line-strong bg-raised shadow-control" transition={{ type: "spring", stiffness: 520, damping: 42 }} />
            ) : null}
            {Icon ? <Icon aria-hidden className={`relative size-4 shrink-0 transition-colors duration-200 ${checked ? "text-ink" : "text-ink-muted"}`} strokeWidth={1.75} /> : null}
            {/* Phones: up to two lines of smaller type, never a cut word; wider screens: one line. */}
            <span className={`relative line-clamp-2 max-w-full text-center text-xs leading-tight transition-colors duration-200 sm:line-clamp-none sm:truncate sm:text-sm ${checked ? "text-ink" : "text-ink-muted hover:text-ink"}`}>{option.label}</span>
            {option.count !== undefined ? (
              <span className={`relative rounded-full px-1.5 text-xs tabular transition-colors duration-200 ${checked ? "bg-ink text-paper" : "text-ink-muted"}`}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SearchBox({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="relative flex min-w-[min(100%,14rem)] flex-1 items-center sm:max-w-xs">
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-ink-muted" strokeWidth={1.75} />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? label}
        className="min-h-11 w-full rounded-control border border-line-strong bg-raised pl-9 pr-3 text-sm placeholder:text-ink-muted/80 focus:border-ink/50 focus:outline-none shadow-control"
      />
    </label>
  );
}

/**
 * "What to do now": one sentence, why, and the one button that does it. Always a surface card with a
 * hairline (never a tinted box); the tone is a solid mark beside the words: wheat for "waiting for
 * you", green for "all done", neutral otherwise.
 */
export function NextStep({ icon: Icon, title, body, action, tone = "neutral" }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; tone?: "neutral" | "warn" | "good" }) {
  const frame = tone === "warn" ? "border-wheat/45" : "border-line";
  const iconTone = tone === "warn" ? "bg-wheat-solid text-on-solid" : tone === "good" ? "bg-field-solid text-on-solid" : "bg-paper text-ink-muted ring-1 ring-inset ring-line";
  return (
    <motion.section variants={RISE} aria-live="polite" className={`flex flex-wrap items-center gap-4 rounded-card border bg-surface p-4 sm:p-5 ${frame}`}>
      <span aria-hidden className={`icon-tile grid size-10 shrink-0 place-items-center rounded-control ${iconTone}`}>
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {body ? <p className="mt-0.5 text-sm text-ink-muted">{body}</p> : null}
      </div>
      {action}
    </motion.section>
  );
}

/** A small legend key: a coloured mark beside its word (the word is never coloured). */
export function LegendKey({ colour, label, shape = "square" }: { colour: string; label: ReactNode; shape?: "square" | "line" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span aria-hidden className={shape === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]"} style={{ background: colour }} />
      {label}
    </span>
  );
}

/**
 * A ring for parts of a whole (at most four), with the total in the middle and a legend that
 * gives every part its count in words, so the ring is never the only way to read it. 2px gaps
 * between segments.
 */
export function Donut({ parts, total, centreLabel, label }: { parts: { key: string; label: string; value: number; colour: string }[]; total: number; centreLabel: string; label: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 && parts.filter((part) => part.value > 0).length > 1 ? 2.5 : 0;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 100 100" className="size-32 shrink-0 -rotate-90" role="img" aria-label={label}>
        <circle cx={50} cy={50} r={radius} fill="none" strokeWidth={11} className="stroke-line" />
        {total > 0
          ? parts.map((part) => {
              const length = (part.value / total) * circumference;
              const dash = Math.max(0, length - gap);
              const circle = part.value > 0 ? <circle key={part.key} cx={50} cy={50} r={radius} fill="none" strokeWidth={11} stroke={part.colour} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} /> : null;
              offset += length;
              return circle;
            })
          : null}
        <text x={50} y={50} transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[22px] font-semibold tabular">
          {total}
        </text>
        <text x={50} y={66} transform="rotate(90 50 50)" textAnchor="middle" className="fill-ink-muted text-[8px]">
          {centreLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: part.colour }} />
              <span className="truncate">{part.label}</span>
            </span>
            <span className="font-medium tabular">{part.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type Metric = { label: string; value: string; sub?: ReactNode; tone?: "neutral" | "good" | "risk" | "warn"; visual?: ReactNode; hint?: string };

/**
 * The page's key numbers as one strip divided by hairlines (the way analytics tools set them),
 * not a row of separate icon cards: label, number, one line of context, and optionally a small
 * picture of the number. Wraps to two or three columns on narrower screens.
 */
export function MetricStrip({ metrics, label, columns = "xl:grid-cols-4" }: { metrics: Metric[]; label: string; columns?: string }) {
  const toneText = { neutral: "text-ink", good: "text-field", risk: "text-ember-deep", warn: "text-wheat-deep" } as const;
  return (
    <motion.dl variants={RISE} aria-label={label} className={`grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3 ${columns}`}>
      {metrics.map((metric) => (
        <div key={metric.label} title={metric.hint} className="flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5">
          <dt className="text-[13px] leading-snug text-ink-muted">{metric.label}</dt>
          <dd className={`mt-2 text-[26px] font-semibold leading-none tabular ${toneText[metric.tone ?? "neutral"]}`}>{metric.value}</dd>
          {metric.sub ? <dd className="mt-1.5 text-xs leading-snug text-ink-muted">{metric.sub}</dd> : null}
          {metric.visual ? <dd className="mt-auto pt-3">{metric.visual}</dd> : null}
        </div>
      ))}
    </motion.dl>
  );
}


/**
 * Content that belongs to one day (the machines' lanes): switching days slides the old day out and
 * the new one in, in the direction of travel (a later day comes from the right), never a hard cut.
 */
/**
 * The machines' lanes while a picked day loads: the day's name with a spinner, and one quiet row per
 * machine in the lanes' shape, so the click answers at once and the panel keeps its height.
 */
export function DayLoading({ label, rows }: { label: string; rows: number }) {
  return (
    <div aria-busy="true">
      <p role="status" className="flex items-center gap-2 border-b border-line px-5 py-3 text-sm text-ink-muted">
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-line border-t-wheat-deep" />
        {label}
      </p>
      <ul aria-hidden>
        {Array.from({ length: Math.max(1, rows) }, (_, index) => (
          <li key={index} className="grid gap-4 border-b border-line px-5 py-4 last:border-b-0 md:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="h-4 w-32 animate-pulse rounded-full bg-line/60" />
              <div className="h-3 w-24 animate-pulse rounded-full bg-line/60" />
            </div>
            <div className="h-20 animate-pulse rounded-control bg-line/40" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DayTransition({ dayKey, children, className = "" }: { dayKey: string; children: ReactNode; className?: string }) {
  const previous = useRef(dayKey);
  const direction = dayKey >= previous.current ? 1 : -1;
  useEffect(() => {
    previous.current = dayKey;
  }, [dayKey]);
  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={dayKey}
        custom={direction}
        variants={{
          enter: (towards: number) => ({ opacity: 0, x: 24 * towards }),
          center: { opacity: 1, x: 0, transition: { duration: 0.32, ease: EASE_OUT } },
          exit: (towards: number) => ({ opacity: 0, x: -24 * towards, transition: { duration: 0.16, ease: "easeIn" } }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export { STAGGER };
