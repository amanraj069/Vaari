"use client";

/**
 * /dashboard/plan: the next ten days' plan before it is published. The one decision on this page
 * is "approve", so while a draft waits it sits at the top as one bar: what approving does, in one
 * line (a promise that breaks first, in ember), the Approve button beside it, and every affected
 * farmer one click away. Below, a calendar picks any day of the plan and each machine's stops that
 * day show beside it; tapping a stop moves that field (the engine re-plans the rest). Version
 * numbers, the solver's statistics and a list of the operator's own moves are left out: they do
 * not change the decision.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Inbox, RefreshCw, Sparkles } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { operatorPlanSchema, type Lane, type LaneStop, type OperatorPlan } from "@/shared";
import { AttentionList } from "@/components/attention-list";
import { DashHeader, NextStep, Panel, DayTransition } from "@/components/dashboard/kit";
import { EASE_OUT } from "@/components/dashboard/motion";
import { MachineDownDialog } from "@/components/machine-down-dialog";
import { MachineLane } from "@/components/machine-lane";
import { MoveFieldDialog } from "@/components/move-field-dialog";
import { DayList } from "@/components/operator/plan-calendar";
import { PlanChangesList, PlanChangesSummary } from "@/components/plan-changes";
import { Button, Pill, Skeleton, Spinner, StateMessage } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";

export function OperatorPlanView() {
  const t = useTranslations("plan");
  const to = useTranslations("operator");
  const ts = useTranslations("schedule");
  const tc = useTranslations("common");
  const tr = useTranslations("risk");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState<{ stop: LaneStop; machineId: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downMachine, setDownMachine] = useState<Lane["machine"] | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [showEveryFarmer, setShowEveryFarmer] = useState(false);

  const plan = useQuery({
    queryKey: ["operator-plan", pickedDate],
    queryFn: () => api(pickedDate ? `operator/plan?date=${pickedDate}` : "operator/plan", operatorPlanSchema),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
  const show = (next: OperatorPlan) => {
    if (!pickedDate || pickedDate === next.selectedDate) queryClient.setQueryData(["operator-plan", pickedDate], next);
    queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
    queryClient.invalidateQueries({ queryKey: ["operator-board"] });
  };
  const post = (path: string, body: unknown = {}) => api(path, operatorPlanSchema, { method: "POST", body: JSON.stringify(body) });

  const generate = useMutation({ mutationFn: () => post("operator/plan/generate"), onSuccess: show });
  const approve = useMutation({
    mutationFn: (version: number) => post("operator/plan/approve", { version }),
    onSuccess: (next) => {
      setNotice(null);
      show(next);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setNotice(to("staleVersion"));
      queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
    },
  });
  const move = useMutation({
    mutationFn: (input: { fieldId: string; machineId: string; date: string }) => post("operator/plan/move", input),
    onSuccess: (next) => {
      setMoving(null);
      setMoveError(null);
      show(next);
    },
    onError: (error) => setMoveError(error instanceof ApiError && error.status === 422 ? t("moveImpossible") : t("moveFailed")),
  });
  const markDown = useMutation({ mutationFn: (input: { machineId: string; days: number }) => post(`operator/machines/${input.machineId}/down`, { days: input.days }), onSuccess: show });
  const markBack = useMutation({ mutationFn: (machineId: string) => post(`operator/machines/${machineId}/up`), onSuccess: show });
  const busy = generate.isPending || approve.isPending || move.isPending || markDown.isPending || markBack.isPending;

  if (plan.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-16" />
        <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
          <Skeleton className="h-80" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (plan.isError) {
    return <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => plan.refetch()}>{tc("retry")}</Button>} />;
  }

  const view = plan.data;
  const current = view.plan;
  const isDraft = current?.status === "draft";
  const hasChangedFarmers = Boolean(view.changes && Object.values(view.changes).some((rows) => rows.length > 0));
  const selectedDay = view.days.find((day) => day.date === view.selectedDate) ?? null;
  const stopLabel = (stop: LaneStop) =>
    `#${String(stop.token).padStart(3, "0")} ${stop.farmerName}, ${stop.villageName}, ${stop.start}–${stop.end}${stop.risk === "at_risk" || stop.risk === "tight" ? `, ${tr(stop.risk)}` : ""}. ${t("moveSubmit")}`;

  const approveButton = isDraft ? (
    <Button variant="accent" className="min-h-11 shrink-0 px-4 text-sm" disabled={busy} onClick={() => approve.mutate(current.version)}>
      <CheckCircle2 aria-hidden className="size-4" strokeWidth={2} />
      {approve.isPending ? t("approving") : t("approve")}
    </Button>
  ) : null;

  return (
    <>
      <DashHeader
        context={view.chc.name}
        title={ts("planHeading")}
        meta={
          // Once approved, a visible confirmation under the title; a draft is marked on the lanes'
          // panel, beside the day it shows.
          current?.status === "approved" ? (
            <>
              <Pill kind="approved">{to("approved")}</Pill>
              <span>{t("publishedNote", { name: current.approvedBy ?? "" })}</span>
            </>
          ) : current?.status === "publishing" ? (
            <Pill kind="draft">{t("approving")}</Pill>
          ) : undefined
        }
        actions={
          // With new requests waiting, their card offers the fresh plan instead of the header.
          current && view.newRequests === 0 ? (
            <Button variant="secondary" className="min-h-11 px-4 text-sm" disabled={busy} onClick={() => generate.mutate()}>
              <RefreshCw aria-hidden className="size-4" strokeWidth={2} />
              {generate.isPending ? t("generating") : t("regenerate")}
            </Button>
          ) : undefined
        }
      />

      <div className="mt-4 space-y-4">
        {notice ? (
          <p role="alert" className="rounded-control border border-wheat-deep/30 bg-wheat-soft px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}
        {view.newRequests > 0 ? (
          <NextStep
            icon={Inbox}
            tone="warn"
            title={current ? t("newRequestsNote", { count: view.newRequests }) : to("newRequests", { count: view.newRequests })}
            action={
              <Button variant="accent" disabled={busy} onClick={() => generate.mutate()}>
                <Sparkles aria-hidden className="size-4" strokeWidth={1.75} />
                {generate.isPending ? t("generating") : current ? t("regenerate") : t("generate")}
              </Button>
            }
          />
        ) : null}
        <AttentionList items={view.attention} />
      </div>

      {!current ? (
        <div className="mt-6">
          <StateMessage
            title={t("emptyTitle")}
            body={t("emptyBody")}
            action={
              <Button variant="accent" className="min-h-12" disabled={busy} onClick={() => generate.mutate()}>
                {generate.isPending ? <Spinner label={t("generating")} /> : t("generate")}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {isDraft && view.changes ? (
            // The decision, once: what approving does (consequences first), and the button beside it.
            <section
              aria-labelledby="plan-changes"
              className={`mt-6 rounded-card border px-4 pb-3 pt-4 sm:px-5 sm:pb-4 sm:pt-5 ${view.changes.broken.length + view.changes.unplaced.length > 0 ? "border-ember/40 bg-ember-soft/30" : "border-wheat-deep/35 bg-wheat-soft/40"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 id="plan-changes" className="text-base font-semibold">
                    {t("changesTitle")}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{t("draftNote")}</p>
                </div>
                {approveButton}
              </div>
              {/* The consequences in one line; on the right, the farmer-by-farmer list when someone is in it. */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <PlanChangesSummary changes={view.changes} />
                {hasChangedFarmers ? (
                  <button
                    type="button"
                    aria-expanded={showEveryFarmer}
                    aria-controls="plan-every-farmer"
                    onClick={() => setShowEveryFarmer((shown) => !shown)}
                    className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
                  >
                    {t("seeEveryFarmer")}
                    <motion.span aria-hidden animate={{ rotate: showEveryFarmer ? 180 : 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="grid place-items-center">
                      <ChevronDown className="size-4" strokeWidth={1.75} />
                    </motion.span>
                  </button>
                ) : null}
              </div>
              {/* Opens by growing to its height, the rows easing in a beat later; closes the same way back. */}
              <AnimatePresence initial={false}>
                {showEveryFarmer && hasChangedFarmers ? (
                  <motion.div
                    id="plan-every-farmer"
                    key="every-farmer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1, transition: { height: { duration: 0.42, ease: EASE_OUT }, opacity: { duration: 0.3, delay: 0.08 } } }}
                    exit={{ height: 0, opacity: 0, transition: { height: { duration: 0.32, ease: EASE_OUT }, opacity: { duration: 0.16 } } }}
                    className="overflow-hidden"
                  >
                    <motion.div initial={{ y: -6 }} animate={{ y: 0 }} exit={{ y: -6 }} transition={{ duration: 0.42, ease: EASE_OUT }} className="mt-2 border-t border-line pb-1 pt-3">
                      <PlanChangesList changes={view.changes} brokenProven={view.solver?.breaksProvenMinimal ?? null} />
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </section>
          ) : null}
        <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-6">
            <Panel id="calendar-title" title={ts("calendarTitle")} bodyClassName="p-3">
              <DayList days={view.days} selected={view.selectedDate} onSelect={setPickedDate} />
            </Panel>
          </div>

          <Panel
            id="plan-lanes"
            title={selectedDay ? ts("machinesOn", { date: dates.full(selectedDay.date) }) : to("lanesTitle")}
            subtitle={t("lanesHint")}
            bodyClassName=""
            action={
              // The day's size, and under it whether these lanes are still a draft (not yet what farmers see).
              selectedDay || isDraft ? (
                <div className="flex flex-col items-end gap-1.5">
                  {selectedDay ? <p className="text-sm text-ink-muted tabular">{ts("dayFieldsAcres", { fields: selectedDay.fields, acres: selectedDay.acres })}</p> : null}
                  {isDraft ? <Pill kind="draft">{to("draft")}</Pill> : null}
                </div>
              ) : null
            }
          >
            <DayTransition dayKey={view.selectedDate}>
              <LayoutGroup>
                <ul aria-busy={plan.isFetching}>
                  {view.lanes.map((lane, index) => (
                    <MachineLane
                      key={lane.machine.id}
                      variant="row"
                      lane={lane}
                      index={index}
                      dayStart="08:00"
                      busy={busy}
                      onMarkDown={() => setDownMachine(lane.machine)}
                      onMarkBack={() => markBack.mutate(lane.machine.id)}
                      onSelectStop={(stop) => {
                        setMoveError(null);
                        setMoving({ stop, machineId: lane.machine.id });
                      }}
                      selectLabel={stopLabel}
                    />
                  ))}
                </ul>
              </LayoutGroup>
            </DayTransition>
          </Panel>
        </div>
        </>
      )}

      {current ? (
        <MoveFieldDialog
          key={moving ? `${moving.stop.fieldId}#${moving.stop.part}` : "closed"}
          stop={moving?.stop ?? null}
          currentMachineId={moving?.machineId ?? null}
          planDate={view.selectedDate}
          options={view.moveOptions}
          pending={move.isPending}
          error={moveError}
          onClose={() => setMoving(null)}
          onMove={(input) => moving && move.mutate({ fieldId: moving.stop.fieldId, ...input })}
        />
      ) : null}
      <MachineDownDialog machine={downMachine} onClose={() => setDownMachine(null)} onConfirm={(input) => markDown.mutate(input)} />

      {busy ? (
        <div role="status" className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-paper lg:bottom-6">
          {generate.isPending ? t("generating") : approve.isPending ? t("approving") : to("replanning")}
        </div>
      ) : null}
    </>
  );
}
