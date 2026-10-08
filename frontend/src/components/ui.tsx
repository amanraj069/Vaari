/**
 * Small primitives with the Vaari look: flat, bordered, 8px corners, large tap targets.
 * Risk and promise state always show an icon and a word, never colour alone.
 */
import Link from "next/link";
import { AlertTriangle, CalendarCheck2, CalendarRange, CheckCheck, CircleDashed, Clock3, Loader2, ShieldCheck } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "accent" | "secondary" | "quiet";
const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90 border border-ink",
  accent: "bg-wheat text-on-wheat hover:bg-wheat/90 border border-wheat-deep/30",
  secondary: "bg-surface text-ink border border-line-strong hover:border-ink/50",
  quiet: "bg-transparent text-ink hover:bg-ink/5 border border-transparent",
};
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control px-5 min-h-11 font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed";

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-card border border-line bg-surface ${className}`}>{children}</div>;
}

export type PillKind = "firm" | "window" | "safe" | "tight" | "at_risk" | "unplanned" | "approved" | "proposed" | "done";

const PILL: Record<PillKind, { className: string; Icon: typeof ShieldCheck }> = {
  firm: { className: "bg-field-soft text-field border-field/30", Icon: CalendarCheck2 },
  window: { className: "bg-sky-soft text-sky border-sky/30", Icon: CalendarRange },
  safe: { className: "bg-field-soft text-field border-field/30", Icon: ShieldCheck },
  tight: { className: "bg-wheat-soft text-wheat-deep border-wheat-deep/30", Icon: Clock3 },
  at_risk: { className: "bg-ember-soft text-ember-deep border-ember/40", Icon: AlertTriangle },
  unplanned: { className: "bg-ember-soft text-ember-deep border-ember/40", Icon: CircleDashed },
  approved: { className: "bg-field-soft text-field border-field/30", Icon: ShieldCheck },
  proposed: { className: "bg-wheat-soft text-wheat-deep border-wheat-deep/30", Icon: Clock3 },
  done: { className: "bg-field-soft text-field border-field/30", Icon: CheckCheck },
};

export function Pill({ kind, children, size = "sm" }: { kind: PillKind; children: ReactNode; size?: "sm" | "lg" }) {
  const { className, Icon } = PILL[kind];
  const sizing = size === "lg" ? "text-base px-3 py-1.5 gap-2" : "text-xs px-2 py-0.5 gap-1";
  return (
    <span className={`inline-flex items-center rounded-full border font-medium whitespace-nowrap ${sizing} ${className}`}>
      <Icon aria-hidden className={size === "lg" ? "size-4" : "size-3.5"} strokeWidth={1.75} />
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

export function StateMessage({ title, body, action, tone = "neutral" }: { title: string; body?: string; action?: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div className={`rounded-card border p-6 text-center ${tone === "error" ? "border-ember/40 bg-ember-soft/40" : "border-line bg-surface"}`}>
      <p className="font-display text-xl">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-card bg-line/60 ${className}`} />;
}
