/**
 * Code decides, the model only explains. Before a model reply is sent, every number in it and every
 * month or weekday name must come from THIS turn's tool results: numbers that appear in a result
 * (digits in Latin, Gurmukhi or Devanagari script), and the day, month, year, month names and weekday
 * names of every ISO date in a result, in English, Punjabi and Hindi, matched as whole words. Anything
 * else (a date or number the model made up or changed) fails the check, and the farmer gets the
 * template reply instead.
 */
import type { ToolCall } from "./tools";

const INTL = ["en-IN", "pa-IN", "hi-IN"];
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** Gurmukhi (੦-੯) and Devanagari (०-९) digits as 0-9. */
export function latinDigits(text: string): string {
  return text.replace(/[੦-੯]/g, (digit) => String(digit.charCodeAt(0) - 0x0a66)).replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
}

const canonicalNumber = (token: string) => {
  const value = Number(token.replace(/,/g, ""));
  return Number.isFinite(value) ? String(value) : token;
};

function namesFor(date: Date): string[] {
  const names: string[] = [];
  for (const locale of INTL) {
    for (const month of ["long", "short"] as const) names.push(new Intl.DateTimeFormat(locale, { month, timeZone: "UTC" }).format(date));
    for (const weekday of ["long", "short"] as const) names.push(new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(date));
  }
  return names;
}

/** Every month and weekday name the check knows (2026 has every month and weekday). */
const ALL_NAMES: string[] = (() => {
  const names = new Set<string>();
  for (let day = 0; day < 365; day += 1) for (const name of namesFor(new Date(Date.UTC(2026, 0, 1 + day)))) names.add(name);
  // Longest first, so "November" is found before "Nov".
  return [...names].filter((name) => name.length >= 3).sort((left, right) => right.length - left.length);
})();

export type CheckResult = { ok: boolean; unsupported: string[] };

export function checkReply(reply: string, calls: ToolCall[]): CheckResult {
  const evidence = latinDigits(JSON.stringify(calls.map((call) => call.output)));
  const allowedNumbers = new Set<string>();
  for (const match of evidence.matchAll(/\d+(?:\.\d+)?/g)) allowedNumbers.add(canonicalNumber(match[0]));
  const allowedNames = new Set<string>();
  for (const [, year, month, day] of evidence.matchAll(ISO_DATE)) {
    for (const part of [year!, month!, day!]) allowedNumbers.add(canonicalNumber(part));
    for (const name of namesFor(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))))) allowedNames.add(name.toLowerCase());
  }

  const unsupported: string[] = [];
  let text = latinDigits(reply);
  for (const name of ALL_NAMES) {
    // Whole words only. Latin names as capitalised words ("May", not the verb "may"); Gurmukhi and
    // Devanagari names with no letter or vowel sign on either side, so the short weekday शुक्र
    // (Friday) is found alone or in शुक्र को, but not inside शुक्रिया ("thanks"). \b cannot do this:
    // it treats vowel signs as word edges.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const latin = /^[A-Za-z.]+$/.test(name);
    const pattern = latin ? new RegExp(`\\b${escaped}\\b`, "g") : new RegExp(`(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, "gu");
    if (pattern.test(text)) {
      if (!allowedNames.has(name.toLowerCase())) unsupported.push(name);
      text = text.replace(pattern, " ");
    }
  }
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    if (!allowedNumbers.has(canonicalNumber(match[0]))) unsupported.push(match[0]);
  }
  return { ok: unsupported.length === 0, unsupported };
}
