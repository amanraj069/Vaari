/**
 * Small primitives with the Vaari look: flat, bordered, large tap targets.
 * Risk and promise state always show an icon and a word, never colour alone.
 */
import Link from "next/link";
import { AlertTriangle, CalendarCheck2, CalendarRange, CheckCheck, CircleDashed, Clock3, CloudOff, FilePenLine, Hourglass, Inbox, Loader2, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "accent" | "secondary" | "quiet" | "danger" | "dangerQuiet";
// btn-solid / btn-outline pick the hover lift and shadow in globals.css (the micro-interactions block).
const VARIANT: Record<Variant, string> = {
  primary: "btn-solid bg-ink text-paper hover:bg-ink/90 border border-ink",
  accent: "btn-solid bg-action text-on-action hover:bg-action/90 border border-action",
  secondary: "btn-outline bg-raised text-ink shadow-control border border-line-strong hover:border-ink/50",
  quiet: "bg-transparent text-ink hover:bg-ink/5 border border-transparent",
  // Destructive actions: the confirming dialog's button is red; on a card the action is quiet until
  // hovered, so a grid of cards is not a grid of red words (ember is for burn risk).
  danger: "btn-solid bg-ember-solid text-on-solid hover:bg-ember-solid/90 border border-ember-solid",
  dangerQuiet: "bg-transparent text-ink-muted hover:text-ember-deep hover:bg-ember-soft/60 border border-transparent",
};
const BASE =
  "btn inline-flex items-center justify-center gap-2 rounded-control px-5 min-h-11 font-medium disabled:opacity-50 disabled:cursor-not-allowed";

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-card border border-line bg-surface ${className}`}>{children}</div>;
}

export type PillKind = "firm" | "window" | "requested" | "safe" | "tight" | "at_risk" | "unplanned" | "approved" | "draft" | "done";

// Healthy and pending states are a neutral chip with a coloured icon; only risk gets a tinted chip,
// so a screen of on-track fields stays calm and the one at risk stands out.
const NEUTRAL_CHIP = "bg-surface text-ink border-line-strong/80";
const PILL: Record<PillKind, { className: string; iconClassName: string; Icon: typeof ShieldCheck }> = {
  firm: { className: NEUTRAL_CHIP, iconClassName: "text-field", Icon: CalendarCheck2 },
  window: { className: NEUTRAL_CHIP, iconClassName: "text-sky", Icon: CalendarRange },
  // Waiting for the operator's next plan: not a risk, so not ember.
  requested: { className: NEUTRAL_CHIP, iconClassName: "text-wheat-deep", Icon: Hourglass },
  safe: { className: NEUTRAL_CHIP, iconClassName: "text-field", Icon: ShieldCheck },
  tight: { className: NEUTRAL_CHIP, iconClassName: "text-wheat-deep", Icon: Clock3 },
  at_risk: { className: "bg-ember-soft text-ember-deep border-ember/35", iconClassName: "", Icon: AlertTriangle },
  unplanned: { className: "bg-ember-soft text-ember-deep border-ember/35", iconClassName: "", Icon: CircleDashed },
  approved: { className: NEUTRAL_CHIP, iconClassName: "text-field", Icon: ShieldCheck },
  draft: { className: NEUTRAL_CHIP, iconClassName: "text-wheat-deep", Icon: FilePenLine },
  done: { className: NEUTRAL_CHIP, iconClassName: "text-field", Icon: CheckCheck },
};

export function Pill({ kind, children, size = "sm" }: { kind: PillKind; children: ReactNode; size?: "sm" | "lg" }) {
  const { className, iconClassName, Icon } = PILL[kind];
  // lg (a token's status) steps down one size on phones, where it shares a row with the token number.
  const sizing = size === "lg" ? "text-sm px-2.5 py-1 gap-1.5 sm:text-base sm:px-3 sm:py-1.5 sm:gap-2" : "text-xs px-2 py-0.5 gap-1";
  return (
    <span className={`badge-pop inline-flex items-center rounded-full border font-medium whitespace-nowrap ${sizing} ${className}`}>
      <Icon aria-hidden className={`${size === "lg" ? "size-4" : "size-3.5"} ${iconClassName}`} strokeWidth={2} />
      {children}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-muted" role="status">
      <Loader2 aria-hidden className="size-4 animate-spin" strokeWidth={1.75} />
      {label}
    </span>
  );
}

/**
 * Every empty, error and not-found state on the platform: an icon in a soft circle, a plain-language
 * title, an optional line and an optional action. Never a status code, a command or an internal name.
 */
export function StateMessage({ title, body, action, tone = "neutral", icon }: { title: string; body?: string; action?: ReactNode; tone?: "neutral" | "error"; icon?: LucideIcon }) {
  const Icon = icon ?? (tone === "error" ? CloudOff : Inbox);
  return (
    <div className={`rounded-card border px-6 py-8 text-center ${tone === "error" ? "border-ember/30 bg-ember-soft/30" : "border-line bg-surface"}`}>
      <span aria-hidden className={`mx-auto mb-4 grid size-14 place-items-center rounded-full ${tone === "error" ? "bg-ember-soft text-ember-deep" : "bg-paper text-ink-muted ring-1 ring-inset ring-line"}`}>
        <Icon className="size-6" strokeWidth={1.5} />
      </span>
      <p className="font-display text-xl">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-card bg-line/60 ${className}`} />;
}
