"use client";

/**
 * MachineDownDialog: the operator says a machine is in the workshop, for how many days from
 * tomorrow. Vaari makes a new draft at once; nothing changes for farmers until it is approved.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog } from "./dialog";
import { Button } from "./ui";

type Props = {
  machine: { id: string; name: string } | null;
  onClose: () => void;
  onConfirm: (input: { machineId: string; days: number }) => void;
};

export function MachineDownDialog({ machine, onClose, onConfirm }: Props) {
  const t = useTranslations("operator");
  const tc = useTranslations("common");
  const [days, setDays] = useState(1);

  function close() {
    setDays(1);
    onClose();
  }

  return (
    <Dialog
      open={machine !== null}
      onClose={close}
      title={machine ? t("downTitle", { machine: machine.name }) : ""}
      description={t("downBody")}
      closeLabel={tc("close")}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (machine) onConfirm({ machineId: machine.id, days });
              close();
            }}
          >
            {t("replanNow")}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="text-sm font-medium">{t("downDays")}</legend>
        <div className="mt-2 flex gap-2">
          {[1, 2, 3].map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={days === count}
              onClick={() => setDays(count)}
              className={`min-h-11 flex-1 rounded-control border ${days === count ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface"}`}
            >
              {tc("days", { count })}
            </button>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}
