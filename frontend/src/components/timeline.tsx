/**
 * The four steps of a turn: Booked, Planned, On the way, Done. Done steps carry a check, the
 * current step a ring and bold label (plus aria-current), later steps stay muted. State is shown
 * with shape and weight, not colour alone.
 */
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

export const TIMELINE_STEPS = ["booked", "planned", "onTheWay", "done"] as const;
export type TimelineStep = (typeof TIMELINE_STEPS)[number];

export function Timeline({ current }: { current: TimelineStep }) {
  const t = useTranslations("timeline");
  const currentIndex = TIMELINE_STEPS.indexOf(current);
  return (
    <ol aria-label={t("label")} className="grid grid-cols-4">
      {TIMELINE_STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li key={step} aria-current={isCurrent ? "step" : undefined} className="relative flex flex-col items-center gap-1.5 text-center">
            {/* Connector to the previous step, drawn behind the dots. */}
            {index > 0 ? (
              <span aria-hidden className={`absolute right-1/2 top-[9px] h-0.5 w-full ${index <= currentIndex ? "bg-field" : "bg-line"}`} />
            ) : null}
            <span
              aria-hidden
              className={`relative z-10 grid size-5 place-items-center rounded-full border-2 ${
                isDone ? "border-field bg-field text-surface" : isCurrent ? "border-field bg-surface ring-4 ring-field/20" : "border-line-strong bg-surface"
              }`}
            >
              {isDone ? <Check className="size-3" strokeWidth={3} /> : isCurrent ? <span className="size-2 rounded-full bg-field" /> : null}
            </span>
            <span className={`px-0.5 text-xs leading-tight ${isCurrent ? "font-semibold text-ink" : isDone ? "text-ink" : "text-ink-muted"}`}>
              {t(step)}
              {isCurrent ? <span className="sr-only"> ({t("current")})</span> : isDone ? <span className="sr-only"> ({t("completed")})</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
