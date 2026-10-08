/**
 * LockPin: marks a firm promise. Icon plus words (never colour alone); compact form keeps the
 * words for screen readers.
 */
import { Lock } from "lucide-react";

export function LockPin({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-field">
      <Lock aria-hidden className={compact ? "size-3" : "size-4"} strokeWidth={2} />
      <span className={compact ? "sr-only" : "text-sm font-medium"}>{label}</span>
    </span>
  );
}
