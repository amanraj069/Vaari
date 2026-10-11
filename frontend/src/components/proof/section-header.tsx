"use client";

/**
 * SectionHeader: every section of /proof opens the same way, centred over the full width so the
 * report reads balanced rather than hugging the left edge (on phones it starts at the left edge
 * instead: a centred paragraph on a narrow screen is hard to read, every line starting somewhere new): a serif title, one line of context, and
 * an optional key or label underneath (a legend, the season measured). Rise: the page's one entrance
 * movement, small and quiet (12px, once, when a block first scrolls into view); reduced motion is
 * honoured by the app's MotionConfig.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

export function Rise({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeader({ id, title, body, aside }: { id: string; title: ReactNode; body?: ReactNode; aside?: ReactNode }) {
  return (
    <Rise className="mx-auto flex max-w-3xl flex-col items-start text-left sm:items-center sm:text-center">
      <h2 id={id} className="font-display text-[1.625rem] leading-tight tracking-tight sm:text-3xl">
        {title}
      </h2>
      {body ? <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:mt-3 sm:text-base sm:leading-normal">{body}</p> : null}
      {aside ? <div className="mt-4 max-w-full sm:mt-5">{aside}</div> : null}
    </Rise>
  );
}
