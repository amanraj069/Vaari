"use client";

/**
 * /operator, today's board. What the machines follow: the PUBLISHED plan, one lane per machine,
 * with fields past the farmer's last waiting day in ember. Anything waiting for the operator (a
 * draft after a breakdown, requests with no date yet) is a calm banner that leads to /operator/plan,
 * where plans are checked and approved. Marking a machine as in the workshop makes a draft at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BellRing, Inbox, RotateCcw, Scale, ShieldCheck, Tractor } from "lucide-react";
import { LayoutGroup } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { operatorBoardSchema, operatorPlanSchema, type Lane, type OperatorBoard } from "@/shared";
import { FuseBar } from "@/components/fuse-bar";
import { AttentionList } from "@/components/attention-list";
import { MachineDownDialog } from "@/components/machine-down-dialog";
import { MachineLane } from "@/components/machine-lane";
import { SimulatedBadge } from "@/components/simulated-badge";
import { PAGE_TITLE, PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { ButtonLink, Button, Card, Pill, Skeleton, StateMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";

function OneLineAnswer({ board }: { board: OperatorBoard }) {
  const t = useTranslations("operator");
  const parts = board.lanes.map((lane: Lane) => {
    if (lane.down) return t("oneLineDown", { machine: lane.machine.name });
    const villages: string[] = [];
    for (const stop of lane.stops.filter((item) => !item.stretch)) {
      if (villages.at(-1) !== stop.villageName) villages.push(stop.villageName);
    }
    if (villages.length === 0) return t("oneLineIdle", { machine: lane.machine.name });
    return t("oneLineMachine", { machine: lane.machine.name, villages: villages.join(` ${t("oneLineThen")} `) });
  });
  return (
    <p className="font-display text-xl leading-snug sm:text-2xl">
      <span className="text-wheat-deep">{t("oneLineTomorrow")}</span> {parts.join(" ")}{" "}
      {t("oneLinePromises", { open: board.counts.promisesOpen, onTrack: board.counts.promisesOnTrack })}{" "}
      <span className={board.counts.burnRisk > 0 ? "text-ember-deep" : ""}>{t("oneLineRisk", { count: board.counts.burnRisk })}</span>
    </p>
  );
}

function Kpi({ icon, label, value, hint, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "neutral" | "risk" | "good" }) {
  const toneClass = tone === "risk" ? "text-ember-deep" : tone === "good" ? "text-field" : "text-ink";
  return (
    <div className="flex h-full flex-col justify-between gap-3 rounded-card border border-line bg-surface p-5" title={hint}>
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        {icon}
        {label}
      </p>
      <p className={`font-display text-3xl leading-none tabular ${toneClass}`}>{value}</p>
    </div>
  );
}

/** A draft or new requests waiting for the operator: one sentence and one way forward. */
function WaitingBanner({ board }: { board: OperatorBoard }) {
  const t = useTranslations("operator");
  const { draft, newRequests } = board;
  if (draft) {
    return (
      <section aria-live="polite" className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-card border border-wheat-deep/30 bg-wheat-soft/60 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <Pill kind="draft">{t("draft")}</Pill>
            {t(`draftTitle_${draft.cause}`, { machine: draft.causeMachineName ?? "" })}
          </h2>
          <p className="mt-1 text-sm">
            {t("draftChanges", { count: draft.changeCount })}{" "}
            <span className={draft.brokenCount > 0 ? "font-medium text-ember-deep" : ""}>{t("draftBroken", { count: draft.brokenCount })}</span>
            {newRequests > 0 ? ` ${t("newRequests", { count: newRequests })}` : ""}
          </p>
        </div>
        <ButtonLink href="/operator/plan" variant="accent" className="min-h-12">
          {t("reviewDraft")}
          <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
        </ButtonLink>
      </section>
    );
  }
  if (newRequests > 0) {
    return (
      <section aria-live="polite" className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-card border border-sky/30 bg-sky-soft/60 p-5">
        <p className="flex items-center gap-2">
          <Inbox aria-hidden className="size-5 shrink-0 text-sky" strokeWidth={1.75} />
          <span>
            <span className="font-medium">{t("newRequests", { count: newRequests })}</span> {t("newRequestsAction")}
          </span>
        </p>
        <ButtonLink href="/operator/plan" variant="accent" className="min-h-12">
          {t("planTomorrow")}
          <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
        </ButtonLink>
      </section>
    );
  }
  return null;
}

export default function OperatorPage() {
  const t = useTranslations("operator");
  const tc = useTranslations("common");
  const tr = useTranslations("risk");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [downMachine, setDownMachine] = useState<Lane["machine"] | null>(null);

  const board = useQuery({
    queryKey: ["operator-board"],
    queryFn: () => api("operator/board", operatorBoardSchema),
    refetchInterval: 5_000,
  });
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
  const reset = useMutation({
    mutationFn: () => api("operator/demo/reset", operatorBoardSchema, { method: "POST", body: "{}" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["operator-board"], next);
      queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
    },
  });
  const busy = markDown.isPending || markBack.isPending || reset.isPending;

  return (
    <>
      <TopBar />
      <PageMain>
        {board.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-20" />
            <Skeleton className="h-72" />
          </div>
        ) : board.isError ? (
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => board.refetch()}>{tc("retry")}</Button>} />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-ink-muted">{board.data.chc.name}</p>
                  <SimulatedBadge demoDate={dates.short(board.data.today)} />
                </div>
                <h1 className={`mt-2 ${PAGE_TITLE}`}>
                  {board.data.planDate ? t("boardTitle", { date: dates.full(board.data.planDate) }) : t("boardTitleNone")}
                </h1>
                {board.data.published?.approvedBy ? (
                  <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
                    <Pill kind="approved">{t("approved")}</Pill>
                    {t("publishedBy", { name: board.data.published.approvedBy })}
                  </p>
                ) : null}
              </div>
              <ButtonLink href="/operator/plan" variant={board.data.draft || board.data.newRequests > 0 ? "secondary" : "accent"} className="min-h-12">
                {t("planTomorrow")}
                <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
              </ButtonLink>
            </div>

            <WaitingBanner board={board.data} />
            <AttentionList items={board.data.attention} />

            {!board.data.published ? (
              <div className="mt-6">
                <StateMessage
                  title={t("noPublishedTitle")}
                  body={t("noPublishedBody")}
                  action={<ButtonLink href="/operator/plan" variant="accent">{t("planTomorrow")}</ButtonLink>}
                />
              </div>
            ) : (
              <>
                <Card className="mt-6 p-6">
                  <OneLineAnswer board={board.data} />
                </Card>

                <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                  <Kpi
                    icon={<ShieldCheck aria-hidden className="size-3.5" strokeWidth={1.75} />}
                    label={t("kpiPromises")}
                    value={`${board.data.counts.promisesOnTrack}/${board.data.counts.promisesOpen}`}
                    tone="good"
                  />
                  <Kpi
                    icon={<AlertTriangle aria-hidden className="size-3.5" strokeWidth={1.75} />}
                    label={t("kpiRisk")}
                    value={String(board.data.counts.burnRisk)}
                    hint={t("kpiRiskHint")}
                    tone={board.data.counts.burnRisk > 0 ? "risk" : "neutral"}
                  />
                  <Kpi icon={<Inbox aria-hidden className="size-3.5" strokeWidth={1.75} />} label={t("kpiRequested")} value={String(board.data.counts.requested)} />
                  <Kpi
                    icon={<Tractor aria-hidden className="size-3.5" strokeWidth={1.75} />}
                    label={t("kpiMachines")}
                    value={`${board.data.counts.machinesWorking}/${board.data.counts.machinesTotal}`}
                  />
                  <Kpi icon={<BellRing aria-hidden className="size-3.5" strokeWidth={1.75} />} label={t("kpiBroken")} value={String(board.data.counts.brokenThisSeason)} />
                  <Kpi
                    icon={<Scale aria-hidden className="size-3.5" strokeWidth={1.75} />}
                    label={t("kpiFairness")}
                    value={tc("days", { count: Math.max(0, board.data.solver?.maxDelayVsQueueDays ?? 0) })}
                    hint={t("kpiFairnessHint")}
                  />
                </div>
              </>
            )}

            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
              <section aria-labelledby="lanes-title">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="lanes-title" className="font-display text-2xl">{t("lanesTitle")}</h2>
                  <p className="text-xs text-ink-muted">{t("lanesHint")}</p>
                </div>
                <LayoutGroup>
                  <ul className="mt-4 space-y-4">
                    {board.data.lanes.map((lane, index) => (
                      <MachineLane
                        key={lane.machine.id}
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
                {board.data.solver ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    {t("solverNote", { status: board.data.solver.status, mode: board.data.solver.mode.replace("_", "-"), seconds: board.data.solver.wallSeconds })}
                  </p>
                ) : null}
              </section>

              <aside aria-labelledby="risk-title">
                <div className="flex items-baseline justify-between">
                  <h2 id="risk-title" className="font-display text-2xl">{t("atRiskTitle")}</h2>
                  <Link href="/operator/queue" className="inline-flex min-h-11 min-w-11 shrink-0 items-center whitespace-nowrap text-sm text-sky underline underline-offset-2">{t("fullQueue")}</Link>
                </div>
                {board.data.atRisk.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">{t("atRiskEmpty")}</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {board.data.atRisk.slice(0, 8).map((item) => (
                      <li key={item.fieldId} className={`rounded-card border bg-surface p-4 ${item.risk === "at_risk" ? "border-ember/50" : "border-line"}`}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span>
                            <span className="font-medium tabular">#{String(item.token).padStart(3, "0")}</span> {item.farmerName}
                            <span className="text-ink-muted"> · {item.villageName}</span>
                          </span>
                          <Pill kind={item.risk}>{tr(item.risk)}</Pill>
                        </div>
                        <div className="mt-2">
                          <FuseBar readyDate={item.readyDate} deadlineDate={item.burnDeadlineDate} plannedDate={item.plannedDate} today={board.data.today} showLabels={false} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="quiet" className="mt-6 text-sm text-ink-muted" disabled={busy} onClick={() => reset.mutate()}>
                  <RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />
                  {t("resetDemo")}
                </Button>
              </aside>
            </div>
          </>
        )}
      </PageMain>

      <MachineDownDialog machine={downMachine} onClose={() => setDownMachine(null)} onConfirm={(input) => markDown.mutate(input)} />

      {busy ? (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-paper">
          {t("replanning")}
        </div>
      ) : null}
    </>
  );
}
