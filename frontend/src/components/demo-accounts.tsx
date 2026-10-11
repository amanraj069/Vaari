"use client";

/**
 * The demo people (farmer, helper, operator, officer), one card each with a "Demo" tag and a "Use
 * this account" button that signs in as them. Listed at the bottom of /signin
 * (SignInChooser); on wide screens the four share the column's leftover height
 * evenly, so the list ends level with the photo.
 */
import { ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDemoSignIn, type DemoRole } from "./demo-buttons";

export type DemoPerson = { role: DemoRole; name: string; detail: string };

function DemoCard({ person }: { person: DemoPerson }) {
  const t = useTranslations("signin");
  const { state, go } = useDemoSignIn(person.role);
  return (
    <li className="card-lift flex items-center rounded-control border border-line bg-surface px-3.5 py-3 sm:px-4 lg:flex-1 lg:py-2.5">
      <div className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium leading-tight">{person.name}</span>
            <span className="rounded-full border border-wheat-deep/30 bg-wheat-soft/60 px-2 py-px text-xs font-medium text-wheat-deep">{t("demoTag")}</span>
          </span>
          <span className="mt-0.5 block text-[0.8125rem] text-ink-muted sm:text-sm">{person.detail}</span>
          {state === "failed" || state === "off" ? (
            <span role="alert" className="mt-1 block text-sm text-ember-deep">
              {state === "off" ? t("demoOff") : t("failed")}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={go}
          disabled={state === "working"}
          className="inline-flex min-h-11 shrink-0 lg:min-h-10 items-center gap-1.5 rounded-control border border-wheat-deep/40 bg-wheat-soft/40 px-4 text-sm font-medium text-wheat-deep transition-colors duration-150 hover:bg-wheat-soft/70 disabled:opacity-60"
        >
          {state === "working" ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {t("working")}
            </>
          ) : (
            <>
              {t("demoUse")}
              <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
            </>
          )}
        </button>
      </div>
    </li>
  );
}

export function DemoAccounts({ people }: { people: DemoPerson[] }) {
  return (
    <ul className="flex flex-col gap-2 lg:flex-1">
      {people.map((person) => (
        <DemoCard key={person.role} person={person} />
      ))}
    </ul>
  );
}
