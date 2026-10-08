"use client";

/**
 * /operator/plan: tomorrow's plan before it is published. The one decision on this page: approve.
 * Make a plan (the engine places every request and keeps every promise as a hard rule), move a
 * field if you know better (the engine re-plans the rest around it), read exactly what approving
 * changes for which farmer, then approve. Approving publishes: farmers see their dates at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Hand, Inbox, RefreshCw, Sparkles } from "lucide-react";
import { LayoutGroup } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { operatorPlanSchema, type Lane, type LaneStop, type OperatorPlan } from "@/shared";
import { MachineDownDialog } from "@/components/machine-down-dialog";
import { MachineLane } from "@/components/machine-lane";
import { MoveFieldDialog } from "@/components/move-field-dialog";
import { PlanChangesList } from "@/components/plan-changes";
import { SimulatedBadge } from "@/components/simulated-badge";
import { PAGE_TITLE, PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { Button, ButtonLink, Card, Pill, Skeleton, Spinner, StateMessage } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";

export default function OperatorPlanPage() {
  const t = useTranslations("plan");
  const to = useTranslations("operator");
  const tc = useTranslations("common");
  const tr = useTranslations("risk");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState<{ stop: LaneStop; machineId: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downMachine, setDownMachine] = useState<Lane["machine"] | null>(null);

  const plan = useQuery({ queryKey: ["operator-plan"], queryFn: () => api("operator/plan", operatorPlanSchema), refetchInterval: 10_000 });
  const show = (next: OperatorPlan) => {
    queryClient.setQueryData(["operator-plan"], next);
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
      <>
        <TopBar />
        <PageMain>
          <div className="space-y-4">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-72" />
          </div>
        </PageMain>
      </>
    );
  }
  if (plan.isError) {
    return (
      <>
        <TopBar />
        <PageMain>
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => plan.refetch()}>{tc("retry")}</Button>} />
        </PageMain>
      </>
    );
  }

  const view = plan.data;
  const current = view.plan;
  const isDraft = current?.status === "draft";
  const stopLabel = (stop: LaneStop) =>
    `#${String(stop.token).padStart(3, "0")} ${stop.farmerName}, ${stop.villageName}, ${stop.start}–${stop.end}${stop.risk === "at_risk" || stop.risk === "tight" ? `, ${tr(stop.risk)}` : ""}. ${t("moveSubmit")}`;

  return (
    <>
      <TopBar />
      <PageMain>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-ink-muted">{view.chc.name}</p>
              <SimulatedBadge demoDate={dates.short(view.today)} />
            </div>
            <h1 className={`mt-2 ${PAGE_TITLE}`}>{current ? t("title", { date: dates.full(current.planDate) }) : t("titleNone")}</h1>
            {current ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                {current.status === "approved" ? (
                  <Pill kind="approved">{to("approved")}</Pill>
                ) : (
                  <Pill kind="draft">{current.status === "publishing" ? t("approving") : to("draft")}</Pill>
                )}
                {t("version", { version: current.version })}
                {current.status === "draft" ? ` · ${t("draftNote")}` : current.status === "approved" ? ` · ${t("publishedNote", { name: current.approvedBy ?? "" })}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/operator" variant="quiet" className="min-h-12">
              <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
              {t("backToToday")}
            </ButtonLink>
            {current ? (
              <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => generate.mutate()}>
                <RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />
                {generate.isPending ? t("generating") : t("regenerate")}
              </Button>
            ) : null}
            {isDraft ? (
              <Button variant="accent" className="min-h-12 px-5 text-base" disabled={busy} onClick={() => approve.mutate(current.version)}>
                <CheckCircle2 aria-hidden className="size-5" strokeWidth={1.75} />
                {approve.isPending ? t("approving") : t("approve")}
              </Button>
            ) : null}
          </div>
        </div>

        {notice ? (
          <p role="alert" className="mt-4 rounded-control border border-wheat-deep/30 bg-wheat-soft px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}
        {view.newRequests > 0 ? (
          <section aria-live="polite" className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-card border border-sky/30 bg-sky-soft/60 p-5">
            <p className="flex items-center gap-2">
              <Inbox aria-hidden className="size-5 shrink-0 text-sky" strokeWidth={1.75} />
              {current ? t("newRequestsNote", { count: view.newRequests }) : to("newRequests", { count: view.newRequests })}
            </p>
            <Button variant="accent" className="min-h-12" disabled={busy} onClick={() => generate.mutate()}>
              <Sparkles aria-hidden className="size-4" strokeWidth={1.75} />
              {generate.isPending ? t("generating") : current ? t("regenerate") : t("generate")}
            </Button>
          </section>
        ) : null}

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
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
            <section aria-labelledby="plan-lanes">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="plan-lanes" className="font-display text-2xl">{to("lanesTitle")}</h2>
                <p className="text-xs text-ink-muted">{t("lanesHint")}</p>
              </div>
              <LayoutGroup>
                <ul className="mt-4 space-y-4">
                  {view.lanes.map((lane, index) => (
                    <MachineLane
                      key={lane.machine.id}
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
              {view.solver ? (
                <p className="mt-3 text-xs text-ink-muted">
                  {to("solverNote", { status: view.solver.status, mode: view.solver.mode.replace("_", "-"), seconds: view.solver.wallSeconds })}
                </p>
              ) : null}
            </section>

            <aside aria-labelledby="plan-changes" className="space-y-5">
              <Card className="p-5">
                <h2 id="plan-changes" className="font-display text-2xl">{isDraft ? t("changesTitle") : t("changesTitlePublished")}</h2>
                <div className="mt-4">{view.changes ? <PlanChangesList changes={view.changes} brokenProven={view.solver?.breaksProvenMinimal ?? null} /> : null}</div>
              </Card>
              {view.pins.length > 0 ? (
                <Card className="p-5">
                  <h2 className="flex items-center gap-2 font-medium">
                    <Hand aria-hidden className="size-4" strokeWidth={1.75} />
                    {t("movesTitle")}
                  </h2>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {view.pins.map((pin) => (
                      <li key={pin.fieldId} className="flex flex-wrap gap-x-2">
                        <span className="font-medium tabular">#{String(pin.token).padStart(3, "0")}</span>
                        <span>{pin.farmerName}</span>
                        <span className="ml-auto text-ink-muted">{t("movedTo", { machine: pin.machineName, date: dates.short(pin.date) })}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </aside>
          </div>
        )}
      </PageMain>

      {current ? (
        <MoveFieldDialog
          key={moving ? `${moving.stop.fieldId}#${moving.stop.part}` : "closed"}
          stop={moving?.stop ?? null}
          currentMachineId={moving?.machineId ?? null}
          planDate={current.planDate}
          options={view.moveOptions}
          pending={move.isPending}
          error={moveError}
          onClose={() => setMoving(null)}
          onMove={(input) => moving && move.mutate({ fieldId: moving.stop.fieldId, ...input })}
        />
      ) : null}
      <MachineDownDialog machine={downMachine} onClose={() => setDownMachine(null)} onConfirm={(input) => markDown.mutate(input)} />

      {busy ? (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-paper">
          {generate.isPending ? t("generating") : approve.isPending ? t("approving") : to("replanning")}
        </div>
      ) : null}
    </>
  );
}
