"use client";

/**
 * A new instance for each sign-in page, so moving between /signin and /signin/<role> fades the
 * card's content in with a short rise while the photo beside it stays still. Reduced motion: the
 * rise is dropped (MotionConfig in Providers), only the fade remains.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

export default function SignInTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="flex h-full w-full flex-col"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
