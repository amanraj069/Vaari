"use client";

/**
 * The operator's day on Today. DayClose is the evening card, shown only while today's fields wait
 * to be recorded: tick what each came to (sown, or not: a missed field goes into tomorrow's plan,
 * and a sown one keeps its promise and teaches the machine's speed). StartDay is the page's main
 * button once that is done: "Start tomorrow" moves the season on a day (for every centre: it asks
 * first), and stays disabled with its reason while tomorrow's plan waits for approval. The API
 * decides what may happen (day.blockedBy); these only show it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, MoonStar, SunMedium } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { operatorBoardSchema, type DayView } from "@/shared";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";

/** Today's fields to tick as sown or not; nothing at all once they are recorded or there are none. */
export function DayClose({ day }: { day: DayView }) {
  const t = useTranslations("day");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [notSown, setNotSown] = useState<Set<string>>(new Set());
  useEffect(() => setNotSown(new Set()), [day.date]);

  const record = useMutation({
    mutationFn: () =>
      api("operator/day/record", operatorBoardSchema, { method: "POST", body: JSON.stringify({ outcomes: day.stops.map((stop) => ({ fieldId: stop.fieldId, sown: !notSown.has(stop.fieldId) })) }) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["operator-board"], next);
      queryClient.invalidateQueries();
    },
  });
  if (day.stops.length === 0 || day.closed) return null;

  return (
    <section aria-labelledby="day-title" className="rounded-card border border-line bg-surface">
      <div className="flex min-w-0 items-start gap-3 px-4 py-4 sm:px-5">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-control bg-paper text-ink-muted ring-1 ring-inset ring-line">
          <MoonStar className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 id="day-title" className="font-semibold">
            {t("title", { date: `${dates.weekday(day.date)}, ${dates.dayMonth(day.date)}` })}
          </h2>
          <p className="text-sm text-ink-muted">{t("recordBody", { count: day.stops.length })}</p>
        </div>
      </div>

      <div className="border-t border-line">
        <ul className="divide-y divide-line">
          {day.stops.map((stop) => {
            const sown = !notSown.has(stop.fieldId);
            return (
              <li key={stop.fieldId}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 sm:px-5">
                  <input
                    type="checkbox"
                    checked={sown}
                    onChange={() =>
                      setNotSown((current) => {
                        const next = new Set(current);
                        if (next.has(stop.fieldId)) next.delete(stop.fieldId);
                        else next.add(stop.fieldId);
                        return next;
                      })
                    }
                    className="size-5 shrink-0 accent-field"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      <span className="font-mono text-sm tabular">#{String(stop.token).padStart(3, "0")}</span> {stop.farmerName} · {stop.villageName}
                    </span>
                    <span className="block text-xs text-ink-muted">{t("stopLine", { acres: stop.acres, machine: stop.machineName, hours: stop.hours })}</span>
                  </span>
                  <span className={`shrink-0 text-sm font-medium ${sown ? "text-field" : "text-ember-deep"}`}>{sown ? t("sown") : t("notSown")}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          <p className="text-xs text-ink-muted">{t("recordHint")}</p>
          <Button disabled={record.isPending} onClick={() => record.mutate()}>
            <CalendarCheck2 aria-hidden className="size-4" strokeWidth={1.75} />
            {t("save")}
          </Button>
        </div>
      </div>

      {record.error ? (
        <p role="alert" className="border-t border-line px-4 py-3 text-sm text-ember-deep sm:px-5">
          {record.error instanceof ApiError && record.error.status === 409 ? t("blocked") : t("failed")}
        </p>
      ) : null}
    </section>
  );
}

/**
 * "Start {tomorrow}", for the page header. Hidden while today's fields wait to be recorded (the
 * card above asks for that) and for operators who cannot move the season; disabled, with the
 * reason under it, while tomorrow's plan waits for approval.
 */
export function StartDay({ day }: { day: DayView }) {
  const t = useTranslations("day");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const start = useMutation({
    mutationFn: () => api("operator/day/next", operatorBoardSchema, { method: "POST", body: "{}" }),
    onSuccess: (next) => {
      setConfirming(false);
      queryClient.setQueryData(["operator-board"], next);
      queryClient.invalidateQueries();
    },
  });
  if (!day.canStart || day.blockedBy === "record") return null;
  const nextLabel = `${dates.weekday(day.nextDate)}, ${dates.dayMonth(day.nextDate)}`;
  const note = start.error ? (start.error instanceof ApiError && start.error.status === 409 ? t("blocked") : t("failed")) : day.blockedBy === "approve" ? t("approveFirst") : null;

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button disabled={day.blockedBy !== null || start.isPending} aria-describedby={note ? "start-day-note" : undefined} onClick={() => setConfirming(true)}>
        <SunMedium aria-hidden className="size-4" strokeWidth={1.75} />
        {t("start", { date: nextLabel })}
      </Button>
      {note ? (
        <p id="start-day-note" role={start.error ? "alert" : undefined} className={`text-xs ${start.error ? "text-ember-deep" : "text-ink-muted"}`}>
          {note}
        </p>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("startTitle", { date: nextLabel })}
        description={t("startBody")}
        closeLabel={t("close")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? t("starting") : t("startConfirm")}
            </Button>
          </>
        }
      />
    </div>
  );
}
