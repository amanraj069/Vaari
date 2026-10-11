"use client";

/**
 * /dashboard for an operator: "Today", the machine centre's control room. Answer first: what
 * tomorrow looks like in one sentence (the page's lead, under its title), with "Start tomorrow" as
 * the header's main button, then the one thing waiting for the operator (today's work to record, a
 * re-plan to approve, new requests to plan) as a card with its button; no card when nothing waits. Four numbers with a small
 * picture each (promises on track, fields at burn risk by risk, machines working, fairness), the
 * schedule for any day of the approved plan (a strip of the ten days, then each machine's stops
 * that day), the ten-day workload per machine, and the fields to watch. Marking a machine as in
 * the workshop makes a re-plan at once; it waits on the Plan page for approval.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardCheck, CloudRain, CloudSun, Inbox, RotateCcw } from "lucide-react";
import { LayoutGroup } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { operatorBoardSchema, operatorPlanSchema, type Lane, type OperatorBoard } from "@/shared";
import { AttentionList } from "@/components/attention-list";
import { DashHeader, DayLoading, Meter, MetricStrip, NextStep, Panel, SplitBar, DayTransition } from "@/components/dashboard/kit";
import { FuseBar } from "@/components/fuse-bar";
import { MachineDownDialog } from "@/components/machine-down-dialog";
import { DayClose, StartDay } from "@/components/operator/day-close";
import { MachineLane } from "@/components/machine-lane";
import { DayStrip } from "@/components/operator/plan-calendar";
import { WorkloadGrid } from "@/components/operator/workload-grid";
import { Button, ButtonLink, Pill, Skeleton, StateMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";

export const RISK_COLOUR = {
  at_risk: "var(--color-season-burned)",
  tight: "var(--color-season-late)",
  safe: "var(--color-season-ontime)",
  unplanned: "var(--color-line-strong)",
} as const;

/** The one thing waiting for the operator; nothing at all when nothing waits (the header has the next step). */
function WhatNow({ board }: { board: OperatorBoard }) {
  const t = useTranslations("operator");
  const { draft, newRequests } = board;
  if (draft) {
    return (
      <NextStep
        icon={ClipboardCheck}
        tone="warn"
        title={t(`draftTitle_${draft.cause}`, { machine: draft.causeMachineName ?? "" })}
        body={
          <>
            {t("draftChanges", { count: draft.changeCount })} <span className={draft.brokenCount > 0 ? "font-medium text-ember-deep" : ""}>{t("draftBroken", { count: draft.brokenCount })}</span>
          </>
        }
        action={
          <ButtonLink href="/dashboard/plan" variant="accent">
            {t("reviewDraft")}
            <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
          </ButtonLink>
        }
      />
    );
  }
  if (newRequests > 0 || !board.published) {
    return (
      <NextStep
        icon={Inbox}
        tone="warn"
        title={newRequests > 0 ? t("newRequests", { count: newRequests }) : t("noPublishedTitle")}
        body={newRequests > 0 ? t("newRequestsAction") : t("noPublishedBody")}
        action={
          <ButtonLink href="/dashboard/plan" variant="accent">
            {t("planTomorrow")}
            <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
          </ButtonLink>
        }
      />
    );
  }
  return null;
}

export function OperatorTodayView() {
  const t = useTranslations("operator");
  const ts = useTranslations("schedule");
  const tc = useTranslations("common");
  const tr = useTranslations("risk");
  const td = useTranslations("day");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [downMachine, setDownMachine] = useState<Lane["machine"] | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  // Tomorrow's board (the counts and the sentence) and, when another day is picked, that day's lanes.
  const board = useQuery({ queryKey: ["operator-board"], queryFn: () => api("operator/board", operatorBoardSchema), refetchInterval: 5_000 });
  const selectedDate = pickedDate ?? board.data?.selectedDate ?? null;
  const dayBoard = useQuery({
    queryKey: ["operator-board", selectedDate],
    queryFn: () => api(`operator/board?date=${selectedDate}`, operatorBoardSchema),
    enabled: Boolean(pickedDate && board.data && pickedDate !== board.data.selectedDate),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
  const otherDayPicked = Boolean(pickedDate && board.data && pickedDate !== board.data.selectedDate);
  const lanesFrom = otherDayPicked ? dayBoard.data ?? board.data : board.data;
  // Until the picked day's lanes arrive, the lanes say they are loading rather than show another day.
  const loadingDay = otherDayPicked && (dayBoard.isPending || (dayBoard.isPlaceholderData && dayBoard.data?.selectedDate !== pickedDate));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["operator-board"] });
    queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
  };
  const markDown = useMutation({
    mutationFn: (input: { machineId: string; days: number }) =>
      api(`operator/machines/${input.machineId}/down`, operatorPlanSchema, { method: "POST", body: JSON.stringify({ days: input.days }) }),
    onSuccess: refresh,
  });
  const markBack = useMutation({
    mutationFn: (machineId: string) => api(`operator/machines/${machineId}/up`, operatorPlanSchema, { method: "POST", body: "{}" }),
    onSuccess: refresh,
  });
  // Rain expected on the picked day (or cleared): the API makes a draft that sows nothing that day.
  const rain = useMutation({
    mutationFn: (input: { date: string; rain: boolean }) => api("operator/rain", operatorBoardSchema, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["operator-board"], next);
      queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
    },
  });
  const reset = useMutation({
    mutationFn: () => api("operator/demo/reset", operatorBoardSchema, { method: "POST", body: "{}" }),
    onSuccess: (next) => {
      setPickedDate(null);
      queryClient.setQueryData(["operator-board"], next);
      queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
    },
  });
  const busy = markDown.isPending || markBack.isPending || reset.isPending;

  if (board.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only" role="status">
          {tc("loading")}
        </span>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-20" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (board.isError) {
    return <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => board.refetch()}>{tc("retry")}</Button>} />;
  }

  const data = board.data;
  const { counts, riskCounts } = data;
  const tomorrow = data.days[0];
  const selectedDay = data.days.find((day) => day.date === selectedDate) ?? null;
  const lanes = lanesFrom?.lanes ?? data.lanes;
  // The same test WhatNow uses: a draft, new requests or no published plan each bring their own button.
  const nothingWaiting = !data.draft && data.newRequests === 0 && Boolean(data.published);

  return (
    <>
      <DashHeader
        context={data.chc.name}
        title={data.planDate ? ts("todayTitle", { date: dates.full(data.planDate) }) : t("boardTitleNone")}
        meta={
          data.published ? (
            <>
              <Pill kind="approved">{t("approved")}</Pill>
              {data.published.approvedBy ? <span>{t("publishedBy", { name: data.published.approvedBy })}</span> : null}
              {data.day.closed && data.day.stops.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden>·</span>
                  <CheckCircle2 aria-hidden className="size-4 text-field" strokeWidth={1.75} />
                  {td("recorded")}
                </span>
              ) : null}
            </>
          ) : null
        }
        actions={
          // The day's main step sits here: "Start tomorrow" (disabled with its reason while a plan
          // waits). When something waits for the operator, its card below carries that button, so
          // the quiet way to the plan shows only when nothing waits.
          <>
            {nothingWaiting ? (
              <ButtonLink href="/dashboard/plan" variant="secondary">
                {ts("openPlan")}
                <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
              </ButtonLink>
            ) : null}
            <StartDay day={data.day} />
          </>
        }
      />

      <div className="mt-6 space-y-4">
        <DayClose day={data.day} />
        <WhatNow board={data} />
        <AttentionList items={data.attention} />
      </div>

      <div className="mt-4">
        <MetricStrip
          label={ts("metricsLabel")}
          columns="max-md:grid-cols-1"
          metrics={[
            {
              label: t("kpiPromises"),
              value: `${counts.promisesOnTrack}/${counts.promisesOpen}`,
              tone: counts.promisesOnTrack === counts.promisesOpen ? "good" : "risk",
              sub: ts("promisesSub", { broken: counts.brokenThisSeason }),
              visual: <Meter value={counts.promisesOnTrack} max={Math.max(1, counts.promisesOpen)} tone={counts.promisesOnTrack === counts.promisesOpen ? "good" : "risk"} label={t("kpiPromises")} />,
            },
            {
              label: t("kpiRisk"),
              value: String(counts.burnRisk),
              tone: counts.burnRisk > 0 ? "risk" : "neutral",
              hint: t("kpiRiskHint"),
              sub: ts("riskSub", { tight: riskCounts.tight, safe: riskCounts.safe, noDate: riskCounts.unplanned }),
              visual: <SplitBar parts={(["at_risk", "tight", "safe", "unplanned"] as const).map((key) => ({ key, value: riskCounts[key], colour: RISK_COLOUR[key] }))} />,
            },
            {
              label: t("kpiMachines"),
              value: `${counts.machinesWorking}/${counts.machinesTotal}`,
              sub: tomorrow ? ts("machinesSub", { fields: tomorrow.fields, acres: tomorrow.acres }) : undefined,
              visual: (
                <div aria-hidden className="flex gap-1">
                  {Array.from({ length: counts.machinesTotal }, (_, index) => (
                    <span key={index} className={`h-1.5 flex-1 rounded-full ${index < counts.machinesWorking ? "bg-field" : "hatched bg-line"}`} />
                  ))}
                </div>
              ),
            },
          ]}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel
          id="schedule-title"
          title={ts("scheduleTitle")}
          subtitle={ts("scheduleSubtitle")}
          bodyClassName=""
          action={
            selectedDay ? (
              <p className="text-sm text-ink-muted tabular">
                {ts("dayHeadline", { date: dates.short(selectedDay.date), fields: selectedDay.fields, acres: selectedDay.acres })}
              </p>
            ) : null
          }
        >
          {data.days.length > 0 && selectedDate ? (
            <div className="border-b border-line p-4 sm:p-5">
              <DayStrip days={data.days} selected={selectedDate} onSelect={setPickedDate} />
              {selectedDay ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className={`flex items-center gap-1.5 text-sm ${selectedDay.rain ? "text-sky" : "text-ink-muted"}`}>
                    {selectedDay.rain ? <CloudRain aria-hidden className="size-4" strokeWidth={1.75} /> : null}
                    {selectedDay.rain ? ts("rainOn", { date: dates.short(selectedDay.date) }) : ts("rainHint")}
                  </p>
                  <Button variant="secondary" disabled={rain.isPending || busy} onClick={() => rain.mutate({ date: selectedDay.date, rain: !selectedDay.rain })} className="px-3 text-sm">
                    {selectedDay.rain ? <CloudSun aria-hidden className="size-4" strokeWidth={1.75} /> : <CloudRain aria-hidden className="size-4" strokeWidth={1.75} />}
                    {selectedDay.rain ? ts("rainClear") : ts("rainMark", { date: dates.short(selectedDay.date) })}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {data.published ? (
            <>
              {loadingDay && selectedDate ? (
                <DayLoading label={ts("loadingDay", { date: dates.full(selectedDate) })} rows={lanes.length} />
              ) : (
                <DayTransition dayKey={lanesFrom?.selectedDate ?? data.selectedDate}>
                  <LayoutGroup>
                    <ul aria-busy={dayBoard.isFetching}>
                      {lanes.map((lane, index) => (
                        <MachineLane
                          key={lane.machine.id}
                          variant="row"
                          lane={lane}
                          index={index}
                          dayStart="08:00"
                          busy={busy}
                          onMarkDown={() => setDownMachine(lane.machine)}
                          onMarkBack={() => markBack.mutate(lane.machine.id)}
                        />
                      ))}
                    </ul>
                  </LayoutGroup>
                </DayTransition>
              )}
              <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">{t("lanesHint")}</p>
            </>
          ) : (
            <div className="p-5">
              <StateMessage title={t("noPublishedTitle")} body={t("noPublishedBody")} action={<ButtonLink href="/dashboard/plan" variant="accent">{t("planTomorrow")}</ButtonLink>} />
            </div>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel
            id="risk-title"
            title={t("atRiskTitle")}
            bodyClassName=""
            action={
              <Link href="/dashboard/queue" className="inline-flex min-h-11 items-center text-sm font-medium text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                {t("fullQueue")}
              </Link>
            }
          >
            {data.atRisk.length === 0 ? (
              <p className="p-5 text-sm text-ink-muted">{t("atRiskEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.atRisk.slice(0, 6).map((item) => (
                  <li key={item.fieldId} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-xs text-ink-muted">#{String(item.token).padStart(3, "0")}</span> <span className="font-medium">{item.farmerName}</span>
                        <span className="text-ink-muted"> · {item.villageName}</span>
                      </span>
                      <Pill kind={item.risk}>{tr(item.risk)}</Pill>
                    </div>
                    <div className="mt-2">
                      <FuseBar readyDate={item.readyDate} deadlineDate={item.burnDeadlineDate} plannedDate={item.plannedDate} today={data.today} showLabels={false} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Button variant="quiet" className="text-sm text-ink-muted" disabled={busy} onClick={() => reset.mutate()}>
            <RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />
            {t("resetDemo")}
          </Button>
        </div>
      </div>

      {data.days.length > 0 && selectedDate ? (
        <Panel className="mt-6" id="workload-title" title={ts("workloadTitle")} subtitle={ts("workloadSubtitle")}>
          <WorkloadGrid days={data.days} selected={selectedDate} onSelect={setPickedDate} />
        </Panel>
      ) : null}

      <MachineDownDialog machine={downMachine} onClose={() => setDownMachine(null)} onConfirm={(input) => markDown.mutate(input)} />

      {busy ? (
        <div role="status" className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-paper lg:bottom-6">
          {t("replanning")}
        </div>
      ) : null}
    </>
  );
}
