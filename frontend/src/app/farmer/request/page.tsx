"use client";

/**
 * Request stepper: village, acres, harvest day, days I can wait. One question per step with large
 * targets for a phone in the field. On submit the engine plans immediately and the farmer sees
 * their token and date on the success screen.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { z } from "zod";
import { farmerFieldSchema, farmerHomeSchema, villageOptionSchema, type FarmerField } from "@/shared";
import { TokenCard } from "@/components/token-card";
import { TopBar } from "@/components/top-bar";
import { Button, ButtonLink, Skeleton, StateMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";

const STEPS = ["stepVillage", "stepAcres", "stepReady", "stepWait", "stepReview"] as const;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export default function FarmerRequestPage() {
  const t = useTranslations("request");
  const tc = useTranslations("common");
  const dates = useDates();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [villageId, setVillageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [acres, setAcres] = useState(3);
  const [readyDate, setReadyDate] = useState<string | null>(null);
  const [waitDays, setWaitDays] = useState(5);
  const [created, setCreated] = useState<FarmerField | null>(null);

  const villages = useQuery({ queryKey: ["villages"], queryFn: () => api("villages", z.array(villageOptionSchema)) });
  const home = useQuery({ queryKey: ["farmer-home"], queryFn: () => api("farmer/home", farmerHomeSchema) });
  const today = home.data?.today ?? null;
  const readyOptions = useMemo(() => (today ? Array.from({ length: 8 }, (_, index) => addDays(today, index)) : []), [today]);

  const submit = useMutation({
    mutationFn: () =>
      api("farmer/requests", farmerFieldSchema, {
        method: "POST",
        body: JSON.stringify({ villageId, acres, readyDate, waitingLimitDays: waitDays }),
      }),
    onSuccess: (field) => {
      setCreated(field);
      queryClient.invalidateQueries({ queryKey: ["farmer-home"] });
    },
  });

  const village = villages.data?.find((item) => item.id === villageId);
  const filteredVillages = (villages.data ?? []).filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const canContinue = [Boolean(villageId), acres > 0, Boolean(readyDate), waitDays >= 1, true][step];

  if (created && today) {
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-xl px-4 pb-16 pt-6 text-lg">
          <div className="mb-4 flex items-center gap-2 text-field">
            <Check aria-hidden className="size-6" strokeWidth={2} />
            <h1 className="font-display text-3xl text-ink">{t("successTitle")}</h1>
          </div>
          {!created.promise ? <p className="mb-4 text-ink-muted">{t("successNoDate")}</p> : null}
          <TokenCard field={created} today={today} />
          <ButtonLink href="/farmer" className="mt-5 min-h-12 w-full text-lg">
            {t("seeMyFields")}
          </ButtonLink>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-6 text-lg">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label={t("title")}>
          {STEPS.map((key, index) => (
            <li key={key} aria-current={index === step ? "step" : undefined}>
              <div className={`h-1.5 rounded-full ${index <= step ? "bg-wheat" : "bg-line"}`} />
              <span className={`mt-1 block text-xs ${index === step ? "font-medium text-ink" : "text-ink-muted"}`}>{t(key)}</span>
            </li>
          ))}
        </ol>

        <section className="mt-6 min-h-[22rem]">
          {step === 0 ? (
            <fieldset>
              <legend className="font-display text-2xl">{t("villageQuestion")}</legend>
              <label className="relative mt-4 block">
                <span className="sr-only">{t("villageSearch")}</span>
                <Search aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted" strokeWidth={1.75} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("villageSearch")}
                  className="min-h-12 w-full rounded-control border border-line-strong bg-surface pl-10 pr-3"
                />
              </label>
              {villages.isPending ? (
                <Skeleton className="mt-3 h-48" />
              ) : villages.isError ? (
                <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} />
              ) : (
                <div className="mt-3 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {filteredVillages.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={villageId === item.id}
                      onClick={() => setVillageId(item.id)}
                      className={`min-h-12 rounded-control border px-3 text-left ${
                        villageId === item.id ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink/50"
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          ) : step === 1 ? (
            <fieldset>
              <legend className="font-display text-2xl">{t("acresQuestion")}</legend>
              <div className="mt-6 flex items-center justify-center gap-6">
                <button type="button" aria-label={t("decrease")} onClick={() => setAcres((value) => Math.max(0.5, value - 0.5))} className="grid size-16 place-items-center rounded-full border border-line-strong bg-surface">
                  <Minus aria-hidden className="size-7" strokeWidth={1.75} />
                </button>
                <output className="min-w-28 text-center font-display text-6xl tabular" aria-live="polite">{acres}</output>
                <button type="button" aria-label={t("increase")} onClick={() => setAcres((value) => Math.min(50, value + 0.5))} className="grid size-16 place-items-center rounded-full border border-line-strong bg-surface">
                  <Plus aria-hidden className="size-7" strokeWidth={1.75} />
                </button>
              </div>
              <p className="mt-2 text-center text-ink-muted">{tc("acres", { acres })}</p>
              <p className="mt-6 text-base text-ink-muted">{t("acresHelp")}</p>
            </fieldset>
          ) : step === 2 ? (
            <fieldset>
              <legend className="font-display text-2xl">{t("readyQuestion")}</legend>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {readyOptions.map((iso, index) => (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={readyDate === iso}
                    onClick={() => setReadyDate(iso)}
                    className={`min-h-14 rounded-control border px-3 text-left ${readyDate === iso ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink/50"}`}
                  >
                    <span className="block text-sm opacity-80">{index === 0 ? t("today") : index === 1 ? t("tomorrow") : dates.weekday(iso)}</span>
                    <span className="block tabular">{dates.dayMonth(iso)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-base text-ink-muted">{t("readyHelp")}</p>
            </fieldset>
          ) : step === 3 ? (
            <fieldset>
              <legend className="font-display text-2xl">{t("waitQuestion")}</legend>
              <div className="mt-6 flex items-center justify-center gap-6">
                <button type="button" aria-label={t("decrease")} onClick={() => setWaitDays((value) => Math.max(1, value - 1))} className="grid size-16 place-items-center rounded-full border border-line-strong bg-surface">
                  <Minus aria-hidden className="size-7" strokeWidth={1.75} />
                </button>
                <output className="min-w-28 text-center font-display text-6xl tabular" aria-live="polite">{waitDays}</output>
                <button type="button" aria-label={t("increase")} onClick={() => setWaitDays((value) => Math.min(15, value + 1))} className="grid size-16 place-items-center rounded-full border border-line-strong bg-surface">
                  <Plus aria-hidden className="size-7" strokeWidth={1.75} />
                </button>
              </div>
              <p className="mt-2 text-center text-ink-muted">
                {tc("days", { count: waitDays })}
                {readyDate ? ` · ${t("waitUntil", { date: dates.full(addDays(readyDate, waitDays)) })}` : null}
              </p>
              <p className="mt-6 text-base text-ink-muted">{t("waitHelp")}</p>
            </fieldset>
          ) : (
            <div>
              <h2 className="font-display text-2xl">{t("reviewTitle")}</h2>
              <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
                {[
                  [t("stepVillage"), village?.name ?? ""],
                  [t("stepAcres"), tc("acres", { acres })],
                  [t("stepReady"), readyDate ? dates.full(readyDate) : ""],
                  [t("stepWait"), readyDate ? t("waitUntil", { date: dates.full(addDays(readyDate, waitDays)) }) : ""],
                ].map(([label, value], index) => (
                  <div key={label} className="flex items-center justify-between gap-3 px-4 py-3">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="flex items-center gap-3 text-right">
                      {value}
                      <button type="button" onClick={() => setStep(index)} className="text-sm text-sky underline underline-offset-2">
                        ✎<span className="sr-only">{label}</span>
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
              {submit.isError ? <p className="mt-3 text-ember-deep" role="alert">{t("failed")}</p> : null}
            </div>
          )}
        </section>

        <div className="mt-6 flex gap-3">
          {step > 0 ? (
            <Button variant="secondary" className="min-h-12 flex-1 text-lg" onClick={() => setStep((value) => value - 1)} disabled={submit.isPending}>
              <ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />
              {t("back")}
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button className="min-h-12 flex-[2] text-lg" disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>
              {t("next")}
              <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
            </Button>
          ) : (
            <Button variant="accent" className="min-h-12 flex-[2] text-lg" disabled={submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? t("submitting") : t("submit")}
            </Button>
          )}
        </div>
      </main>
    </>
  );
}
