"use client";

/**
 * MoveFieldDialog: the operator moves one field to a machine and a day. Days a machine is in the
 * workshop, and rain days, are shown but cannot be picked, with the reason in words. The engine
 * re-plans everyone else around the move and the page shows what changes before approval.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { LaneStop, OperatorPlan } from "@/shared";
import { useDates } from "@/lib/dates";
import { Dialog } from "./dialog";
import { Button, Spinner } from "./ui";

type Props = {
  stop: LaneStop | null;
  currentMachineId: string | null;
  planDate: string;
  options: OperatorPlan["moveOptions"];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onMove: (input: { machineId: string; date: string }) => void;
};

export function MoveFieldDialog({ stop, currentMachineId, planDate, options, pending, error, onClose, onMove }: Props) {
  const t = useTranslations("plan");
  const tc = useTranslations("common");
  const dates = useDates();
  const [machineId, setMachineId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const chosenMachine = machineId ?? currentMachineId ?? options.machines[0]?.id ?? "";
  const chosenDate = date ?? planDate;
  const machine = options.machines.find((item) => item.id === chosenMachine);
  const blocked = (day: string) => options.rainDates.includes(day) || Boolean(machine?.downDates.includes(day));

  function close() {
    setMachineId(null);
    setDate(null);
    onClose();
  }

  return (
    <Dialog
      open={stop !== null}
      onClose={close}
      title={stop ? t("moveTitle", { token: String(stop.token).padStart(3, "0"), name: stop.farmerName }) : ""}
      description={t("moveBody")}
      closeLabel={tc("close")}
      footer={
        <Button variant="accent" className="min-h-12" disabled={pending || blocked(chosenDate)} onClick={() => onMove({ machineId: chosenMachine, date: chosenDate })}>
          {pending ? <Spinner label={t("moving")} /> : t("moveSubmit")}
        </Button>
      }
    >
      <fieldset>
        <legend className="text-sm font-medium">{t("moveMachine")}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {options.machines.map((item) => (
            <label
              key={item.id}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-wheat has-[:focus-visible]:ring-offset-2 ${chosenMachine === item.id ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface"}`}
            >
              <input type="radio" name="move-machine" className="sr-only" checked={chosenMachine === item.id} onChange={() => setMachineId(item.id)} />
              {item.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-5">
        <legend className="text-sm font-medium">{t("moveDay")}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.dates.map((day) => {
            const why = options.rainDates.includes(day) ? t("moveRain") : machine?.downDates.includes(day) ? t("moveDownThatDay") : null;
            return (
              <label
                key={day}
                className={`flex min-h-11 flex-col justify-center rounded-control border px-3 py-1 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-wheat has-[:focus-visible]:ring-offset-2 ${
                  why ? "cursor-not-allowed border-dashed border-line text-ink-muted" : chosenDate === day ? "cursor-pointer border-ink bg-ink text-paper" : "cursor-pointer border-line-strong bg-surface"
                }`}
              >
                <input type="radio" name="move-day" className="sr-only" disabled={why !== null} checked={chosenDate === day} onChange={() => setDate(day)} />
                <span className="tabular">{dates.short(day)}</span>
                {why ? <span className="text-xs">{why}</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-4 text-ember-deep">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
