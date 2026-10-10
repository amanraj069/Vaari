"use client";

/**
 * Steps of one form stacked in a single grid cell (the parent is `grid`), so the box is always as
 * tall as its tallest step and never changes size, in any language. Only the active step is
 * visible and reachable (the others are transparent, inert and aria-hidden); switching cross-fades
 * with a short slide from `offset` pixels. Reduced motion: MotionConfig in Providers turns it off.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

export function StackPanel({ active, offset, children }: { active: boolean; offset: number; children: ReactNode }) {
  return (
    <motion.div
      aria-hidden={!active}
      inert={!active}
      initial={false}
      animate={active ? { opacity: 1, x: 0, filter: "blur(0px)" } : { opacity: 0, x: offset, filter: "blur(3px)" }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`col-start-1 row-start-1 flex min-w-0 flex-col ${active ? "" : "pointer-events-none"}`}
    >
      {children}
    </motion.div>
  );
}
