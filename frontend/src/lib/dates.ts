"use client";

import { useFormatter } from "next-intl";

/** Dates arrive as ISO calendar days; format them in the reader's language, never shifting the day. */
export function useDates() {
  const format = useFormatter();
  const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
  return {
    weekday: (iso: string) => format.dateTime(asDate(iso), { weekday: "long", timeZone: "UTC" }),
    dayMonth: (iso: string) => format.dateTime(asDate(iso), { day: "numeric", month: "long", timeZone: "UTC" }),
    short: (iso: string) => format.dateTime(asDate(iso), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    full: (iso: string) => format.dateTime(asDate(iso), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    range: (startIso: string, endIso: string) => format.dateTimeRange(asDate(startIso), asDate(endIso), { day: "numeric", month: "long", timeZone: "UTC" }),
  };
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}
