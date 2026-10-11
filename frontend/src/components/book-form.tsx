"use client";

/**
 * BookForm: a facilitator books a field for a farmer in seven short steps (farmer, phone and
 * consent, village, acres, harvest-ready day, waiting limit 3-10 days, check), then gets the
 * farmer's slot link to copy or share. The phone is the farmer's identity (they have no account);
 * it is checked here and again by the API, which stores it as E.164 with the consent. One question
 * per step, large targets, works with keyboard and screen readers.
 */
import { ArrowLeft, ArrowRight, Check, Copy, Plus, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { type Booking, type BookingInput, type VillageOption } from "@/shared";
import { copyText } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { isMobile, mobileDigits, spacedMobile } from "./farmer-signin-form";
import { AcresStep, ReadyStep, VillageStep, WaitStep, addDays, readyChoices } from "./field-steps";
import { StackPanel } from "./stack-panel";
import { StepProgress } from "./step-progress";
import { useToast } from "./toast";
import { Button } from "./ui";

type Props = {
  villages: VillageOption[] | null;
  today: string | null;
  onSubmit: (input: BookingInput) => Promise<Booking>;
  /** Base for the shareable link; defaults to this site's origin. */
  origin?: string;
};

export function BookForm({ villages, today, onSubmit, origin }: Props) {
  const t = useTranslations("book");
  const tr = useTranslations("request");
  const tc = useTranslations("common");
  const dates = useDates();
  const toast = useToast();
  const steps = [t("stepFarmer"), t("stepPhone"), t("stepVillage"), t("stepAcres"), t("stepReady"), t("stepWait"), t("stepCheck")];
  const [step, setStep] = useState(0);
  const [farmerName, setFarmerName] = useState("");
  // The ten digits after +91 (the prefix is fixed, as on the farmer's own sign-in).
  const [phoneDigits, setPhoneDigits] = useState("");
  const [consent, setConsent] = useState(false);
  const [villageId, setVillageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [acres, setAcres] = useState(3);
  const [readyDate, setReadyDate] = useState<string | null>(null);
  const [waitDays, setWaitDays] = useState(6);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const [booking, setBooking] = useState<Booking | null>(null);

  const readyOptions = useMemo(() => readyChoices(today), [today]);
  const village = villages?.find((item) => item.id === villageId);
  const phoneE164 = isMobile(phoneDigits) ? `+91${phoneDigits}` : null;
  // Say the number is wrong only once all ten digits are in, never while it is being typed.
  const phoneInvalid = phoneDigits.length === 10 && phoneE164 === null;
  const canContinue = [farmerName.trim().length > 0, phoneE164 !== null && consent, Boolean(villageId), acres > 0, Boolean(readyDate), true, true][step];
  const link = booking ? `${origin ?? (typeof window !== "undefined" ? window.location.origin : "")}${booking.slot.path}` : "";

  async function submit() {
    if (!villageId || !readyDate || !phoneE164 || !consent) return;
    setState("saving");
    try {
      setBooking(await onSubmit({ farmerName: farmerName.trim(), farmerPhone: phoneE164, consent, villageId, acres, readyDate, waitingLimitDays: waitDays }));
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  function reset() {
    setBooking(null);
    setStep(0);
    setFarmerName("");
    setPhoneDigits("");
    setConsent(false);
    setVillageId(null);
    setSearch("");
    setAcres(3);
    setReadyDate(null);
    setWaitDays(6);
  }

  if (booking) {
    return (
      <section aria-labelledby="book-success" className="rounded-card border border-field/30 bg-field-soft/50 p-6">
        <h2 id="book-success" className="flex items-center gap-2 font-display text-2xl">
          <Check aria-hidden className="size-6 text-field" strokeWidth={2} />
          {t("successTitle", { name: booking.field.farmerName })}
        </h2>
        <p className="mt-2 text-ink-muted">{t("successBody")}</p>
        <label className="mt-4 block">
          <span className="sr-only">{t("copy")}</span>
          <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} className="min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-sm shadow-control" />
        </label>
        {/* Copy and Share hand over this link; the next booking is a separate step, on the right
            (below them on phones). */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <Button
              variant="accent"
              className="min-h-12 flex-1 sm:flex-none"
              onClick={async () => {
                await copyText(link);
                toast(t("copied"));
              }}
            >
              <Copy aria-hidden className="size-5" strokeWidth={1.75} />
              {t("copy")}
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <Button variant="secondary" className="min-h-12 flex-1 sm:flex-none" onClick={() => navigator.share({ title: "Vaari", text: t("shareText"), url: link }).catch(() => undefined)}>
                <Share2 aria-hidden className="size-5" strokeWidth={1.75} />
                {t("share")}
              </Button>
            ) : null}
          </div>
          <Button variant="secondary" className="min-h-12 sm:ml-auto" onClick={reset}>
            <Plus aria-hidden className="size-5" strokeWidth={1.75} />
            {t("another")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="book-title" className="rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 id="book-title" className="font-display text-2xl">{t("title")}</h2>
      <p className="mt-1 text-ink-muted">{t("subtitle")}</p>
      <div className="mt-5">
        <StepProgress steps={steps} current={step} label={t("progress")} />
      </div>

      {/* Every step stays in one grid cell (StackPanel): the box is as tall as its tallest step and
          keeps that size through every step, so Back and Next never move. */}
      <div className="mt-6 grid text-lg">
        {[
          <label className="block">
            <span className="font-display text-2xl">{t("farmerQuestion")}</span>
            <input
              value={farmerName}
              onChange={(event) => setFarmerName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              className="mt-3 min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 shadow-control"
            />
            <span className="mt-2 block text-base text-ink-muted">{t("farmerHelp")}</span>
          </label>,
          <div className="space-y-5">
            <label className="block">
              <span className="font-display text-2xl">{t("phoneQuestion", { name: farmerName.trim() })}</span>
              {/* +91 is fixed and shown before the box; pasting a number with +91 or 0 keeps its ten digits. */}
              <span className="mt-3 flex min-h-12 overflow-hidden rounded-control border border-line-strong bg-raised shadow-control focus-within:ring-2 focus-within:ring-ink">
                <span aria-hidden className="flex items-center border-r border-line px-3 font-medium tabular text-ink-muted">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phoneDigits}
                  onChange={(event) => setPhoneDigits(mobileDigits(event.target.value))}
                  autoComplete="off"
                  placeholder="98765 43210"
                  aria-invalid={phoneInvalid}
                  aria-describedby="book-phone-help"
                  className="min-w-0 flex-1 bg-transparent px-3 tabular outline-none placeholder:text-ink-muted/60"
                />
              </span>
              <span id="book-phone-help" className={`mt-2 block text-base ${phoneInvalid ? "text-ember-deep" : "text-ink-muted"}`}>
                {phoneInvalid ? t("phoneInvalid") : t("phoneHelp")}
              </span>
            </label>
            {/* The whole row is the target (at least 48px); the native checkbox stays for keyboards and screen readers. */}
            <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-line bg-paper p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="peer sr-only" />
              <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 border-ink-muted peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper">
                {consent ? <Check className="size-4" strokeWidth={3} /> : null}
              </span>
              <span className="text-base">{t("consentLabel", { name: farmerName.trim() })}</span>
            </label>
            {!consent && phoneE164 ? <p className="text-sm text-ink-muted">{t("consentRequired")}</p> : null}
          </div>,
          <VillageStep villages={villages} villageId={villageId} onPick={setVillageId} search={search} onSearch={setSearch} />,
          <AcresStep acres={acres} onChange={setAcres} />,
          <ReadyStep options={readyOptions} readyDate={readyDate} onPick={setReadyDate} />,
          <WaitStep question={t("waitQuestion")} help={t("waitHelp")} waitDays={waitDays} onChange={setWaitDays} readyDate={readyDate} />,
          <div>
            <h3 className="font-display text-2xl">{t("reviewTitle")}</h3>
            <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-paper">
              {[
                [t("stepFarmer"), farmerName.trim()],
                [t("stepPhone"), phoneE164 ? spacedMobile(phoneDigits) : ""],
                [t("stepVillage"), village?.name ?? ""],
                [t("stepAcres"), tc("acres", { acres })],
                [t("stepReady"), readyDate ? dates.full(readyDate) : ""],
                [t("stepWait"), readyDate ? t("waitValue", { count: waitDays, date: dates.short(addDays(readyDate, waitDays)) }) : ""],
              ].map(([label, value], index) => (
                <div key={label} className="flex items-center justify-between gap-3 px-4 py-3 text-base">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="flex items-center gap-2 text-right">
                    {value}
                    <button type="button" onClick={() => setStep(index)} className="grid size-11 place-items-center rounded-control text-sky hover:bg-ink/5">
                      ✎<span className="sr-only">{label}</span>
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            {state === "failed" ? (
              <p role="alert" className="mt-3 text-ember-deep">
                {t("failed")}
              </p>
            ) : null}
          </div>
        ].map((panel, index) => (
          <StackPanel key={index} active={index === step} offset={index < step ? -16 : 16}>
            {panel}
          </StackPanel>
        ))}
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
