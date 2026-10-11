"use client";

/**
 * FarmerTicketForm: a registered farmer books a field for their own phone in five short steps
 * (village, acres, harvest day, waiting days, check). No name, phone or consent to ask: the session
 * is the phone, and the account holds the name and the farmer's own consent. The machine centre is
 * the one that serves the village. The new field shows on /farmer at once; it gets a date when the
 * operator publishes the next plan.
 */
import { ArrowLeft, ArrowRight, Check, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { Booking, FarmerVillageOption, FieldRequestInput } from "@/shared";
import { ApiError } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { AcresStep, ReadyStep, VillageStep, WaitStep, addDays, readyChoices } from "./field-steps";
import { StackPanel } from "./stack-panel";
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
      <section aria-labelledby="ticket-success" className="rounded-card border border-field/30 bg-field-soft/50 p-5 sm:p-6">
        <h2 id="ticket-success" className="flex items-center gap-2 font-display text-2xl">
          <Check aria-hidden className="size-6 text-field" strokeWidth={2} />
          {tr("successTitle")}
        </h2>
        <p className="mt-1 text-ink-muted">
          {tc("acres", { acres: booked.field.acres })} · {booked.field.villageName}
        </p>
        <p className="mt-3">{tr("successNoDate")}</p>
        <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
          <ButtonLink href="/dashboard" variant="accent" className="min-h-12">
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
    <section aria-labelledby="ticket-title" className="rounded-card border border-line bg-surface px-4 pt-4 sm:px-6 sm:pt-6 lg:pb-6">
      <h2 id="ticket-title" className="sr-only">
        {tf("newBooking")}
      </h2>
      <StepProgress steps={steps} current={step} label={t("progress")} />

      {/* Every step stays in one grid cell (StackPanel): the box is as tall as its tallest step and
          keeps that size through every step, so Back and Next never move. */}
      <div className="mt-5 grid text-base sm:mt-6 sm:text-lg">
        {[
          <VillageStep villages={villages} villageId={villageId} onPick={setVillageId} search={search} onSearch={setSearch} />,
          <AcresStep acres={acres} onChange={setAcres} />,
          <ReadyStep options={readyOptions} readyDate={readyDate} onPick={setReadyDate} />,
          <WaitStep question={tr("waitQuestion")} help={tr("waitHelp")} waitDays={waitDays} onChange={setWaitDays} readyDate={readyDate} />,
          <div>
            <h3 className="font-display text-xl leading-snug sm:text-2xl">{tr("reviewTitle")}</h3>
            <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-paper">
              {[
                [tr("stepVillage"), village?.name ?? "", 0],
                [t("centre"), village?.chcName ?? "", 0],
                [tr("stepAcres"), tc("acres", { acres }), 1],
                [tr("stepReady"), readyDate ? dates.full(readyDate) : "", 2],
                [tr("stepWait"), readyDate ? tb("waitValue", { count: waitDays, date: dates.short(addDays(readyDate, waitDays)) }) : "", 3],
              ].map(([label, value, target]) => (
                // Label over value, so a long answer ("6 days, until Sun, 8 Nov") gets the full width; edit at the row's end.
                <div key={String(label)} className="relative py-2.5 pl-4 pr-14 text-[0.9375rem] sm:text-base">
                  <dt className="text-sm text-ink-muted">{label}</dt>
                  <dd className="font-medium">
                    {value}
                    <button
                      type="button"
                      onClick={() => setStep(Number(target))}
                      className="absolute right-1.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control text-sky hover:bg-ink/5"
                    >
                      <Pencil aria-hidden className="size-4" strokeWidth={1.75} />
                      <span className="sr-only">{label}</span>
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
        ].map((panel, index) => (
          <StackPanel key={index} active={index === step} offset={index < step ? -16 : 16}>
            {panel}
          </StackPanel>
        ))}
      </div>

      {/* Below lg the phone's tab bar is at the foot of the screen: Back and Next ride just above it
          while the form is in view, so the next step is always one thumb away. */}
      <div className="sticky bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-10 -mx-4 mt-5 flex gap-3 rounded-b-card border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 sm:py-4 lg:static lg:mx-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
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
