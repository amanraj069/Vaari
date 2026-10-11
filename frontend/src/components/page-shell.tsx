/**
 * The frame every page shares, so the platform reads as one product: the same width and gutters as
 * the top bar, the same space above and below, and content that starts at the logo's left edge.
 * One-task pages (the farmer's phone flows, booking) use PageColumns on wide screens: the task on
 * the left, the context that helps with it on the right, so a laptop screen is never half empty.
 * On phones the aside simply follows the main column. `measure="center"` is for the few pages
 * that are one short form (welcome).
 */
import type { ReactNode } from "react";

/** Width and gutters for the top bar, every page's main column and every landing section. */
export const PAGE_FRAME = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";

const MEASURE = {
  center: "mx-auto max-w-xl", // one short form, centred
  full: "",
} as const;

export function PageMain({ children, measure = "full", className = "" }: { children: ReactNode; measure?: keyof typeof MEASURE; className?: string }) {
  return (
    <main className={`${PAGE_FRAME} pb-20 pt-8 sm:pt-10 ${className}`}>
      {measure === "full" ? children : <div className={MEASURE[measure]}>{children}</div>}
    </main>
  );
}

/** The one page-title pattern: context line and simulated badge above, serif title (with an optional back chevron to its left), optional lead and actions. */
export const PAGE_TITLE = "font-display text-[1.625rem] leading-tight tracking-tight sm:text-4xl";

export function PageHeader({
  title,
  context,
  badge,
  description,
  shortDescription,
  actions,
  back,
  className = "",
}: {
  title: ReactNode;
  context?: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  /** The lead on phones: one short line under the title; `description` from sm up. */
  shortDescription?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {context || badge ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {context ? <p className="text-sm text-ink-muted">{context}</p> : null}
            {badge}
          </div>
        ) : null}
        {back ? (
          <div className="flex items-center gap-1">
            {back}
            <h1 className={`min-w-0 ${PAGE_TITLE}`}>{title}</h1>
          </div>
        ) : (
          <h1 className={PAGE_TITLE}>{title}</h1>
        )}
        {/* Phones: a small lead, so it stays two or three lines under the title; wider screens inherit the page's size. */}
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted sm:mt-2 sm:text-[1em] sm:leading-normal">
            {shortDescription ? (
              <>
                <span className="sm:hidden">{shortDescription}</span>
                <span className="hidden sm:inline">{description}</span>
              </>
            ) : (
              description
            )}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

/** The main task and its context side by side on wide screens; stacked on phones. */
export function PageColumns({ main, aside, className = "" }: { main: ReactNode; aside: ReactNode; className?: string }) {
  return (
    <div className={`grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-12 ${className}`}>
      <div className="min-w-0">{main}</div>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-6">{aside}</aside>
    </div>
  );
}

/** A quiet card for an aside: icon + title, then whatever explains or helps. */
export function AsideCard({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[0.9375rem] font-medium sm:text-base">
        <span aria-hidden className="text-wheat-deep">{icon}</span>
        {title}
      </h2>
      <div className="mt-3 text-sm sm:text-base text-ink-muted">{children}</div>
    </section>
  );
}
