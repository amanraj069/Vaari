"use client";

/**
 * /dashboard/machines for an operator: the centre's fleet in one place. Each machine says in a word
 * where it is tomorrow (working, in the workshop, lent to another centre, borrowed from one), how
 * fast it sows (the cautious and the usual speed, learned from work logs), and what the approved
 * plan gives it over the next ten days. The operator adds a machine (bought or rented in) or takes
 * one of their own out; either makes a new draft, and nothing a farmer sees changes until it is
 * approved on the plan page. Loans are the district officer's: a lent or borrowed machine cannot be
 * removed here, and it goes home when the officer ends the loan.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ClipboardCheck, Plus, Tractor, Trash2, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { operatorMachinesSchema, operatorPlanSchema, type OperatorMachines } from "@/shared";
import { DashHeader, NextStep } from "@/components/dashboard/kit";
import { Dialog } from "@/components/dialog";
import { MachineDownDialog } from "@/components/machine-down-dialog";
import { Button, ButtonLink, Pill, Skeleton, StateMessage } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";

type Machine = OperatorMachines["machines"][number];

function MachineStatus({ machine }: { machine: Machine }) {
  const t = useTranslations("machines");
  if (machine.loan && machine.status === "away") return <Pill kind="window">{t(machine.loan.direction === "out" ? "statusLent" : "statusNotHere", { centre: machine.loan.centreName })}</Pill>;
  if (machine.status === "down") return <Pill kind="tight">{t("statusWorkshop")}</Pill>;
  if (machine.loan) return <Pill kind="window">{t("statusBorrowed", { centre: machine.loan.centreName })}</Pill>;
  return <Pill kind="safe">{t("statusWorking")}</Pill>;
}

function MachineCard({ machine, busy, onDown, onBack, onRemove }: { machine: Machine; busy: boolean; onDown: () => void; onBack: () => void; onRemove: () => void }) {
  const t = useTranslations("machines");
  const dates = useDates();
  const away = machine.status === "away";
  return (
    <li className="flex flex-col rounded-card border border-line bg-surface">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{machine.name}</p>
          <p className="text-xs text-ink-muted">{t(`kind_${machine.kind}`)}</p>
        </div>
        <MachineStatus machine={machine} />
      </div>
      <dl className="mb-4 mt-3 grid grid-cols-2 gap-x-4 gap-y-3 px-4 text-sm sm:px-5">
        <div>
          <dt className="text-xs text-ink-muted">{t("speed")}</dt>
          <dd className="tabular">{t("speedValue", { promise: machine.promiseAcresPerDay, plan: machine.planAcresPerDay })}</dd>
          <dd className="text-xs text-ink-muted">{machine.logsCount > 0 ? t("speedLearned", { count: machine.logsCount }) : t("speedPrior")}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("nextTenDays")}</dt>
          <dd className="tabular">{t("planned", { fields: machine.plannedFields, acres: machine.plannedAcres })}</dd>
        </div>
        {machine.loan ? (
          <div className="col-span-2">
            <dt className="sr-only">{t("loan")}</dt>
            <dd className="flex items-start gap-1.5 text-sky">
              <ArrowLeftRight aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              {t(machine.loan.direction === "out" ? "loanOut" : "loanIn", { centre: machine.loan.centreName, range: dates.range(machine.loan.startDate, machine.loan.endDate) })}
            </dd>
          </div>
        ) : null}
        {machine.downDates.length > 0 ? (
          <div className="col-span-2">
            <dt className="text-xs text-ink-muted">{t("workshopDays")}</dt>
            <dd>{machine.downDates.map((iso) => dates.short(iso)).join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
        {away ? (
          <p className="text-xs text-ink-muted">{t("loanNote")}</p>
        ) : machine.status === "down" ? (
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            <Tractor aria-hidden className="size-4" strokeWidth={1.75} />
            {t("markBack")}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={onDown}>
            <Wrench aria-hidden className="size-4" strokeWidth={1.75} />
            {t("markDown")}
          </Button>
        )}
        {machine.removable ? (
          <Button variant="quiet" disabled={busy} onClick={onRemove} className="ml-auto text-ember-deep hover:bg-ember-soft/60">
            <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
            {t("remove")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function AddMachineDialog({ open, onClose, onAdd, busy }: { open: boolean; onClose: () => void; onAdd: (input: { name: string; kind: Machine["kind"] }) => void; busy: boolean }) {
  const t = useTranslations("machines");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Machine["kind"]>("super_seeder");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onAdd({ name: name.trim(), kind });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("addTitle")}
      description={t("addBody")}
      closeLabel={tc("close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="add-machine" disabled={busy || !name.trim()}>
            {t("addConfirm")}
          </Button>
        </>
      }
    >
      <form id="add-machine" onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">{t("nameLabel")}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder={t("namePlaceholder")}
            className="mt-1.5 min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-base focus:border-ink/50 focus:outline-none"
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">{t("kindLabel")}</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(["super_seeder", "happy_seeder"] as const).map((option) => (
              <label key={option} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm ${kind === option ? "border-ink bg-paper font-medium" : "border-line-strong"}`}>
                <input type="radio" name="kind" value={option} checked={kind === option} onChange={() => setKind(option)} className="accent-ink" />
                {t(`kind_${option}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

export function OperatorMachinesView() {
  const t = useTranslations("machines");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const machines = useQuery({ queryKey: ["operator-machines"], queryFn: () => api("operator/machines", operatorMachinesSchema), refetchInterval: 15_000 });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Machine | null>(null);
  const [downMachine, setDownMachine] = useState<{ id: string; name: string } | null>(null);

  const refresh = (next?: OperatorMachines) => {
    if (next) queryClient.setQueryData(["operator-machines"], next);
    else queryClient.invalidateQueries({ queryKey: ["operator-machines"] });
    queryClient.invalidateQueries({ queryKey: ["operator-board"] });
    queryClient.invalidateQueries({ queryKey: ["operator-plan"] });
  };
  const add = useMutation({
    mutationFn: (input: { name: string; kind: Machine["kind"] }) => api("operator/machines", operatorMachinesSchema, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (next) => {
      setAdding(false);
      refresh(next);
    },
  });
  const remove = useMutation({
    mutationFn: (machineId: string) => api(`operator/machines/${machineId}`, operatorMachinesSchema, { method: "DELETE" }),
    onSuccess: (next) => {
      setRemoving(null);
      refresh(next);
    },
  });
  const markDown = useMutation({
    mutationFn: (input: { machineId: string; days: number }) => api(`operator/machines/${input.machineId}/down`, operatorPlanSchema, { method: "POST", body: JSON.stringify({ days: input.days }) }),
    onSuccess: () => {
      setDownMachine(null);
      refresh();
    },
  });
  const markBack = useMutation({
    mutationFn: (machineId: string) => api(`operator/machines/${machineId}/up`, operatorPlanSchema, { method: "POST", body: "{}" }),
    onSuccess: () => refresh(),
  });
  const busy = add.isPending || remove.isPending || markDown.isPending || markBack.isPending;
  const failed = [add.error, remove.error, markDown.error, markBack.error].find(Boolean);

  if (machines.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only" role="status">
          {tc("loading")}
        </span>
        <Skeleton className="h-10 w-1/2" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-48" />
          ))}
        </div>
      </div>
    );
  }
  if (machines.isError) {
    return <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => machines.refetch()}>{tc("retry")}</Button>} />;
  }

  const data = machines.data;
  const workingTomorrow = data.machines.filter((machine) => machine.status === "working");
  const canSow = Math.round(workingTomorrow.reduce((sum, machine) => sum + machine.promiseAcresPerDay, 0));

  return (
    <>
      <DashHeader
        context={data.chc.name}
        title={t("title")}
        description={t("intro", { count: data.machines.length, working: workingTomorrow.length, acres: canSow })}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" strokeWidth={2} />
            {t("add")}
          </Button>
        }
      />

      {data.draftWaiting ? (
        <div className="mt-6">
          <NextStep icon={ClipboardCheck} tone="warn" title={t("draftTitle")} body={t("draftBody")} action={<ButtonLink href="/dashboard/plan">{t("draftAction")}</ButtonLink>} />
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="mt-4 rounded-control border border-ember/30 bg-ember-soft/40 px-4 py-3 text-sm text-ember-deep">
          {failed instanceof ApiError && failed.status === 409 ? t("conflict") : tc("errorBody")}
        </p>
      ) : null}

      <ul className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {data.machines.map((machine) => (
          <MachineCard
            key={machine.id}
            machine={machine}
            busy={busy}
            onDown={() => setDownMachine({ id: machine.id, name: machine.name })}
            onBack={() => markBack.mutate(machine.id)}
            onRemove={() => setRemoving(machine)}
          />
        ))}
      </ul>
      <p className="mt-6 text-xs text-ink-muted">{t("footnote")}</p>

      <AddMachineDialog open={adding} onClose={() => setAdding(false)} onAdd={(input) => add.mutate(input)} busy={add.isPending} />
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("removeTitle", { name: removing?.name ?? "" })}
        description={t("removeBody")}
        closeLabel={tc("close")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t("cancel")}
            </Button>
            <Button disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id)} className="border-ember-deep bg-ember-deep hover:bg-ember-deep/90">
              {t("removeConfirm")}
            </Button>
          </>
        }
      />
      <MachineDownDialog machine={downMachine} onClose={() => setDownMachine(null)} onConfirm={(input) => markDown.mutate(input)} />
    </>
  );
}
