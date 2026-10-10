"use client";

/**
 * Moving between dashboard pages: the page's blocks (heading, panels, the numbers) rise in one
 * after another (each uses the RISE variant and inherits this orchestration); the sidebar and the
 * bottom bar stay put. Blocks that mount later (after their data arrives) rise on their own.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { STAGGER } from "@/components/dashboard/motion";

export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={STAGGER} initial="hidden" animate="shown">
      {children}
    </motion.div>
  );
}
