"use client";

/**
 * /design (hidden): every design-system component and every page state, in English, Punjabi and
 * Hindi side by side, so translations and layouts can be checked at a glance. Sample data only.
 */
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { useState } from "react";
import en from "../../../messages/en.json";
import hi from "../../../messages/hi.json";
import pa from "../../../messages/pa.json";
import { BookForm } from "@/components/book-form";
import { BookedList, StatusBadges } from "@/components/booked-list";
import { Dialog } from "@/components/dialog";
import { LockPin } from "@/components/lock-pin";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Slider } from "@/components/slider";
import { SlotView, type SlotState } from "@/components/slot-view";
import { StepProgress } from "@/components/step-progress";
import { Timeline, TIMELINE_STEPS } from "@/components/timeline";
import { useToast } from "@/components/toast";
import { TopBar } from "@/components/top-bar";
import { Button, Card, Pill, Skeleton, StateMessage, type PillKind } from "@/components/ui";
import { SAMPLE_BOOKED, SAMPLE_TODAY, useSamples } from "@/lib/samples";

const LOCALES = [
  { code: "en", label: "English", messages: en },
  { code: "pa", label: "ਪੰਜਾਬੀ", messages: pa },
  { code: "hi", label: "हिन्दी", messages: hi },
] as const;
const PILLS: PillKind[] = ["firm", "window", "requested", "safe", "tight", "at_risk", "unplanned", "draft", "approved", "done"];
const noop = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="eyebrow text-xs font-medium text-ink-muted">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Specimen() {
  const t = useTranslations("design");
  const tc = useTranslations("common");
  const tf = useTranslations("farmer");
  const tr = useTranslations("risk");
  const to = useTranslations("operator");
  const ts = useTranslations("slot");
  const pillLabel = (kind: PillKind): string =>
    kind === "firm" ? tf("firm")
    : kind === "window" ? tf("window")
    : kind === "requested" ? ts("requestedPill")
    : kind === "draft" ? to("draft")
    : kind === "approved" ? to("approved")
    : kind === "done" ? ts("doneTitle")
    : tr(kind);
  const toast = useToast();
  // Sample sentences in the reader's language (messages, namespace "design").
  const { fields: SAMPLE_FIELDS, reasons: SAMPLE_REASONS } = useSamples();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slider, setSlider] = useState(6);
  const slotStates: [string, SlotState][] = [
    ["loading", { kind: "loading" }],
    ["firm", { kind: "ready", field: SAMPLE_FIELDS.firm, today: SAMPLE_TODAY, why: { kind: "ready", reasons: SAMPLE_REASONS }, onCannotWait: noop }],
    ["window", { kind: "ready", field: SAMPLE_FIELDS.window, today: SAMPLE_TODAY, why: { kind: "loading" }, onCannotWait: noop }],
    ["no promise", { kind: "ready", field: SAMPLE_FIELDS.noPromise, today: SAMPLE_TODAY, why: { kind: "error" }, onCannotWait: noop }],
    ["moved (broken promise)", { kind: "ready", field: SAMPLE_FIELDS.broken, today: SAMPLE_TODAY, why: { kind: "ready", reasons: SAMPLE_REASONS }, onCannotWait: noop }],
    ["on the way", { kind: "ready", field: SAMPLE_FIELDS.onTheWay, today: SAMPLE_TODAY, why: { kind: "ready", reasons: SAMPLE_REASONS }, onCannotWait: noop }],
    ["done", { kind: "ready", field: SAMPLE_FIELDS.done, today: SAMPLE_TODAY, why: { kind: "loading" }, onCannotWait: noop }],
    ["tampered link (401)", { kind: "invalid" }],
    ["someone else's field (403)", { kind: "forbidden" }],
    ["field removed (404)", { kind: "notFound" }],
    ["API unavailable", { kind: "unavailable", onRetry: () => undefined }],
  ];
  return (
    <div>
      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>{tc("retry")}</Button>
          <Button variant="accent">{tf("addField")}</Button>
          <Button variant="secondary">{tc("back")}</Button>
          <Button variant="quiet">{tc("close")}</Button>
          <Button disabled>{tc("loading")}</Button>
        </div>
      </Section>
      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          {PILLS.map((kind) => (
            <Pill key={kind} kind={kind}>{pillLabel(kind)}</Pill>
          ))}
          <LockPin label={tf("firm")} />
          <SimulatedBadge />
        </div>
        {SAMPLE_BOOKED.map((item) => (
          <StatusBadges key={item.fieldId} item={item} />
        ))}
      </Section>
      <Section title="Timeline">
        {TIMELINE_STEPS.map((step) => (
          <Card key={step} className="p-4">
            <Timeline current={step} />
          </Card>
        ))}
      </Section>
      <Section title="Feedback">
        <Skeleton className="h-10" />
        <StateMessage title={tf("emptyTitle")} body={tf("emptyBody")} />
        <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>{t("openDialog")}</Button>
          <Button variant="secondary" onClick={() => toast(t("toastExample"))}>{t("showToast")}</Button>
        </div>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={tf("why")} description={SAMPLE_REASONS[0]} closeLabel={tc("close")} footer={<Button onClick={() => setDialogOpen(false)}>{tc("close")}</Button>} />
      </Section>
      <Section title="Form controls">
        <StepProgress steps={["1", "2", "3", "4"]} current={1} label="Steps" />
        <Slider label={tf("waitUntil")} min={3} max={10} value={slider} onChange={setSlider} valueText={tc("days", { count: slider })} minLabel="3" maxLabel="10" />
      </Section>
      <Section title="/slot/[token] states">
        {slotStates.map(([label, state]) => (
          <div key={label} className="rounded-card border border-dashed border-line-strong p-3">
            <p className="text-xs text-ink-muted">{label}</p>
            <SlotView state={state} />
          </div>
        ))}
      </Section>
      <Section title="/book">
        <BookForm villages={[{ id: "v1", name: "Balian", namePa: null }, { id: "v2", name: "Akoi", namePa: null }]} today={SAMPLE_TODAY} onSubmit={async () => ({ field: SAMPLE_FIELDS.firm, slot: { token: "sample", path: "/slot/sample" } })} origin="https://vaari.example" />
        <BookedList state={{ kind: "ready", items: SAMPLE_BOOKED }} onCopyLink={() => undefined} />
        <BookedList state={{ kind: "ready", items: [] }} onCopyLink={() => undefined} />
        <BookedList state={{ kind: "loading" }} onCopyLink={() => undefined} />
        <BookedList state={{ kind: "error", onRetry: () => undefined }} onCopyLink={() => undefined} />
      </Section>
    </div>
  );
}

export default function DesignPage() {
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-[96rem] px-4 pb-24 pt-8 sm:px-6">
        <h1 className="font-display text-4xl">Vaari design system</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{en.design.note}</p>
        <div className="mt-6 grid gap-8 xl:grid-cols-3">
          {LOCALES.map((locale) => (
            <div key={locale.code} lang={locale.code} className="min-w-0">
              <h2 className="sticky top-0 z-10 bg-paper/95 py-2 font-display text-2xl">{locale.label}</h2>
              <NextIntlClientProvider locale={locale.code} messages={locale.messages} timeZone="Asia/Kolkata">
                <Specimen />
              </NextIntlClientProvider>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
