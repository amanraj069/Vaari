// GENERATED from backend/src/shared by `npm run contract:sync` in backend/. Do not edit here.
/**
 * Day indices <-> calendar dates. The engine counts whole days from the season start so it never
 * deals with time zones; people always see calendar dates. All dates are ISO (YYYY-MM-DD), IST.
 */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function utcMidnight(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`not an ISO date: ${isoDate}`);
  return Date.UTC(year, month - 1, day);
}

export function dayToDate(seasonStartDate: string, dayIndex: number): string {
  return new Date(utcMidnight(seasonStartDate) + dayIndex * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

export function dateToDay(seasonStartDate: string, isoDate: string): number {
  return Math.round((utcMidnight(isoDate) - utcMidnight(seasonStartDate)) / MILLISECONDS_PER_DAY);
}

export function minuteToClock(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
