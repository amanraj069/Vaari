"use client";

/**
 * Helper / Operator / Officer on the role's sign-in page: one radiogroup (arrow keys move and
 * choose, one tab stop, aria-checked) drawn as one track whose chosen tile slides under the choice.
 * Labels are short so they fit in Punjabi and Hindi too. Reduced motion: no slide.
 */
import { Landmark, Tractor, Users } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId, useRef, type KeyboardEvent } from "react";

export type StaffRole = "helper" | "operator" | "officer";

export const STAFF_ROLES = [
  { pick: "helper" as const, Icon: Users, short: "roleHelperShort" as const, full: "roleHelper" as const },
  { pick: "operator" as const, Icon: Tractor, short: "roleOperatorShort" as const, full: "roleOperator" as const },
  { pick: "officer" as const, Icon: Landmark, short: "roleOfficerShort" as const, full: "roleOfficer" as const },
];

export const isStaffRole = (value: unknown): value is StaffRole => value === "helper" || value === "operator" || value === "officer";

export function StaffRoleToggle({
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: StaffRole | null;
  onChange: (role: StaffRole) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  const slideId = useId();
  const t = useTranslations("signin");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // With nothing chosen yet, the first option takes the tab stop.
  const focusIndex = Math.max(0, STAFF_ROLES.findIndex((role) => role.pick === value));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + STAFF_ROLES.length) % STAFF_ROLES.length;
    onChange(STAFF_ROLES[next]!.pick);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid grid-cols-3 gap-1 rounded-card border border-line bg-paper p-1.5"
    >
      {STAFF_ROLES.map(({ pick, Icon, short, full }, index) => {
        const checked = value === pick;
        return (
          <button
            key={pick}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(full)}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(pick)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="relative flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-control px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:text-base"
          >
            {checked ? (
              <motion.span layoutId={`role-slide-${slideId}`} aria-hidden className="absolute inset-0 rounded-control border border-line-strong bg-surface" transition={{ type: "spring", stiffness: 520, damping: 42 }} />
            ) : null}
            <Icon aria-hidden className={`relative size-4 shrink-0 transition-colors duration-200 ${checked ? "text-wheat-deep" : "text-ink-muted"}`} strokeWidth={1.75} />
            <span className={`relative truncate transition-colors duration-200 ${checked ? "text-ink" : "text-ink-muted hover:text-ink"}`}>{t(short)}</span>
          </button>
        );
      })}
    </div>
  );
}
