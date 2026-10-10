"use client";

/**
 * FarmerTicketForm: a registered farmer books a field for their own phone in five short steps
 * (village, acres, harvest day, waiting days, check). No name, phone or consent to ask: the session
 * is the phone, and the account holds the name and the farmer's own consent. The machine centre is
 * the one that serves the village. The new field shows on /farmer at once; it gets a date when the
 * operator publishes the next plan.
 */
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { Booking, FarmerVillageOption, FieldRequestInput } from "@/shared";
import { ApiError } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { AcresStep, ReadyStep, VillageStep, WaitStep, addDays, readyChoices } from "./field-steps";
import { StepProgress } from "./step-progress";
import { Button, ButtonLink } from "./ui";

type Props = {
  villages: FarmerVillageOption[] | null;
  today: string | null;
  onSubmit: (input: FieldRequestInput) => Promise<Booking>;
};

export function FarmerTicketForm({ villages, today, onSubmit }: Props) {
  const t = useTranslations("farmerNew");
  const tr = useTranslations("request");
  const tb = useTranslations("book");
  const tc = useTranslations("common");
  const tf = useTranslations("farmer");
  const dates = useDates();
  const steps = [tr("stepVillage"), tr("stepAcres"), tr("stepReady"), tr("stepWait"), tr("stepReview")];
  const [step, setStep] = useState(0);
  const [villageId, setVillageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [acres, setAcres] = useState(3);
  const [readyDate, setReadyDate] = useState<string | null>(null);
  const [waitDays, setWaitDays] = useState(6);
  const [state, setState] = useState<"idle" | "saving" | "failed" | "tooMany" | "notRegistered">("idle");
  const [booked, setBooked] = useState<Booking | null>(null);

  const readyOptions = useMemo(() => readyChoices(today), [today]);
  const village = villages?.find((item) => item.id === villageId);
  const canContinue = [Boolean(villageId), acres > 0, Boolean(readyDate), true, true][step];

  async function submit() {
    if (!villageId || !readyDate) return;
    setState("saving");
    try {
      setBooked(await onSubmit({ villageId, acres, readyDate, waitingLimitDays: waitDays }));
      setState("idle");
    } catch (error) {
      setState(error instanceof ApiError && error.code === "TOO_MANY_FIELDS" ? "tooMany" : error instanceof ApiError && error.code === "NOT_REGISTERED" ? "notRegistered" : "failed");
    }
  }

  function reset() {
    setBooked(null);
    setStep(0);
    setVillageId(null);
    setSearch("");
    setAcres(3);
    setReadyDate(null);
    setWaitDays(6);
  }

  if (booked) {
    return (
      <section aria-labelledby="ticket-success" className="rounded-card border border-field/30 bg-field-soft/50 p-6">
        <h2 id="ticket-success" className="flex items-center gap-2 font-display text-2xl">
          <Check aria-hidden className="size-6 text-field" strokeWidth={2} />
          {tr("successTitle")}
        </h2>
        <p className="mt-1 text-ink-muted">
          {tc("acres", { acres: booked.field.acres })} · {booked.field.villageName}
        </p>
        <p className="mt-3">{tr("successNoDate")}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink href="/farmer" variant="accent" className="min-h-12">
            {tr("seeMyFields")}
          </ButtonLink>
          <Button variant="quiet" className="min-h-12" onClick={reset}>
            {t("another")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="ticket-title" className="rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 id="ticket-title" className="sr-only">
        {tf("newBooking")}
      </h2>
      <StepProgress steps={steps} current={step} label={t("progress")} />

      <div className="mt-6 text-lg">
        {step === 0 ? (
          <VillageStep villages={villages} villageId={villageId} onPick={setVillageId} search={search} onSearch={setSearch} />
        ) : step === 1 ? (
          <AcresStep acres={acres} onChange={setAcres} />
        ) : step === 2 ? (
          <ReadyStep options={readyOptions} readyDate={readyDate} onPick={setReadyDate} />
        ) : step === 3 ? (
          <WaitStep question={tr("waitQuestion")} help={tr("waitHelp")} waitDays={waitDays} onChange={setWaitDays} readyDate={readyDate} />
        ) : (
          <div>
            <h3 className="font-display text-2xl">{tr("reviewTitle")}</h3>
            <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-paper">
              {[
                [tr("stepVillage"), village?.name ?? "", 0],
                [t("centre"), village?.chcName ?? "", 0],
                [tr("stepAcres"), tc("acres", { acres }), 1],
                [tr("stepReady"), readyDate ? dates.full(readyDate) : "", 2],
                [tr("stepWait"), readyDate ? tb("waitValue", { count: waitDays, date: dates.short(addDays(readyDate, waitDays)) }) : "", 3],
              ].map(([label, value, target]) => (
                <div key={String(label)} className="flex items-center justify-between gap-3 px-4 py-3 text-base">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="flex items-center gap-2 text-right">
                    {value}
                    <button type="button" onClick={() => setStep(Number(target))} className="grid size-11 place-items-center rounded-control text-sky hover:bg-ink/5">
                      ✎<span className="sr-only">{label}</span>
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            {state === "failed" || state === "tooMany" || state === "notRegistered" ? (
              <p role="alert" className="mt-3 text-ember-deep">
                {state === "tooMany" ? t("tooMany") : state === "notRegistered" ? t("notRegistered") : tr("failed")}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-5 flex gap-3">
        {step > 0 ? (
          <Button variant="secondary" className="min-h-12 flex-1" disabled={state === "saving"} onClick={() => setStep((value) => value - 1)}>
            <ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />
            {tr("back")}
          </Button>
        ) : null}
        {step < steps.length - 1 ? (
          <Button className="min-h-12 flex-[2]" disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>
            {tr("next")}
            <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
          </Button>
        ) : (
          <Button variant="accent" className="min-h-12 flex-[2]" disabled={state === "saving"} onClick={submit}>
            {state === "saving" ? t("submitting") : t("submit")}
          </Button>
        )}
      </div>
    </section>
  );
}
