"use client";

/**
 * FuseBar: a line from harvest-ready to the farmer's last waiting day, with a pin at the planned
 * day. The part after the pin is the slack: the fuse that is left. It shortens as slack shrinks,
 * and turns ember (with a label) when the pin lands past the end.
 */
import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { daysBetween, useDates } from "@/lib/dates";

type Props = {
  readyDate: string;
  deadlineDate: string;
  plannedDate: string | null;
  today: string;
  showLabels?: boolean;
};

export function FuseBar({ readyDate, deadlineDate, plannedDate, today, showLabels = true }: Props) {
  const dates = useDates();
  const t = useTranslations("farmer");
  // Span covers ready -> deadline, widened to include the planned day if it falls outside.
  const startIso = plannedDate && plannedDate < readyDate ? plannedDate : readyDate;
  const endIso = plannedDate && plannedDate > deadlineDate ? plannedDate : deadlineDate;
  const spanDays = Math.max(1, daysBetween(startIso, endIso));
  const at = (iso: string) => `${Math.min(100, Math.max(0, (daysBetween(startIso, iso) / spanDays) * 100))}%`;
  const slackDays = plannedDate ? daysBetween(plannedDate, deadlineDate) : null;
  const late = slackDays !== null && slackDays < 0;
  const slackColour = slackDays === null || late ? "bg-ember" : slackDays <= 1 ? "bg-wheat" : "bg-field";

  return (
    <figure className="w-full" aria-label={t("fuseLabel")}>
      <div className="relative h-8">
        {/* Whole fuse, ready -> last waiting day */}
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" style={{ left: at(readyDate), right: `calc(100% - ${at(deadlineDate)})` }} />
        {/* Days already passed are spent */}
        {today > startIso ? (
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink-muted/30"
            style={{ left: at(startIso), width: `calc(${at(today < endIso ? today : endIso)} - ${at(startIso)})` }}
          />
        ) : null}
        {/* Slack: planned day -> last waiting day */}
        {plannedDate && !late ? (
          <div
            className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-all duration-300 ${slackColour}`}
            style={{ left: at(plannedDate), width: `calc(${at(deadlineDate)} - ${at(plannedDate)})` }}
          />
        ) : null}
        {/* End cap: the last waiting day */}
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ember bg-surface" style={{ left: at(deadlineDate) }} />
        {plannedDate ? (
          <MapPin
            aria-hidden
            className={`absolute top-0 size-5 -translate-x-1/2 -translate-y-1 transition-all duration-300 ${late ? "text-ember" : "text-ink"}`}
            fill="currentColor"
            stroke="var(--color-surface)"
            strokeWidth={1.5}
            style={{ left: at(plannedDate) }}
          />
        ) : null}
      </div>
      {showLabels ? (
        <figcaption className="mt-1 flex justify-between text-xs text-ink-muted">
          <span>
            {t("readyOn")} · <span className="tabular">{dates.short(readyDate)}</span>
          </span>
          <span className="text-right">
            {/* The last waiting day is red only when the plan misses it (or there is no plan): a column of
                red dates on healthy rows would cry wolf. */}
            {t("waitUntil")} · <span className={`tabular ${slackDays === null || late ? "font-medium text-ember-deep" : "text-ink"}`}>{dates.short(deadlineDate)}</span>
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
