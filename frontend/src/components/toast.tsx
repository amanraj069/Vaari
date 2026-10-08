"use client";

/**
 * Toast: a short, calm confirmation ("Link copied") read out by screen readers through a polite
 * live region. One at a time; disappears after a few seconds; motion follows the reduced-motion
 * setting (MotionConfig in Providers).
 */
import { CheckCircle2, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; tone: "success" | "info" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});
const VISIBLE_MILLISECONDS = 4_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, tone: Toast["tone"] = "success") => {
    setToast({ id: Date.now(), message, tone });
  }, []);
  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), VISIBLE_MILLISECONDS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        <AnimatePresence>
          {toast ? (
            <motion.p
              key={toast.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="inline-flex max-w-md items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm text-paper"
            >
              {toast.tone === "success" ? <CheckCircle2 aria-hidden className="size-4 shrink-0" strokeWidth={2} /> : <Info aria-hidden className="size-4 shrink-0" strokeWidth={2} />}
              {toast.message}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
