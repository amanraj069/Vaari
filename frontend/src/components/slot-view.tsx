"use client";

/**
 * SlotView: what a farmer sees from their slot link, with no sign-in. One huge date, how many
 * fields are ahead, the four-step timeline, and the backend's one-sentence reason in plain words.
 * Until the operator publishes a plan the field is "Requested": no date, no guess.
 * Rule: only the PROMISE is ever shown as a date. The planned day (field.plannedDate) is never
 * shown, because the backend has not promised it. A window is called a window until it is firm.
 */
import { BellRing, CalendarCheck2, Hourglass, LinkIcon, RefreshCw, ShieldAlert, Sparkles, TriangleAlert, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { FarmerField } from "@/shared";
import { useDates } from "@/lib/dates";
import { Dialog } from "./dialog";
import { LockPin } from "./lock-pin";
import { SimulatedBadge } from "./simulated-badge";
import { Slider } from "./slider";
import { Timeline, type TimelineStep } from "./timeline";
import { Button, Pill, Skeleton, Spinner } from "./ui";
import { SeeAllMyFields } from "./whatsapp-link";

export type WhyState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; reasons: string[] } | { kind: "none" };

export type SlotState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "forbidden" }
  | { kind: "notFound" }
  | { kind: "unavailable"; onRetry: () => void }
  | {
      kind: "ready";
      field: FarmerField;
      today: string | null;
      why: WhyState;
      onCannotWait: (waitingLimitDays: number) => Promise<void>;
    };

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Booked -> Planned (a promise exists) -> On the way (firm and today) -> Done (sown). */
export function timelineStep(field: FarmerField, today: string | null): TimelineStep {
  if (field.state === "done") return "done";
  if (!field.promise) return "booked";
  if (field.promise.kind === "firm" && today !== null && field.promise.date === today) return "onTheWay";
  return "planned";
}

function Problem({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-xl rounded-card border border-line bg-surface p-6 text-center">
      <div aria-hidden className="mx-auto grid size-14 place-items-center rounded-full bg-wheat-soft text-wheat-deep">{icon}</div>
      <h1 className="mt-4 font-display text-2xl">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-ink-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function CannotWait({ field, onCannotWait }: { field: FarmerField; onCannotWait: (days: number) => Promise<void> }) {
  const t = useTranslations("slot");
  const tc = useTranslations("common");
  const dates = useDates();
  const shortest = 1;
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(Math.max(shortest, field.waitingLimitDays - 1));
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const canShorten = field.waitingLimitDays > shortest;

  async function confirm() {
    setState("saving");
    try {
      await onCannotWait(days);
      setState("idle");
      setOpen(false);
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <Button variant="secondary" className="min-h-12 w-full text-base" onClick={() => setOpen(true)}>
        <Hourglass aria-hidden className="size-5" strokeWidth={1.75} />
        {t("cannotWait")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("cannotWaitTitle")}
        description={t("cannotWaitBody")}
        closeLabel={tc("close")}
        footer={
          canShorten ? (
            <Button variant="accent" className="min-h-12" disabled={state === "saving"} onClick={confirm}>
              {state === "saving" ? <Spinner label={t("cannotWaitConfirm")} /> : t("cannotWaitConfirm")}
            </Button>
          ) : null
        }
      >
        {canShorten ? (
          <Slider
            label={t("cannotWaitSlider")}
            min={shortest}
            max={field.waitingLimitDays - 1}
            value={days}
            onChange={setDays}
            valueText={t("cannotWaitValue", { count: days, date: dates.short(addDays(field.readyDate, days)) })}
            minLabel={String(shortest)}
            maxLabel={String(field.waitingLimitDays - 1)}
          />
        ) : (
          <p>{t("cannotWaitShortest")}</p>
        )}
        {state === "failed" ? (
          <p role="alert" className="mt-3 text-ember-deep">
            {t("updateFailed")}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

export function SlotView({ state, whatsappNumber = null }: { state: SlotState; whatsappNumber?: string | null }) {
  const t = useTranslations("slot");
  const tf = useTranslations("farmer");
  const tc = useTranslations("common");
  const dates = useDates();

  if (state.kind === "loading") {
    return (
      <div className="mt-6 max-w-2xl space-y-4" aria-busy="true">
        <span className="sr-only" role="status">{t("loading")}</span>
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-56" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  // A link that was reissued or has expired: the farmer can ask Vaari on WhatsApp for their fields.
  if (state.kind === "invalid")
    return (
      <Problem
        icon={<LinkIcon className="size-7" strokeWidth={1.75} />}
        title={t("invalidTitle")}
        body={t("invalidBody")}
        action={whatsappNumber ? <SeeAllMyFields number={whatsappNumber} /> : undefined}
      />
    );
  if (state.kind === "forbidden") return <Problem icon={<ShieldAlert className="size-7" strokeWidth={1.75} />} title={t("forbiddenTitle")} body={t("forbiddenBody")} />;
  if (state.kind === "notFound") return <Problem icon={<LinkIcon className="size-7" strokeWidth={1.75} />} title={t("notFoundTitle")} body={t("notFoundBody")} />;
  if (state.kind === "unavailable") {
    return (
      <Problem
        icon={<RefreshCw className="size-7" strokeWidth={1.75} />}
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
        action={
          <Button className="min-h-12" onClick={state.onRetry}>
            {tc("retry")}
          </Button>
        }
      />
    );
  }

  const { field, today, why } = state;
  const promise = field.promise;
  const done = field.state === "done";
  const step = timelineStep(field, today);
  // The best date Vaari can promise still runs past the last day the farmer can wait (after "I
  // cannot wait longer" in a full season, for example). Say so first, plainly; never leave the
  // farmer to compare two dates themselves.
  const promiseLastDate = promise ? (promise.kind === "firm" ? promise.date : promise.endDate) : null;
  const late = !done && promiseLastDate !== null && promiseLastDate > field.burnDeadlineDate;
  const requested = !done && field.status === "requested" && field.reason.code === "requested";
  const pill = done ? (
    <Pill kind="done" size="lg">{t("doneTitle")}</Pill>
  ) : promise?.kind === "firm" ? (
    <Pill kind="firm" size="lg">{tf("firm")}</Pill>
  ) : promise?.kind === "window" ? (
    <Pill kind="window" size="lg">{tf("window")}</Pill>
  ) : requested ? (
    <Pill kind="requested" size="lg">{t("requestedPill")}</Pill>
  ) : (
    <Pill kind="unplanned" size="lg">{t("noDateTitle")}</Pill>
  );

  return (
    // Wide screens: the token on the left, what you can do about it on the right. Phones: one column.
    <article className="mt-5 grid items-start gap-4 text-lg lg:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-12">
      <div className="min-w-0">
        <h1 className="sr-only">{t("title")}</h1>
        {field.notice?.kind === "broken" ? (
          <p className="mb-4 flex items-start gap-2 rounded-card border border-ember/30 bg-ember-soft/60 p-4 text-base text-ember-deep">
            <BellRing aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
            {tf("brokenNotice")}
          </p>
        ) : null}
        {/* A pending "I cannot wait longer" comes first: until the operator plans it, "no machine can
            reach you" would not be true yet. */}
        {field.soonerRequested && !done ? (
          <div className="mb-4 flex items-start gap-3 rounded-card border border-wheat-deep/30 bg-wheat-soft/60 p-4">
            <Hourglass aria-hidden className="mt-0.5 size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
            <div>
              <p className="font-medium">{t("soonerTitle")}</p>
              <p className="mt-1 text-base">{t("soonerBody", { date: dates.full(field.burnDeadlineDate) })}</p>
            </div>
          </div>
        ) : late ? (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-card border border-ember/40 bg-ember-soft/60 p-4 text-ember-deep">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
            <div>
              <p className="font-medium">{t("lateTitle", { date: dates.full(field.burnDeadlineDate) })}</p>
              <p className="mt-1 text-base">{t("lateBody")}</p>
            </div>
          </div>
        ) : field.notice?.kind === "firmed" ? (
          <p className="mb-4 flex items-start gap-2 rounded-card border border-field/30 bg-field-soft/60 p-4 text-base text-field">
            <BellRing aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
            {tf("firmedNotice")}
          </p>
        ) : null}

        <section className="rounded-card border border-line bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow text-xs font-medium text-ink-muted">{tf("token")}</p>
              <p className="font-display text-4xl leading-none tabular">#{String(field.token).padStart(3, "0")}</p>
            </div>
            {pill}
          </div>
          <p className="mt-2 text-base text-ink-muted">{tf("acresInVillage", { acres: tc("acres", { acres: field.acres }), village: field.villageName })}</p>

          <div className="my-5 border-t border-dashed border-line-strong" />

          <div aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={done ? "done" : promise ? JSON.stringify(promise) : "none"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                {done ? (
                  <>
                    <p className="font-display text-4xl">{t("doneTitle")}</p>
                    <p className="mt-1 text-base text-ink-muted">{t("doneBody")}</p>
                  </>
                ) : promise?.kind === "firm" ? (
                  <>
                    <p className="flex items-center gap-2 text-base text-ink-muted">
                      <CalendarCheck2 aria-hidden className="size-5" strokeWidth={1.75} />
                      {tf("machineComes")}
                    </p>
                    <p className="mt-1 font-display text-3xl leading-tight">{dates.weekday(promise.date)}</p>
                    <p className="font-display text-6xl leading-none tracking-tight">{dates.dayMonth(promise.date)}</p>
                    <div className="mt-3">
                      <LockPin label={tf("firm")} />
                    </div>
                  </>
                ) : promise?.kind === "window" ? (
                  <>
                    <p className="flex items-center gap-2 text-base text-ink-muted">
                      <CalendarCheck2 aria-hidden className="size-5" strokeWidth={1.75} />
                      {tf("machineBetween")}
                    </p>
                    <p className="mt-1 font-display text-5xl leading-tight tracking-tight">{dates.range(promise.startDate, promise.endDate)}</p>
                    <p className="mt-2 text-base text-ink-muted">{tf("windowBody")}</p>
                  </>
                ) : (
                  <p className="font-display text-4xl">{requested ? t("requestedTitle") : t("noDateTitle")}</p>
                )}
              </motion.div>
            </AnimatePresence>
            {/* Where this turn stands, in one plain sentence from the backend (stored facts only). */}
            <p className="mt-3 text-base">{field.reason.text}</p>
          </div>

          {promise && !done && field.fieldsAhead !== null ? (
            <p className="mt-5 flex items-center gap-2">
              <Users aria-hidden className="size-5 text-ink-muted" strokeWidth={1.75} />
              {tf("fieldsAhead", { count: field.fieldsAhead })}
            </p>
          ) : null}

          <div className="mt-6">
            <Timeline current={step} />
          </div>
        </section>
      </div>

      <div className="min-w-0 space-y-4">
        <p className={`flex items-center gap-2 text-base ${late ? "text-ember-deep" : "text-ink-muted"}`}>
          <Hourglass aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {t("canWaitUntil", { date: dates.full(field.burnDeadlineDate) })}
        </p>

        {!done && why.kind !== "none" ? (
          <section aria-labelledby="slot-why" className="rounded-card border border-line bg-surface p-5">
            <h2 id="slot-why" className="flex items-center gap-2 font-medium">
              <Sparkles aria-hidden className="size-5 text-wheat-deep" strokeWidth={1.75} />
              {t("reasonTitle")}
            </h2>
            {why.kind === "loading" ? (
              <div className="mt-3">
                <Spinner label={t("reasonLoading")} />
              </div>
            ) : why.kind === "error" ? (
              <p className="mt-3 text-base text-ink-muted">{t("reasonUnavailable")}</p>
            ) : why.kind === "ready" ? (
              <ul className="mt-3 space-y-2">
                {why.reasons.map((reason, index) => (
                  <li key={index} className="flex gap-2 text-base">
                    <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-wheat-deep" />
                    {reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {!done ? (
          <div>
            <CannotWait field={field} onCannotWait={state.onCannotWait} />
          </div>
        ) : null}

        {whatsappNumber ? <SeeAllMyFields number={whatsappNumber} /> : null}

        <div className="flex justify-center pt-2 lg:justify-start">
          <SimulatedBadge />
      </div>
      </div>
    </article>
  );
}
