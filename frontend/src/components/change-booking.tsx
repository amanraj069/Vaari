"use client";

/**
 * "Change booking", wherever a booking is shown to someone who may change it: the farmer (their
 * slot link or their fields page) and the helper who booked it. Two real-life changes, in one
 * dialog: the harvest moved (pick the new day; the old date ends and the centre gives a new one in
 * its next plan), or the machine is no longer needed (cancel, after a second "are you sure"). The
 * API decides what is allowed; `base` is the booking's own address (slot/…, farmer/fields/…, fields/…).
 */
import { CalendarClock, PencilLine, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { Dialog } from "./dialog";
import { Button } from "./ui";
import { api } from "@/lib/api";

export function ChangeBooking({
  base,
  readyDate,
  today,
  label,
  compact = false,
  className = "",
  onDone,
}: {
  base: string;
  readyDate: string;
  today: string | null;
  // Who the booking is for, in list rows (the button's name); omitted on a single field.
  label?: string;
  compact?: boolean;
  // The text button's own sizing where it sits (under the status on a slot page's token).
  className?: string;
  onDone: (change: "harvest" | "cancel") => void;
}) {
  const t = useTranslations("changeBooking");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(readyDate);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  const close = () => {
    setOpen(false);
    setConfirmCancel(false);
    setState("idle");
    setDate(readyDate);
  };
  const send = async (change: "harvest" | "cancel") => {
    setState("saving");
    try {
      await api(`${base}/${change}`, z.unknown(), { method: "POST", body: change === "harvest" ? JSON.stringify({ readyDate: date }) : "{}" }, { redirectOn401: false });
      close();
      onDone(change);
    } catch {
      setState("failed");
    }
  };
  // The earliest day a harvest can have moved to: two weeks back (a combine came early).
  const earliest = today ? new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10) : undefined;

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={label ? t("openFor", { name: label }) : t("open")}
          className="grid size-11 shrink-0 place-items-center rounded-control border border-line-strong text-ink hover:border-ink/50"
        >
          <PencilLine aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      ) : (
        <Button variant="quiet" onClick={() => setOpen(true)} className={`px-3 text-ink-muted ${className}`}>
          <PencilLine aria-hidden className="size-4" strokeWidth={1.75} />
          {t("open")}
        </Button>
      )}
      <Dialog open={open} onClose={close} title={t("title")} description={t("body")} closeLabel={t("close")}>
        <div className="space-y-5">
          <section aria-labelledby="change-harvest-title">
            <h3 id="change-harvest-title" className="flex items-center gap-2 font-medium">
              <CalendarClock aria-hidden className="size-4 text-wheat-deep" strokeWidth={1.75} />
              {t("harvestTitle")}
            </h3>
            {/* Phones: the date across the sheet and Save under it, full width; wider: side by side. */}
            <div className="mt-2 grid gap-2 sm:flex sm:items-end">
              <label className="min-w-0 sm:flex-1">
                <span className="text-sm text-ink-muted">{t("harvestLabel")}</span>
                <input
                  type="date"
                  value={date}
                  min={earliest}
                  onChange={(event) => setDate(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-control border border-line-strong bg-raised px-3 text-base focus:border-ink/50 focus:outline-none shadow-control"
                />
              </label>
              <Button className="min-h-11" disabled={state === "saving" || !date || date === readyDate} onClick={() => send("harvest")}>
                {t("harvestSave")}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">{t("harvestHint")}</p>
          </section>
          <section aria-labelledby="change-cancel-title" className="border-t border-line pt-4">
            <h3 id="change-cancel-title" className="flex items-center gap-2 font-medium">
              <XCircle aria-hidden className="size-4 text-ember-deep" strokeWidth={1.75} />
              {t("cancelTitle")}
            </h3>
            {confirmCancel ? (
              <div className="mt-2 rounded-control border border-ember/30 bg-ember-soft/40 p-3">
                <p className="text-sm">{t("cancelSure")}</p>
                <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                  <Button variant="secondary" className="min-h-11" onClick={() => setConfirmCancel(false)}>
                    {t("keep")}
                  </Button>
                  <Button variant="danger" className="min-h-11" disabled={state === "saving"} onClick={() => send("cancel")}>
                    {t("cancelConfirm")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 grid gap-2 sm:flex sm:items-center sm:justify-between">
                <p className="text-sm text-ink-muted">{t("cancelBody")}</p>
                <Button variant="secondary" className="min-h-11 sm:shrink-0" onClick={() => setConfirmCancel(true)}>
                  {t("cancelAction")}
                </Button>
              </div>
            )}
          </section>
          {state === "failed" ? (
            <p role="alert" className="text-sm text-ember-deep">
              {t("failed")}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
