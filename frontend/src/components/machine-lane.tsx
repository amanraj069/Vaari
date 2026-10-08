"use client";

/**
 * MachineLane: one machine's day as ordered stops on a 08:00 -> end-of-day track. Block width is
 * proportional to time on the field, the gaps are travel. Each stop has a stable layoutId, so in a
 * re-plan the same field glides from its old lane to its new one instead of blinking.
 * A stop after the farmer's last waiting day is ember with a warning icon (tight ones are wheat with
 * a clock), and says so to screen readers: risk is never colour alone. With `onSelectStop` each
 * stop is a button (the plan page uses it to move a field).
 */
import { AlertTriangle, Clock3, Tractor, Wrench } from "lucide-react";
import { LockPin } from "./lock-pin";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { Lane, LaneStop } from "@/shared";
import { useDates } from "@/lib/dates";

// Literal class names so Tailwind can see them (no string-built classes).
const LANE_COLOURS = ["bg-lane-1", "bg-lane-2", "bg-lane-3", "bg-lane-4", "bg-lane-5"];
const LANE_TINTS = ["bg-lane-1/15", "bg-lane-2/15", "bg-lane-3/15", "bg-lane-4/15", "bg-lane-5/15"];

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

type Props = {
  lane: Lane;
  index: number;
  dayStart: string;
  busy: boolean;
  /** Workshop controls; leave out to show the lane read-only. */
  onMarkDown?: () => void;
  onMarkBack?: () => void;
  /** Makes each stop a button (for example, to move it). */
  onSelectStop?: (stop: LaneStop) => void;
  selectLabel?: (stop: LaneStop) => string;
};

const RISK_BLOCK: Record<LaneStop["risk"], string> = {
  at_risk: "border-2 border-ember bg-ember-soft",
  tight: "border-wheat-deep/60",
  safe: "border-ink/10",
  unplanned: "border-ink/10",
};

export function MachineLane({ lane, index, dayStart, busy, onMarkDown, onMarkBack, onSelectStop, selectLabel }: Props) {
  const t = useTranslations("operator");
  const dates = useDates();
  const startMinute = minutesOf(dayStart);
  const span = Math.max(60, minutesOf(lane.capacityEndTime) - startMinute);
  const percent = (minutes: number) => `${(minutes / span) * 100}%`;
  const colour = LANE_COLOURS[index % LANE_COLOURS.length];
  const tint = LANE_TINTS[index % LANE_TINTS.length];

  return (
    <motion.li layout className="grid gap-4 rounded-card border border-line bg-surface p-4 md:grid-cols-[14rem_1fr] md:p-5 md:items-center">
      <div className="flex items-start justify-between gap-2 md:block">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <span aria-hidden className={`size-2.5 rounded-full ${colour}`} />
            {lane.machine.name}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted tabular" title={t("rateHint")}>
            {t("rate", { promise: lane.machine.promiseAcresPerDay, plan: lane.machine.planAcresPerDay })}
          </p>
        </div>
        {lane.down && onMarkBack ? (
          <button type="button" disabled={busy} onClick={onMarkBack} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-control border border-field/40 px-2.5 text-sm text-field hover:bg-field-soft disabled:opacity-50">
            <Tractor aria-hidden className="size-4" strokeWidth={1.75} />
            {t("markBack")}
          </button>
        ) : !lane.down && onMarkDown ? (
          <button type="button" disabled={busy} onClick={onMarkDown} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong px-2.5 text-sm text-ink-muted hover:border-ink/50 hover:text-ink disabled:opacity-50">
            <Wrench aria-hidden className="size-4" strokeWidth={1.75} />
            {t("markDown")}
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-chip" tabIndex={0} role="region" aria-label={t("laneTimeline", { machine: lane.machine.name })}>
        <div className="min-w-[32rem]">
          {lane.down ? (
            <div className="hatched flex h-16 items-center justify-center gap-2 rounded-chip border border-dashed border-line-strong text-ink-muted">
              <Wrench aria-hidden className="size-4" strokeWidth={1.75} />
              {t("inWorkshop")}
            </div>
          ) : lane.stops.length === 0 ? (
            <div className="flex h-16 items-center justify-center rounded-chip border border-dashed border-line text-sm text-ink-muted">{t("noStops")}</div>
          ) : (
            <ol className="relative flex h-16 items-stretch">
              {lane.stops.map((stop) => {
                const workMinutes = minutesOf(stop.end) - minutesOf(stop.start);
                const firm = stop.promise?.kind === "firm";
                return (
                  <motion.li
                    key={`${stop.fieldId}#${stop.part}`}
                    layoutId={`${stop.fieldId}#${stop.part}`}
                    layout
                    className="flex shrink-0 items-stretch"
                    style={{ width: percent(workMinutes + stop.travelMinutesBefore) }}
                  >
                    {stop.travelMinutesBefore > 0 ? (
                      <span aria-hidden className="flex items-center" style={{ width: `${(stop.travelMinutesBefore / (workMinutes + stop.travelMinutesBefore)) * 100}%` }}>
                        <span className="h-px w-full border-t border-dashed border-ink-muted/60" />
                      </span>
                    ) : null}
                    <StopBlock
                      as={onSelectStop && !stop.stretch ? "button" : "span"}
                      onClick={onSelectStop && !stop.stretch ? () => onSelectStop(stop) : undefined}
                      disabled={busy}
                      ariaLabel={onSelectStop && !stop.stretch ? selectLabel?.(stop) : undefined}
                      title={`#${stop.token} ${stop.farmerName} · ${stop.villageName} · ${stop.acres} ac · ${stop.start}–${stop.end}`}
                      className={`relative flex min-w-0 flex-1 flex-col justify-center overflow-hidden rounded-chip border px-2 text-left text-xs leading-tight ${
                        stop.stretch ? "border-dashed border-ink-muted/60 bg-paper" : `${RISK_BLOCK[stop.risk]} ${stop.risk === "at_risk" ? "" : tint}`
                      } ${onSelectStop && !stop.stretch ? "cursor-pointer hover:ring-2 hover:ring-ink/30 focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-wait" : ""}`}
                    >
                      <span className="flex items-center gap-1 font-semibold tabular">
                        {stop.risk === "at_risk" && !stop.stretch ? (
                          <AlertTriangle aria-label={t("stopAtRisk")} role="img" className="size-3.5 shrink-0 text-ember-deep" strokeWidth={2} />
                        ) : stop.risk === "tight" && !stop.stretch ? (
                          <Clock3 aria-label={t("stopTight")} role="img" className="size-3.5 shrink-0 text-wheat-deep" strokeWidth={2} />
                        ) : null}
                        {firm ? <LockPin compact label={t("firmLock")} /> : null}#{String(stop.token).padStart(3, "0")}
                        {stop.parts > 1 ? <span className="font-normal text-ink-muted">{stop.part}/{stop.parts}</span> : null}
                      </span>
                      <span className="truncate">{stop.villageName}</span>
                      <span className="truncate text-ink-muted tabular">
                        {stop.stretch ? t("ifTime") : `${stop.start}–${stop.end}`}
                      </span>
                    </StopBlock>
                  </motion.li>
                );
              })}
            </ol>
          )}
          <div className="mt-1 flex justify-between text-[11px] text-ink-muted tabular">
            <span>{dayStart}</span>
            {lane.endTime && !lane.down ? <span>{lane.travelKm.toFixed(1)} km</span> : <span />}
            <span>{lane.capacityEndTime}</span>
          </div>
          {lane.machine.downDates.length > 0 && !lane.down ? (
            <p className="mt-1 text-xs text-ink-muted">
              {t("inWorkshop")}: {lane.machine.downDates.map((iso) => dates.short(iso)).join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

/** A stop is a plain block on the board and a button where it can be acted on. */
function StopBlock({
  as,
  onClick,
  disabled,
  ariaLabel,
  title,
  className,
  children,
}: {
  as: "button" | "span";
  onClick?: () => void;
  disabled: boolean;
  ariaLabel?: string;
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  if (as === "button") {
    return (
      <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} title={title} className={className}>
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={className}>
      {children}
    </span>
  );
}
