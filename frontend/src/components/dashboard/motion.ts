/**
 * The dashboard's motion vocabulary, so every animation feels like one product: a long, soft
 * ease-out for things arriving, and one spring for things that move to a new place (the selected
 * day, the current page). Reduced motion is honoured globally (MotionConfig in providers.tsx).
 */
import type { Transition, Variants } from "motion/react";

/** Quick to start, long soft landing. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** A selection sliding to its new place: firm, no bounce. */
export const SLIDE: Transition = { type: "spring", stiffness: 520, damping: 44, mass: 0.9 };

/** Content arriving: a short rise and fade. */
export const RISE: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE_OUT } },
};

/** A group whose children arrive one after another. */
export const STAGGER: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
