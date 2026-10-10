"use client";

/**
 * Every page fades in when the person navigates to it, so moving around the app feels continuous
 * rather than a hard cut. Opacity only: a transform here would move the fixed top bar.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

export default function RootTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}
