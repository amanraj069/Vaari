"use client";

/**
 * The panel beside the officer's map. With no centre chosen it is the decision: numbered machine
 * loans (the same numbers as the arrows on the map; pointing at one lights its arrow, choosing one
 * opens the borrowing centre), machines to add if lending is not enough, and centres one breakdown
 * away. With a centre chosen it is that centre's few facts and what the outlook says for it. Every
 * number comes from the API's outlook and counts (computed in code, a forecast); centres are
 * named, farmers never are. The full table of centres is one link away (/dashboard/centres).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, ArrowRight, CheckCircle2, Truck, Wrench } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OfficerCentre, OfficerOverview } from "@/shared";
import { useDates } from "@/lib/dates";
import { Dialog } from "../dialog";
import { Button, Pill } from "../ui";
import { ApiError, api } from "@/lib/api";
import { centreState } from "./status";

const whole = (acres: number) => Math.round(acres);

const rowButton =
  "flex min-h-11 w-full items-center gap-3 rounded-control px-2 py-2.5 text-left transition-colors hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink";

type Move = OfficerOverview["outlook"]["moves"][number];
type Loan = OfficerOverview["outlook"]["loans"][number];

function ActionList({
  overview,
  onSelect,
  onHighlight,
  onArrange,
  onEnd,
  busy,
}: {
  overview: OfficerOverview;
  onSelect: (centreId: string) => void;
  onHighlight: (move: number | null) => void;
  onArrange: (move: Move) => void;
  onEnd: (loan: Loan) => void;
  busy: boolean;
}) {
  const dates = useDates();
  const t = useTranslations("officer");
  const { outlook } = overview;
  const name = (centreId: string) => (overview.centres.find((centre) => centre.id === centreId)?.name ?? centreId).replace(/ CHC$/, "");
  const fragile = overview.centres.filter((centre) => centreState(centre) === "fragile").sort((left, right) => (right.outlook.lateIfOneDownAcres ?? 0) - (left.outlook.lateIfOneDownAcres ?? 0));
  const nothingToDo = outlook.moves.length === 0 && outlook.extraMachines.length === 0;

  return (
    <div className="space-y-5">
      <section aria-labelledby="officer-actions-title">
        <h2 id="officer-actions-title" className="px-2 text-base font-semibold">
          {t("movesTitle")}
        </h2>
        {nothingToDo ? (
          <p className="mt-2 flex items-start gap-2.5 px-2 text-sm">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-field" strokeWidth={1.75} />
            {t("movesNone")}
          </p>
        ) : (
          <ol className="mt-1.5">
            {outlook.moves.map((move, index) => (
              <li key={`${move.fromCentreId}-${move.toCentreId}-${index}`} className="flex items-center gap-1">
                <button
                  type="button"
                  className={`${rowButton} min-w-0 flex-1`}
                  onPointerEnter={() => onHighlight(index)}
                  onPointerLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(index)}
                  onBlur={() => onHighlight(null)}
                  onClick={() => onSelect(move.toCentreId)}
                >
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-wheat-deep/60 bg-wheat-soft text-[11px] font-semibold text-wheat-deep tabular">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{t("movesLendSr", { from: name(move.fromCentreId), to: name(move.toCentreId) })}</span>
                    <span aria-hidden className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium">
                      {name(move.fromCentreId)}
                      <ArrowRight className="size-3.5 text-ink-muted" strokeWidth={1.75} />
                      {name(move.toCentreId)}
                    </span>
                    <span className="block text-xs text-ink-muted">{t("movesEffect", { km: move.distanceKm, before: whole(move.lateBeforeAcres), after: whole(move.lateAfterAcres) })}</span>
                  </span>
                </button>
                <Button variant="secondary" disabled={busy} onClick={() => onArrange(move)} className="shrink-0 px-3 text-sm" aria-label={t("arrangeAria", { from: name(move.fromCentreId), to: name(move.toCentreId) })}>
                  {t("arrange")}
                </Button>
              </li>
            ))}
            {outlook.extraMachines.map((extra) => (
              <li key={`extra-${extra.centreId}`}>
                <button type="button" className={rowButton} onClick={() => onSelect(extra.centreId)}>
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-ember-soft text-ember-deep">
                    <Truck className="size-3.5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t("movesAdd", { count: extra.machines, centre: name(extra.centreId) })}</span>
                    <span className="block text-xs text-ink-muted">{t("movesAddEffect", { acres: whole(extra.lateAcres) })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {outlook.loans.length > 0 ? (
        <section aria-labelledby="officer-loans-title" className="border-t border-line pt-4">
          <h2 id="officer-loans-title" className="flex items-center gap-2 px-2 text-sm font-semibold">
            <ArrowLeftRight aria-hidden className="size-4 text-sky" strokeWidth={1.75} />
            {t("loansTitle")}
          </h2>
          <ul className="mt-1">
            {outlook.loans.map((loan) => (
              <li key={loan.id} className="flex items-center gap-2 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium">
                    {name(loan.fromChcId)}
                    <ArrowRight aria-hidden className="size-3.5 text-ink-muted" strokeWidth={1.75} />
                    {name(loan.toChcId)}
                  </p>
                  <p className="text-xs text-ink-muted">{t("loanLine", { machine: loan.machineName, range: dates.range(loan.startDate, loan.endDate) })}</p>
                </div>
                <Button variant="quiet" disabled={busy} onClick={() => onEnd(loan)} className="shrink-0 px-3 text-sm">
                  {t("endLoan")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="officer-fragile-title" className="border-t border-line pt-4">
        <h2 id="officer-fragile-title" className="flex items-center gap-2 px-2 text-sm font-semibold">
          <Wrench aria-hidden className="size-4 text-wheat-deep" strokeWidth={1.75} />
          {t("fragileTitle")}
        </h2>
        {fragile.length === 0 ? (
          <p className="mt-1.5 px-2 text-sm text-ink-muted">{t("fragileNone")}</p>
        ) : (
          <>
            <p className="mt-1 px-2 text-xs text-ink-muted">{t("fragileBody")}</p>
            <ul className="mt-1">
              {fragile.slice(0, 3).map((centre) => (
                <li key={centre.id}>
                  <button type="button" className={`${rowButton} justify-between py-2`} onClick={() => onSelect(centre.id)}>
                    <span className="min-w-0 truncate text-sm">{centre.name.replace(/ CHC$/, "")}</span>
                    <span className="shrink-0 text-xs tabular text-ink-muted">{t("fragileAcres", { acres: whole(centre.outlook.lateIfOneDownAcres ?? 0) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function CentreDetail({
  overview,
  centre,
  onBack,
  onArrange,
  onEnd,
  busy,
}: {
  overview: OfficerOverview;
  centre: OfficerCentre;
  onBack: () => void;
  onArrange: (move: Move) => void;
  onEnd: (loan: Loan) => void;
  busy: boolean;
}) {
  const t = useTranslations("officer");
  const dates = useDates();
  const state = centreState(centre);
  const name = (centreId: string) => (overview.centres.find((item) => item.id === centreId)?.name ?? centreId).replace(/ CHC$/, "");
  const borrows = overview.outlook.moves.find((move) => move.toCentreId === centre.id);
  const lends = overview.outlook.moves.filter((move) => move.fromCentreId === centre.id);
  const extra = overview.outlook.extraMachines.find((item) => item.centreId === centre.id);
  const loansHere = overview.outlook.loans.filter((loan) => loan.fromChcId === centre.id || loan.toChcId === centre.id);
  const { lateAcres, lateIfOneDownAcres, lateIfOneMoreAcres } = centre.outlook;
  const lastDate = overview.outlook.days[overview.outlook.days.length - 1]?.date;
  const outlookLine =
    state === "late"
      ? t("detailLate", { acres: whole(lateAcres), date: lastDate ? dates.dayMonth(lastDate) : "" }) + " " + (whole(lateIfOneMoreAcres) === 0 ? t("outlookOneMoreClears") + "." : t("outlookOneMore", { acres: whole(lateIfOneMoreAcres) }) + ".")
      : state === "fragile"
        ? t("detailFragile", { acres: whole(lateIfOneDownAcres ?? 0) })
        : lateIfOneDownAcres !== null
          ? t("detailCanSpare")
          : t("detailOnTime");
  const action = borrows
    ? t("detailBorrows", { from: name(borrows.fromCentreId), km: borrows.distanceKm, after: whole(borrows.lateAfterAcres) })
    : lends.length > 0
      ? t("detailLends", { to: lends.map((move) => name(move.toCentreId)).join(", "), count: lends.length })
      : extra
        ? t("movesAdd", { count: extra.machines, centre: name(centre.id) })
        : null;

  return (
    <section aria-labelledby="officer-centre-title" className="px-2">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        {t("detailBack")}
      </button>
      <h2 id="officer-centre-title" className="mt-1 text-lg font-semibold leading-snug">
        {centre.name}
      </h2>
      <p className="text-xs text-ink-muted">{t("centreVillages", { count: centre.villageCount })}</p>
      <div className="mt-3">
        {state === "late" ? <Pill kind="at_risk">{t("outlookLate", { acres: whole(lateAcres) })}</Pill> : state === "fragile" ? <Pill kind="tight">{t("outlookFragile")}</Pill> : <Pill kind="safe">{t("outlookOnTime")}</Pill>}
      </div>
      <p className="mt-2 text-sm">{outlookLine}</p>
      {action ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-wheat/45 bg-surface px-3 py-2">
          <p className="min-w-0 flex-1 basis-48 text-sm font-medium">{action}</p>
          {/* The suggestion is one tap from done, here as in the list. */}
          {borrows || lends[0] ? (
            <Button disabled={busy} onClick={() => onArrange((borrows ?? lends[0])!)} className="shrink-0 px-3 text-sm">
              {t("arrange")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {loansHere.map((loan) => (
        <div key={loan.id} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-sky/40 bg-surface px-3 py-2">
          <p className="min-w-0 flex-1 basis-48 text-sm font-medium">
            {loan.fromChcId === centre.id
              ? t("detailLoanOut", { machine: loan.machineName, to: name(loan.toChcId), range: dates.range(loan.startDate, loan.endDate) })
              : t("detailLoanIn", { machine: loan.machineName, from: name(loan.fromChcId), range: dates.range(loan.startDate, loan.endDate) })}
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => onEnd(loan)} className="shrink-0 px-3 text-sm">
            {t("endLoan")}
          </Button>
        </div>
      ))}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">{t("colMachines")}</dt>
          <dd className="tabular">{t("machinesOf", { working: centre.machinesWorking, total: centre.machinesTotal })}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("detailCanSow")}</dt>
          <dd className="tabular">{t("acresShort", { acres: whole(centre.outlook.capacityAcresPerDay) })}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("kpiRisk")}</dt>
          <dd className={`tabular ${centre.burnRisk > 0 ? "font-medium text-ember-deep" : ""}`}>{centre.burnRisk}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("detailWaiting")}</dt>
          <dd className="tabular">{t("acresShort", { acres: whole(centre.outlook.waitingAcres) })}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-ink-muted">{t("kpiOnTrack")}</dt>
          <dd className="tabular">{t("onTrackOf", { onTrack: centre.promisesOnTrack, open: centre.promisesOpen })}</dd>
        </div>
      </dl>
    </section>
  );
}

export function DistrictPanel({
  overview,
  selectedId,
  onSelect,
  onHighlight,
}: {
  overview: OfficerOverview;
  selectedId: string | null;
  onSelect: (centreId: string | null) => void;
  onHighlight: (move: number | null) => void;
}) {
  const t = useTranslations("officer");
  const selected = selectedId ? overview.centres.find((centre) => centre.id === selectedId) ?? null : null;
  const { totals } = overview;
  const dates = useDates();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<Move | null>(null);
  // How long the loan lasts, from tomorrow: the forecast looks ten days ahead, so ten is the default.
  const [loanDays, setLoanDays] = useState(10);
  const [ending, setEnding] = useState<Loan | null>(null);
  const name = (centreId: string) => (overview.centres.find((centre) => centre.id === centreId)?.name ?? centreId).replace(/ CHC$/, "");
  const done = () => queryClient.invalidateQueries({ queryKey: ["officer-overview"] });
  const arrange = useMutation({
    mutationFn: (move: Move) => api("officer/loans", z.object({ loanId: z.string() }), { method: "POST", body: JSON.stringify({ fromChcId: move.fromCentreId, toChcId: move.toCentreId, days: loanDays }) }),
    onSuccess: async () => {
      setConfirming(null);
      setLoanDays(10);
      await done();
    },
  });
  const end = useMutation({
    mutationFn: (loan: Loan) => api(`officer/loans/${encodeURIComponent(loan.id)}`, z.object({ ended: z.string() }), { method: "DELETE" }),
    onSuccess: async () => {
      setEnding(null);
      await done();
    },
  });
  const failed = arrange.error ?? end.error;
  const firstDate = overview.outlook.days[0]?.date;
  const lastDate = overview.outlook.days[overview.outlook.days.length - 1]?.date;
  const loanEnd = overview.outlook.days[Math.min(loanDays, overview.outlook.days.length) - 1]?.date;
  const range = firstDate && loanEnd ? dates.range(firstDate, loanEnd) : "";
  const dayOptions = [3, 5, 7, 10].filter((days) => days <= overview.outlook.days.length);
  return (
    <div className="flex h-full flex-col">
      {failed ? (
        <p role="alert" className="mb-3 rounded-control border border-ember/30 bg-ember-soft/40 px-3 py-2 text-sm text-ember-deep">
          {failed instanceof ApiError && failed.status === 409 ? t("arrangeConflict") : t("arrangeFailed")}
        </p>
      ) : null}
      <div aria-live="polite">
        {selected ? (
          <CentreDetail overview={overview} centre={selected} onBack={() => onSelect(null)} onArrange={setConfirming} onEnd={setEnding} busy={arrange.isPending || end.isPending} />
        ) : (
          <ActionList overview={overview} onSelect={onSelect} onHighlight={onHighlight} onArrange={setConfirming} onEnd={setEnding} busy={arrange.isPending || end.isPending} />
        )}
      </div>
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming ? t("arrangeTitle", { from: name(confirming.fromCentreId), to: name(confirming.toCentreId) }) : ""}
        description={confirming ? t("arrangeBody", { from: name(confirming.fromCentreId), to: name(confirming.toCentreId), range }) : ""}
        closeLabel={t("close")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              {t("cancel")}
            </Button>
            <Button disabled={arrange.isPending} onClick={() => confirming && arrange.mutate(confirming)}>
              {t("arrangeConfirm")}
            </Button>
          </>
        }
      >
        <fieldset>
          <legend className="text-sm font-medium">{t("loanLengthLabel")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {dayOptions.map((days) => {
              const until = overview.outlook.days[days - 1]?.date;
              return (
                <label
                  key={days}
                  className={`flex min-h-14 cursor-pointer flex-col justify-center rounded-control border px-3 py-2 text-sm ${loanDays === days ? "border-ink bg-paper font-medium" : "border-line-strong"}`}
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="loan-days" value={days} checked={loanDays === days} onChange={() => setLoanDays(days)} className="accent-ink" />
                    {t("loanDays", { count: days })}
                  </span>
                  {until ? <span className="pl-6 text-xs font-normal text-ink-muted">{t("loanUntil", { date: dates.dayMonth(until) })}</span> : null}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{t("loanLengthHint")}</p>
        </fieldset>
      </Dialog>
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={ending ? t("endTitle", { machine: ending.machineName, from: name(ending.fromChcId) }) : ""}
        description={ending ? t("endBody", { to: name(ending.toChcId) }) : ""}
        closeLabel={t("close")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnding(null)}>
              {t("cancel")}
            </Button>
            <Button disabled={end.isPending} onClick={() => ending && end.mutate(ending)}>
              {t("endLoan")}
            </Button>
          </>
        }
      />
      {/* The district's state in three lines, under the decision (the full numbers are on /dashboard/centres). */}
      <section aria-labelledby="officer-today-title" className="mt-5 border-t border-line pt-4">
        <h2 id="officer-today-title" className="px-2 text-sm font-semibold">
          {t("todayTitle")}
        </h2>
        <dl className="mt-2 space-y-2 px-2 text-sm">
          {[
            [t("kpiMachines"), t("machinesOf", { working: totals.machinesWorking, total: totals.machinesTotal })],
            [t("kpiOnTrack"), t("onTrackOf", { onTrack: totals.promisesOnTrack, open: totals.promisesOpen })],
            [t("todaySown"), t("todaySownValue", { fields: totals.fieldsSown, kept: totals.promisesKept })],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="shrink-0 font-medium tabular">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Link
        href="/dashboard/centres"
        className="mt-4 inline-flex min-h-11 items-center gap-2 border-t border-line px-2 pt-3 text-sm font-medium text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-wheat-deep"
      >
        {t("seeAllCentres", { count: overview.centres.length })}
        <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
      </Link>
    </div>
  );
}
