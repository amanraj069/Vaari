"use client";

/**
 * /dashboard for a village helper: the farmers they booked for, answer first. What to do now
 * (book the first farmer, or a calm word on who is still waiting for a date), four counts, then
 * the working list with search and a status filter (copy a farmer's link again, or give them a new
 * one), and beside it where the farmers stand (a ring: firm date, window, no date yet), the
 * villages they come from, and how booking works in three steps for anyone new to it.
 */
import { CalendarCheck2, CalendarRange, Hourglass, List, Plus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { QueueItem } from "@/shared";
import { BookedList } from "@/components/booked-list";
import { HowBookingWorks } from "@/components/how-booking-works";
import { DashHeader, Donut, MetricStrip, NextStep, Panel, SearchBox, Segmented } from "@/components/dashboard/kit";
import { ButtonLink } from "@/components/ui";
import { useBookedList } from "./facilitator-book";

type Status = "firm" | "window" | "none";
const STATUS_COLOUR: Record<Status, string> = { firm: "var(--color-season-ontime)", window: "var(--color-policy-nearest)", none: "var(--color-season-late)" };
const statusOf = (item: QueueItem): Status => (item.promise?.kind === "firm" ? "firm" : item.promise?.kind === "window" ? "window" : "none");

export function FacilitatorBookingsView() {
  const t = useTranslations("bookings");
  const ts = useTranslations("schedule");
  const tf = useTranslations("farmer");
  const { booked, listState, copyLink, reissueLink } = useBookedList();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const items = booked.data?.items ?? [];
  const counts = {
    total: items.length,
    firm: items.filter((item) => statusOf(item) === "firm").length,
    window: items.filter((item) => statusOf(item) === "window").length,
    noDate: items.filter((item) => statusOf(item) === "none").length,
    atRisk: items.filter((item) => item.risk === "at_risk" || item.risk === "tight").length,
  };
  const villages = [...items.reduce((map, item) => map.set(item.villageName, (map.get(item.villageName) ?? 0) + 1), new Map<string, number>())].sort((left, right) => right[1] - left[1]);
  const maxVillage = Math.max(1, ...villages.map(([, count]) => count));
  const needle = search.trim().toLowerCase().replace(/^#/, "");
  const shownState =
    listState.kind === "ready"
      ? {
          kind: "ready" as const,
          items: listState.items
            .filter((item) => status === "all" || statusOf(item) === status)
            .filter((item) => !needle || item.farmerName.toLowerCase().includes(needle) || item.villageName.toLowerCase().includes(needle) || String(item.token).padStart(3, "0").includes(needle)),
        }
      : listState;
  const bookAction = (
    <ButtonLink href="/dashboard/book" variant="accent">
      <Plus aria-hidden className="size-5" strokeWidth={2} />
      {t("bookAction")}
    </ButtonLink>
  );

  return (
    <>
      {/* With no bookings yet the "what to do now" card carries the button; one is enough. */}
      <DashHeader title={t("title")} actions={booked.isSuccess && counts.total === 0 ? undefined : bookAction} />

      {/* The next step only when there is one: an empty list. Once farmers are booked, the numbers
          below say where they stand, so a sentence repeating them would be noise. */}
      {booked.isSuccess && counts.total === 0 ? (
        <div className="mt-6">
          <NextStep icon={UserPlus} tone="warn" title={t("firstTitle")} body={t("firstBody")} action={bookAction} />
        </div>
      ) : null}

      <div className="mt-6">
        <MetricStrip
          label={t("metricsLabel")}
          metrics={[
            { label: t("kpiFirm"), value: booked.data ? String(counts.firm) : "–", tone: counts.firm > 0 ? "good" : "neutral", sub: t("kpiFirmSub") },
            { label: t("kpiWindow"), value: booked.data ? String(counts.window) : "–", sub: t("kpiWindowSub") },
            { label: t("kpiNoDate"), value: booked.data ? String(counts.noDate) : "–", tone: counts.noDate > 0 ? "warn" : "neutral", sub: t("kpiNoDateHint") },
            { label: t("kpiRisk"), value: booked.data ? String(counts.atRisk) : "–", tone: counts.atRisk > 0 ? "risk" : "neutral", sub: t("kpiRiskHint") },
          ]}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel id="bookings-list-title" title={t("listTitle")} subtitle={t("listSubtitle")} bodyClassName="">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <SearchBox label={ts("searchFields")} value={search} onChange={setSearch} />
            <Segmented
              label={t("filterLabel")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "all" as const, label: t("filterAll"), count: counts.total, icon: List },
                { value: "firm" as const, label: tf("firm"), count: counts.firm, icon: CalendarCheck2 },
                { value: "window" as const, label: tf("window"), count: counts.window, icon: CalendarRange },
                { value: "none" as const, label: tf("noDate"), count: counts.noDate, icon: Hourglass },
              ]}
            />
          </div>
          <BookedList bare state={shownState} onCopyLink={copyLink} onReissueLink={reissueLink} />
        </Panel>

        <div className="space-y-6">
          <Panel id="bookings-status-title" title={t("statusTitle")}>
            <Donut
              label={t("statusLabel", { firm: counts.firm, window: counts.window, none: counts.noDate })}
              total={counts.total}
              centreLabel={t("centreLabel")}
              parts={[
                { key: "firm", label: tf("firm"), value: counts.firm, colour: STATUS_COLOUR.firm },
                { key: "window", label: tf("window"), value: counts.window, colour: STATUS_COLOUR.window },
                { key: "none", label: tf("noDate"), value: counts.noDate, colour: STATUS_COLOUR.none },
              ]}
            />
          </Panel>
          {villages.length > 0 ? (
            <Panel id="bookings-villages-title" title={t("villagesTitle")}>
              <ul className="space-y-3">
                {villages.slice(0, 6).map(([name, count]) => (
                  <li key={name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{name}</span>
                      <span className="font-medium tabular">{count}</span>
                    </div>
                    <div aria-hidden className="mt-1.5 h-1.5 rounded-full bg-wheat-deep" style={{ width: `${Math.max(6, (count / maxVillage) * 100)}%` }} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {/* How booking works is for the first few bookings; after that it is clutter. */}
          {booked.isSuccess && counts.total < 3 ? (
            <Panel id="bookings-how-title" title={t("howTitle")}>
              <HowBookingWorks />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
