"use client";

/**
 * Motion for the landing page, all of it decoration over server-rendered content: sections rise
 * into place as they scroll into view, the hero photo drifts slower than the page, the problem
 * photo is uncovered like a print, figures count up and the example token's "Firm" stamp lands.
 * The text is in the HTML before any of this runs, and reduced-motion visitors get still pages
 * (MotionConfig in providers.tsx, plus the checks here for scroll-linked movement).
 */
import { animate, motion, useInView, useReducedMotion, useScroll, useTransform, type Variants } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

// A long, soft settle: quick to start, slow to land. Matches --ease-out in globals.css.
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.76, 0, 0.24, 1];
const VIEWPORT = { once: true, amount: 0.25 } as const;

/**
 * Whether scroll-linked movement may run. False on the server and on the first client render, so
 * both render the same HTML (reading the reduced-motion setting during render broke hydration for
 * visitors who have it on); after mounting it follows the visitor's setting.
 */
function useMotionAllowed(): boolean {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !prefersReducedMotion;
}

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: (delay: number = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE_OUT, delay } }),
};

/** One block that rises and fades in the first time it scrolls into view. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} variants={rise} custom={delay} initial="hidden" whileInView="show" viewport={VIEWPORT}>
      {children}
    </motion.div>
  );
}

const STAGGER_TAGS = { div: motion.div, ul: motion.ul, ol: motion.ol, dl: motion.dl };
const ITEM_TAGS = { div: motion.div, li: motion.li, article: motion.article };

/** A group whose StaggerItem children rise one after another. */
export function Stagger({ children, className, as = "div", gap = 0.09, delay = 0 }: { children: ReactNode; className?: string; as?: keyof typeof STAGGER_TAGS; gap?: number; delay?: number }) {
  const Component = STAGGER_TAGS[as] as typeof motion.div;
  const variants: Variants = { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } };
  return (
    <Component className={className} variants={variants} initial="hidden" whileInView="show" viewport={VIEWPORT}>
      {children}
    </Component>
  );
}

export function StaggerItem({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: keyof typeof ITEM_TAGS }) {
  const Component = ITEM_TAGS[as] as typeof motion.div;
  return (
    <Component className={className} variants={rise}>
      {children}
    </Component>
  );
}

/** A rule that draws itself (from the left, or from the top), in step with the StaggerItem it sits in. */
export function DrawLine({ className, axis = "x" }: { className?: string; axis?: "x" | "y" }) {
  const variants: Variants =
    axis === "x"
      ? { hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 1.1, ease: EASE_IN_OUT } } }
      : { hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { duration: 1.1, ease: EASE_IN_OUT, delay: 0.2 } } };
  return <motion.span aria-hidden className={`block ${axis === "x" ? "origin-left" : "origin-top"} ${className ?? ""}`} variants={variants} />;
}

/** The hero photo layer: moves at about a fifth of the scroll speed, so the page slides over it. */
export function HeroParallax({ children, className }: { children: ReactNode; className?: string }) {
  const motionAllowed = useMotionAllowed();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1000], [0, 220]);
  return (
    <motion.div aria-hidden className={className} style={motionAllowed ? { y } : undefined}>
      {children}
    </motion.div>
  );
}

/** The hero text eases up and out as the next section arrives. */
export function HeroScrollFade({ children, className }: { children: ReactNode; className?: string }) {
  const motionAllowed = useMotionAllowed();
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [120, 680], [1, 0]);
  const y = useTransform(scrollY, [0, 680], [0, -56]);
  return (
    <motion.div className={className} style={motionAllowed ? { opacity, y } : undefined}>
      {children}
    </motion.div>
  );
}

/**
 * A photo uncovered from the bottom edge up, then settling from a slight zoom while it drifts
 * against the scroll. The inner layer is taller than the frame so the drift never shows an edge.
 * The frame itself is never clipped: IntersectionObserver treats a fully clipped element as out
 * of view, so a clipped element watching itself would never be revealed.
 */
export function RevealImage({ children, className }: { children: ReactNode; className?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const inView = useInView(frame, VIEWPORT);
  const motionAllowed = useMotionAllowed();
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-5%", "5%"]);
  return (
    <div ref={frame} className={className}>
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-[inherit]"
        initial={{ clipPath: "inset(100% 0% 0% 0%)" }}
        animate={inView ? { clipPath: "inset(0% 0% 0% 0%)" } : undefined}
        transition={{ duration: motionAllowed ? 1.3 : 0, ease: EASE_IN_OUT }}
      >
        <motion.div
          className="absolute inset-x-0 -top-[7%] -bottom-[7%]"
          style={motionAllowed ? { y } : undefined}
          initial={{ scale: 1.2 }}
          animate={inView ? { scale: 1 } : undefined}
          transition={{ duration: motionAllowed ? 1.8 : 0, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}

/**
 * A figure that counts up from zero when it scrolls into view. The server renders the final value
 * (no mismatch, and correct without JavaScript); screen readers only ever hear the final value.
 */
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const inView = useInView(element, { once: true, amount: 0.6 });
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(value);
  const armed = useRef(false);
  const format = (number: number) => `${number.toLocaleString("en-IN")}${suffix}`;

  useEffect(() => {
    if (reduceMotion || armed.current) return;
    armed.current = true;
    setShown(0);
  }, [reduceMotion]);

  useEffect(() => {
    if (!inView || !armed.current) return;
    const controls = animate(0, value, { duration: 1.8, ease: EASE_OUT, onUpdate: (latest) => setShown(Math.round(latest)) });
    return () => controls.stop();
  }, [inView, value]);

  return (
    <span ref={element}>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}

/**
 * Marks its subtree with data-reveal="out" until it scrolls into view, then "in", so plain CSS can
 * animate many small pieces (the fire chart's bars) without a motion component each. Before
 * hydration, and for reduced motion, the attribute is absent and everything shows as is.
 */
export function InViewState({ children, className }: { children: ReactNode; className?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const inView = useInView(element, { once: true, amount: 0.35 });
  const reduceMotion = useReducedMotion();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!reduceMotion) setArmed(true);
  }, [reduceMotion]);
  return (
    <div ref={element} className={className} data-reveal={armed ? (inView ? "in" : "out") : undefined}>
      {children}
    </div>
  );
}

/** The example token arrives tilted and settles flat, then floats gently. */
export function TokenArrive({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 56, rotate: -4 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 1.2, ease: EASE_OUT }}
    >
      <div className="token-float">{children}</div>
    </motion.div>
  );
}

/** A rubber stamp: lands big and tilted, then presses flat. For the token's "Firm" label. */
export function Stamp({ children, delay = 0.7 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.span
      className="inline-block"
      initial={{ opacity: 0, scale: 1.8, rotate: -14 }}
      whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ delay, type: "spring", stiffness: 420, damping: 22 }}
    >
      {children}
    </motion.span>
  );
}
