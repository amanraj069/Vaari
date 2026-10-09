"use client";

/**
 * BookForm: a facilitator books a field for a farmer in seven short steps (farmer, phone and
 * consent, village, acres, harvest-ready day, waiting limit 3-10 days, check), then gets the
 * farmer's slot link to copy or share. The phone is the farmer's identity (they have no account);
 * it is checked here and again by the API, which stores it as E.164 with the consent. One question
 * per step, large targets, works with keyboard and screen readers.
 */
import { ArrowLeft, ArrowRight, Check, Copy, Minus, Plus, Search, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toE164, type Booking, type BookingInput, type VillageOption } from "@/shared";
import { copyText } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { Slider } from "./slider";
import { StepProgress } from "./step-progress";
import { useToast } from "./toast";
import { Button, Skeleton } from "./ui";

const WAIT_MIN = 3;
const WAIT_MAX = 10;
const READY_CHOICES = 8;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

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
  const [farmerPhone, setFarmerPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [villageId, setVillageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [acres, setAcres] = useState(3);
  const [readyDate, setReadyDate] = useState<string | null>(null);
  const [waitDays, setWaitDays] = useState(6);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const [booking, setBooking] = useState<Booking | null>(null);

  const readyOptions = useMemo(() => (today ? Array.from({ length: READY_CHOICES }, (_, index) => addDays(today, index)) : []), [today]);
  const village = villages?.find((item) => item.id === villageId);
  const filtered = (villages ?? []).filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const phoneE164 = toE164(farmerPhone);
  // Say the number is wrong only once something has been typed.
  const phoneInvalid = farmerPhone.trim().length > 0 && phoneE164 === null;
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
    setFarmerPhone("");
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
          <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} className="min-h-12 w-full rounded-control border border-line-strong bg-surface px-3 text-sm" />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="accent"
            className="min-h-12"
            onClick={async () => {
              await copyText(link);
              toast(t("copied"));
            }}
          >
            <Copy aria-hidden className="size-5" strokeWidth={1.75} />
            {t("copy")}
          </Button>
          {typeof navigator !== "undefined" && "share" in navigator ? (
            <Button variant="secondary" className="min-h-12" onClick={() => navigator.share({ title: "Vaari", text: t("shareText"), url: link }).catch(() => undefined)}>
              <Share2 aria-hidden className="size-5" strokeWidth={1.75} />
              {t("share")}
            </Button>
          ) : null}
          <Button variant="quiet" className="min-h-12" onClick={reset}>
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

      <div className="mt-6 text-lg">
        {step === 0 ? (
          <label className="block">
            <span className="font-display text-2xl">{t("farmerQuestion")}</span>
            <input
              value={farmerName}
              onChange={(event) => setFarmerName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              className="mt-3 min-h-12 w-full rounded-control border border-line-strong bg-paper px-3"
            />
            <span className="mt-2 block text-base text-ink-muted">{t("farmerHelp")}</span>
          </label>
        ) : step === 1 ? (
          <div className="space-y-5">
            <label className="block">
              <span className="font-display text-2xl">{t("phoneQuestion", { name: farmerName.trim() })}</span>
              <input
                type="tel"
                inputMode="tel"
                value={farmerPhone}
                onChange={(event) => setFarmerPhone(event.target.value)}
                maxLength={32}
                autoComplete="off"
                aria-invalid={phoneInvalid}
                aria-describedby="book-phone-help"
                className="mt-3 min-h-12 w-full rounded-control border border-line-strong bg-paper px-3 tabular"
              />
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
          </div>
        ) : step === 2 ? (
          <fieldset>
            <legend className="font-display text-2xl">{tr("villageQuestion")}</legend>
            <label className="relative mt-3 block">
              <span className="sr-only">{tr("villageSearch")}</span>
              <Search aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted" strokeWidth={1.75} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr("villageSearch")} className="min-h-12 w-full rounded-control border border-line-strong bg-paper pl-10 pr-3" />
            </label>
            {villages === null ? (
              <Skeleton className="mt-3 h-40" />
            ) : (
              <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={villageId === item.id}
                    onClick={() => setVillageId(item.id)}
                    className={`min-h-12 rounded-control border px-3 text-left ${villageId === item.id ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:border-ink/50"}`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        ) : step === 3 ? (
          <fieldset>
            <legend className="font-display text-2xl">{tr("acresQuestion")}</legend>
            <div className="mt-6 flex items-center justify-center gap-6">
              <button type="button" aria-label={tr("decrease")} onClick={() => setAcres((value) => Math.max(0.5, value - 0.5))} className="grid size-14 place-items-center rounded-full border border-line-strong bg-paper">
                <Minus aria-hidden className="size-6" strokeWidth={1.75} />
              </button>
              <output aria-live="polite" className="min-w-24 text-center font-display text-6xl tabular">{acres}</output>
              <button type="button" aria-label={tr("increase")} onClick={() => setAcres((value) => Math.min(50, value + 0.5))} className="grid size-14 place-items-center rounded-full border border-line-strong bg-paper">
                <Plus aria-hidden className="size-6" strokeWidth={1.75} />
              </button>
            </div>
            <p className="mt-2 text-center text-ink-muted">{tc("acres", { acres })}</p>
            <p className="mt-4 text-base text-ink-muted">{tr("acresHelp")}</p>
          </fieldset>
        ) : step === 4 ? (
          <fieldset>
            <legend className="font-display text-2xl">{tr("readyQuestion")}</legend>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {readyOptions.map((iso, index) => (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={readyDate === iso}
                  onClick={() => setReadyDate(iso)}
                  className={`min-h-14 rounded-control border px-3 text-left ${readyDate === iso ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:border-ink/50"}`}
                >
                  <span className="block text-sm opacity-80">{index === 0 ? tr("today") : index === 1 ? tr("tomorrow") : dates.weekday(iso)}</span>
                  <span className="block tabular">{dates.dayMonth(iso)}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-base text-ink-muted">{tr("readyHelp")}</p>
          </fieldset>
        ) : step === 5 ? (
          <div>
            <p className="font-display text-2xl">{t("waitQuestion")}</p>
            <div className="mt-4">
              <Slider
                label={t("stepWait")}
                min={WAIT_MIN}
                max={WAIT_MAX}
                value={waitDays}
                onChange={setWaitDays}
                valueText={t("waitValue", { count: waitDays, date: readyDate ? dates.short(addDays(readyDate, waitDays)) : "" })}
                minLabel={t("waitMin")}
                maxLabel={t("waitMax")}
              />
            </div>
            <p className="mt-3 text-base text-ink-muted">{t("waitHelp")}</p>
          </div>
        ) : (
          <div>
            <h3 className="font-display text-2xl">{t("reviewTitle")}</h3>
            <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-paper">
              {[
                [t("stepFarmer"), farmerName.trim()],
                [t("stepPhone"), phoneE164 ?? ""],
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
