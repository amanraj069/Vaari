"use client";

/**
 * Operator hero page. The one decision: approve tomorrow's plan. Answer first (one line), then the
 * numbers that matter, then each machine's lane. Marking a machine as in the workshop re-plans on
 * the spot; cards glide to their new slots and the summary says exactly what moved and who was told.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellRing, CheckCircle2, RotateCcw, Scale, ShieldCheck, Tractor } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { z } from "zod";
import { operatorBoardSchema, type Lane, type OperatorBoard } from "@/shared";
import { FuseBar } from "@/components/fuse-bar";
import { MachineLane } from "@/components/machine-lane";
import { SimulatedBadge } from "@/components/simulated-badge";
import { TopBar } from "@/components/top-bar";
import { Button, Card, Pill, Skeleton, StateMessage } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
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

export default function OperatorPage() {
  const t = useTranslations("operator");
  const tc = useTranslations("common");
  const tr = useTranslations("risk");
  const dates = useDates();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [downMachine, setDownMachine] = useState<Lane["machine"] | null>(null);
  const [downDays, setDownDays] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["operator-board"],
    queryFn: () => api("operator/board", operatorBoardSchema),
    refetchInterval: 5_000,
  });
  const setBoard = (next: OperatorBoard) => queryClient.setQueryData(["operator-board"], next);

  const markDown = useMutation({
    mutationFn: (input: { machineId: string; days: number }) =>
      api(`operator/machines/${input.machineId}/down`, operatorBoardSchema, { method: "POST", body: JSON.stringify({ days: input.days }) }),
    onSuccess: setBoard,
  });
  const markBack = useMutation({
    mutationFn: (machineId: string) => api(`operator/machines/${machineId}/up`, operatorBoardSchema, { method: "POST", body: "{}" }),
    onSuccess: setBoard,
  });
  const approve = useMutation({
    mutationFn: (version: number) =>
      api("operator/plan/approve", z.object({ status: z.string() }), { method: "POST", body: JSON.stringify({ version }) }),
    onSuccess: () => {
      setNotice(null);
      queryClient.invalidateQueries({ queryKey: ["operator-board"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setNotice(t("staleVersion"));
      queryClient.invalidateQueries({ queryKey: ["operator-board"] });
    },
  });
  const reset = useMutation({
    mutationFn: () => api("operator/demo/reset", operatorBoardSchema, { method: "POST", body: "{}" }),
    onSuccess: setBoard,
  });
  const busy = markDown.isPending || markBack.isPending || reset.isPending;

  function openDownDialog(machine: Lane["machine"]) {
    setDownMachine(machine);
    setDownDays(1);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
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
                <h1 className="mt-1 font-display text-4xl">{t("planFor", { date: dates.full(board.data.planDate) })}</h1>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-3">
                  <Pill kind={board.data.plan.status} size="lg">
                    {board.data.plan.status === "approved" ? t("approved") : t("proposed")}
                  </Pill>
                  {board.data.plan.status === "proposed" ? (
                    <Button variant="accent" className="min-h-12 px-5 text-base" disabled={approve.isPending || busy} onClick={() => approve.mutate(board.data.plan.version)}>
                      <CheckCircle2 aria-hidden className="size-5" strokeWidth={1.75} />
                      {approve.isPending ? t("approving") : t("approve")}
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-ink-muted">
                  {board.data.plan.status === "approved" && board.data.plan.approvedBy
                    ? t("approvedBy", { name: board.data.plan.approvedBy })
                    : t("firmingNote", { count: board.data.plan.firmingCount })}
                </p>
              </div>
            </div>
            {notice ? (
              <p role="alert" className="mt-4 rounded-control border border-wheat-deep/30 bg-wheat-soft px-4 py-3 text-sm">
                {notice}
              </p>
            ) : null}

            <Card className="mt-6 p-6">
              <OneLineAnswer board={board.data} />
            </Card>

            <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-5">
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
              <Kpi
                icon={<Tractor aria-hidden className="size-3.5" strokeWidth={1.75} />}
                label={t("kpiMachines")}
                value={`${board.data.counts.machinesWorking}/${board.data.counts.machinesTotal}`}
              />
              <Kpi icon={<BellRing aria-hidden className="size-3.5" strokeWidth={1.75} />} label={t("kpiBroken")} value={String(board.data.counts.brokenThisSeason)} />
              <Kpi
                icon={<Scale aria-hidden className="size-3.5" strokeWidth={1.75} />}
                label={t("kpiFairness")}
                value={tc("days", { count: Math.max(0, board.data.solver.maxDelayVsQueueDays) })}
                hint={t("kpiFairnessHint")}
              />
            </div>

            <AnimatePresence>
              {board.data.lastReplan ? (
                <motion.section
                  key={board.data.lastReplan.at}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-5 rounded-card border border-sky/30 bg-sky-soft/60 p-5"
                  aria-live="polite"
                >
                  <h2 className="font-medium">
                    {board.data.lastReplan.cause === "breakdown"
                      ? t("replanTitleBreakdown", { machine: board.data.lastReplan.machineName ?? "" })
                      : board.data.lastReplan.cause === "machine_back"
                        ? t("replanTitleBack", { machine: board.data.lastReplan.machineName ?? "" })
                        : t("replanTitleOther")}
                  </h2>
                  <p className="mt-1 text-sm">
                    {t("replanMoved", { count: board.data.lastReplan.moved.length })} ·{" "}
                    {board.data.lastReplan.broken.length === 0 ? t("replanNoneBroken") : t("replanBroken", { count: board.data.lastReplan.broken.length })}
                  </p>
                  {board.data.lastReplan.broken.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {board.data.lastReplan.broken.map((item) => (
                        <li key={item.fieldId} className="flex flex-wrap items-center gap-2">
                          <BellRing aria-hidden className="size-4 text-ember-deep" strokeWidth={1.75} />
                          <span className="font-medium tabular">#{String(item.token).padStart(3, "0")}</span> {item.farmerName}:
                          <span className="tabular line-through decoration-ink-muted/60">
                            {item.previous?.kind === "firm" ? dates.short(item.previous.date) : item.previous ? dates.range(item.previous.startDate, item.previous.endDate) : "—"}
                          </span>
                          →
                          <span className="tabular font-medium">
                            {item.next?.kind === "firm" ? dates.short(item.next.date) : item.next ? dates.range(item.next.startDate, item.next.endDate) : tr("unplanned")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </motion.section>
              ) : null}
            </AnimatePresence>

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
                        onMarkDown={() => openDownDialog(lane.machine)}
                        onMarkBack={() => markBack.mutate(lane.machine.id)}
                      />
                    ))}
                  </ul>
                </LayoutGroup>
                <p className="mt-3 text-xs text-ink-muted">
                  {t("solverNote", { status: board.data.solver.status, mode: board.data.solver.mode.replace("_", "-"), seconds: board.data.solver.wallSeconds })}
                </p>
              </section>

              <aside aria-labelledby="risk-title">
                <div className="flex items-baseline justify-between">
                  <h2 id="risk-title" className="font-display text-2xl">{t("atRiskTitle")}</h2>
                  <Link href="/operator/queue" className="text-sm text-sky underline underline-offset-2">{t("fullQueue")}</Link>
                </div>
                {board.data.atRisk.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">{t("atRiskEmpty")}</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {board.data.atRisk.slice(0, 8).map((item) => (
                      <li key={item.fieldId} className="rounded-card border border-line bg-surface p-4">
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
      </main>

      <dialog ref={dialogRef} className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-black/50" onClose={() => setDownMachine(null)}>
        {downMachine ? (
          <form
            method="dialog"
            className="p-6"
            onSubmit={(event) => {
              event.preventDefault();
              markDown.mutate({ machineId: downMachine.id, days: downDays });
              dialogRef.current?.close();
            }}
          >
            <h2 className="font-display text-2xl">{t("downTitle", { machine: downMachine.name })}</h2>
            <p className="mt-2 text-ink-muted">{t("downBody")}</p>
            <fieldset className="mt-5">
              <legend className="text-sm font-medium">{t("downDays")}</legend>
              <div className="mt-2 flex gap-2">
                {[1, 2, 3].map((days) => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={downDays === days}
                    onClick={() => setDownDays(days)}
                    className={`min-h-11 flex-1 rounded-control border ${downDays === days ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface"}`}
                  >
                    {tc("days", { count: days })}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
                {t("cancel")}
              </Button>
              <Button type="submit">{t("replanNow")}</Button>
            </div>
          </form>
        ) : null}
      </dialog>

      {busy ? (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-paper">
          {t("replanning")}
        </div>
      ) : null}
    </>
  );
}
