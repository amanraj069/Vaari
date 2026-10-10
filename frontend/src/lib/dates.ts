/**
 * Dates in the reader's language, built from CLDR month and weekday names stored in the message
 * files (messages/*.json, "dates"). Why not Intl in the browser: Chrome ships trimmed locale data,
 * so Punjabi months came out as "M11", and the server (Node, full data) rendered differently from
 * the browser, which broke hydration. Dates arrive as ISO calendar days and never shift by zone.
 */
import { useTranslations } from "next-intl";

type Parts = { year: number; month: number; day: number; weekday: number };

function parts(iso: string): Parts {
  const date = new Date(`${iso}T00:00:00Z`);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), weekday: date.getUTCDay() };
}

export function useDates() {
  const t = useTranslations("dates");
  const monthsLong = t.raw("monthsLong") as string[];
  const monthsShort = t.raw("monthsShort") as string[];
  const weekdaysLong = t.raw("weekdaysLong") as string[];
  const weekdaysShort = t.raw("weekdaysShort") as string[];
  return {
    weekday: (iso: string) => weekdaysLong[parts(iso).weekday]!,
    weekdayShort: (iso: string) => weekdaysShort[parts(iso).weekday]!,
    dayOfMonth: (iso: string) => parts(iso).day,
    dayMonth: (iso: string) => {
      const { day, month } = parts(iso);
      return t("dayMonth", { day, month: monthsLong[month]! });
    },
    short: (iso: string) => {
      const { day, month, weekday } = parts(iso);
      return t("short", { weekday: weekdaysShort[weekday]!, day, month: monthsShort[month]! });
    },
    full: (iso: string) => {
      const { day, month, weekday } = parts(iso);
      return t("full", { weekday: weekdaysLong[weekday]!, day, month: monthsLong[month]! });
    },
    range: (startIso: string, endIso: string) => {
      const start = parts(startIso);
      const end = parts(endIso);
      if (start.month === end.month && start.year === end.year) {
        return t("rangeSameMonth", { startDay: start.day, endDay: end.day, month: monthsLong[start.month]! });
      }
      return t("rangeCrossMonth", { startDay: start.day, startMonth: monthsShort[start.month]!, endDay: end.day, endMonth: monthsShort[end.month]! });
    },
  };
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}
