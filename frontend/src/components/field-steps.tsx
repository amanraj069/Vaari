"use client";

/**
 * The four questions about a field, shared by the helper's booking (BookForm) and the farmer's own
 * (FarmerTicketForm): which village, how many acres, when the paddy is harvested, and how many days
 * after harvest the farmer can wait. One question per step, large targets, keyboard and screen
 * reader friendly. The forms own the state; these only draw a step.
 */
import { Minus, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { VillageOption } from "@/shared";
import { useDates } from "@/lib/dates";
import { Slider } from "./slider";
import { Skeleton } from "./ui";

export const WAIT_MIN = 3;
export const WAIT_MAX = 10;
const READY_CHOICES = 8;

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The harvest days on offer: today and the next seven. */
export function readyChoices(today: string | null): string[] {
  return today ? Array.from({ length: READY_CHOICES }, (_, index) => addDays(today, index)) : [];
}

export function VillageStep({
  villages,
  villageId,
  onPick,
  search,
  onSearch,
}: {
  villages: VillageOption[] | null;
  villageId: string | null;
  onPick: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  const tr = useTranslations("request");
  const filtered = (villages ?? []).filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <fieldset>
      <legend className="font-display text-xl leading-snug sm:text-2xl">{tr("villageQuestion")}</legend>
      <label className="relative mt-3 block">
        <span className="sr-only">{tr("villageSearch")}</span>
        <Search aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted" strokeWidth={1.75} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={tr("villageSearch")} className="min-h-12 w-full rounded-control border border-line-strong bg-paper pl-10 pr-3" />
      </label>
      {villages === null ? (
        <Skeleton className="mt-3 h-[17.5rem]" />
      ) : (
        // A fixed-height box (about four rows): a long list scrolls inside it, and a search that leaves
        // two villages, or none, never changes the size of the form around it.
        <div className="mt-3 grid h-[17.5rem] grid-cols-2 content-start gap-2 overflow-y-auto overscroll-contain pr-1">
          {filtered.length === 0 ? <p className="col-span-2 px-1 pt-2 text-sm text-ink-muted sm:text-base">{tr("villageNone")}</p> : null}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={villageId === item.id}
              onClick={() => onPick(item.id)}
              className={`flex min-h-14 items-center rounded-control border px-3 py-2 text-left text-base leading-snug break-words ${villageId === item.id ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:border-ink/50"}`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function AcresStep({ acres, onChange }: { acres: number; onChange: (update: (value: number) => number) => void }) {
  const tr = useTranslations("request");
  const tc = useTranslations("common");
  return (
    <fieldset>
      <legend className="font-display text-xl leading-snug sm:text-2xl">{tr("acresQuestion")}</legend>
      <div className="mt-6 flex items-center justify-center gap-4 sm:gap-6">
        <button type="button" aria-label={tr("decrease")} onClick={() => onChange((value) => Math.max(0.5, value - 0.5))} className="grid size-14 place-items-center rounded-full border border-line-strong bg-paper">
          <Minus aria-hidden className="size-6" strokeWidth={1.75} />
        </button>
        <output aria-live="polite" className="min-w-24 text-center font-display text-6xl tabular">{acres}</output>
        <button type="button" aria-label={tr("increase")} onClick={() => onChange((value) => Math.min(50, value + 0.5))} className="grid size-14 place-items-center rounded-full border border-line-strong bg-paper">
          <Plus aria-hidden className="size-6" strokeWidth={1.75} />
        </button>
      </div>
      <p className="mt-2 text-center text-sm sm:text-base text-ink-muted">{tc("acres", { acres })}</p>
      <p className="mt-4 text-sm sm:text-base text-ink-muted">{tr("acresHelp")}</p>
    </fieldset>
  );
}

export function ReadyStep({ options, readyDate, onPick }: { options: string[]; readyDate: string | null; onPick: (iso: string) => void }) {
  const tr = useTranslations("request");
  const dates = useDates();
  return (
    <fieldset>
      <legend className="font-display text-xl leading-snug sm:text-2xl">{tr("readyQuestion")}</legend>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map((iso, index) => (
          <button
            key={iso}
            type="button"
            aria-pressed={readyDate === iso}
            onClick={() => onPick(iso)}
            className={`min-h-14 rounded-control border px-3 py-2 text-left text-base ${readyDate === iso ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:border-ink/50"}`}
          >
            <span className="block text-sm opacity-80">{index === 0 ? tr("today") : index === 1 ? tr("tomorrow") : dates.weekday(iso)}</span>
            <span className="block tabular">{dates.dayMonth(iso)}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm sm:text-base text-ink-muted">{tr("readyHelp")}</p>
    </fieldset>
  );
}

export function WaitStep({ question, help, waitDays, onChange, readyDate }: { question: string; help: string; waitDays: number; onChange: (days: number) => void; readyDate: string | null }) {
  const t = useTranslations("book");
  const dates = useDates();
  return (
    <div>
      <p className="font-display text-xl leading-snug sm:text-2xl">{question}</p>
      <div className="mt-4">
        <Slider
          label={t("stepWait")}
          min={WAIT_MIN}
          max={WAIT_MAX}
          value={waitDays}
          onChange={onChange}
          valueText={t("waitValue", { count: waitDays, date: readyDate ? dates.short(addDays(readyDate, waitDays)) : "" })}
          minLabel={t("waitMin")}
          maxLabel={t("waitMax")}
        />
      </div>
      <p className="mt-3 text-sm sm:text-base text-ink-muted">{help}</p>
    </div>
  );
}
