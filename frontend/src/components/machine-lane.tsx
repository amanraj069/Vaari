"use client";

/**
 * MachineLane: one machine's day as ordered stops on a 08:00 -> end-of-day track. Block width is
 * proportional to time on the field, the gaps are travel. Each stop has a stable layoutId, so in a
 * re-plan the same field glides from its old lane to its new one instead of blinking.
 */
import { Lock, Tractor, Wrench } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { Lane } from "@/shared";
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
  onMarkDown: () => void;
  onMarkBack: () => void;
  busy: boolean;
};

export function MachineLane({ lane, index, dayStart, onMarkDown, onMarkBack, busy }: Props) {
  const t = useTranslations("operator");
  const dates = useDates();
  const startMinute = minutesOf(dayStart);
  const span = Math.max(60, minutesOf(lane.capacityEndTime) - startMinute);
  const percent = (minutes: number) => `${(minutes / span) * 100}%`;
  const colour = LANE_COLOURS[index % LANE_COLOURS.length];
  const tint = LANE_TINTS[index % LANE_TINTS.length];

  return (
    <motion.li layout className="grid gap-3 rounded-[8px] border border-line bg-surface p-3 md:grid-cols-[14rem_1fr] md:items-center">
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
        {lane.down ? (
          <button type="button" disabled={busy} onClick={onMarkBack} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-[8px] border border-field/40 px-2.5 text-sm text-field hover:bg-field-soft disabled:opacity-50">
            <Tractor aria-hidden className="size-4" strokeWidth={1.75} />
            {t("markBack")}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={onMarkDown} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-[8px] border border-line-strong px-2.5 text-sm text-ink-muted hover:border-ink/50 hover:text-ink disabled:opacity-50">
            <Wrench aria-hidden className="size-4" strokeWidth={1.75} />
            {t("markDown")}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[36rem]">
          {lane.down ? (
            <div className="hatched flex h-16 items-center justify-center gap-2 rounded-[6px] border border-dashed border-line-strong text-ink-muted">
              <Wrench aria-hidden className="size-4" strokeWidth={1.75} />
              {t("inWorkshop")}
            </div>
          ) : lane.stops.length === 0 ? (
            <div className="flex h-16 items-center justify-center rounded-[6px] border border-dashed border-line text-sm text-ink-muted">{t("noStops")}</div>
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
                    <span
                      title={`#${stop.token} ${stop.farmerName} · ${stop.villageName} · ${stop.acres} ac · ${stop.start}–${stop.end}`}
                      className={`relative flex min-w-0 flex-1 flex-col justify-center overflow-hidden rounded-[6px] border px-2 text-xs leading-tight ${
                        stop.stretch ? "border-dashed border-ink-muted/60 bg-paper" : `border-ink/10 ${tint}`
                      }`}
                    >
                      <span className="flex items-center gap-1 font-semibold tabular">
                        {firm ? <Lock aria-label={t("firmLock")} className="size-3 shrink-0" strokeWidth={2} /> : null}#{String(stop.token).padStart(3, "0")}
                        {stop.parts > 1 ? <span className="font-normal text-ink-muted">{stop.part}/{stop.parts}</span> : null}
                      </span>
                      <span className="truncate">{stop.villageName}</span>
                      <span className="truncate text-ink-muted tabular">
                        {stop.stretch ? t("ifTime") : `${stop.start}–${stop.end}`}
                      </span>
                    </span>
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
