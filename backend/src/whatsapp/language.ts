/** The reply language: the script the farmer just wrote in, else their stored language, else English. */
import type { Locale } from "../shared";

export function scriptLocale(text: string | null | undefined): Locale | null {
  if (!text) return null;
  if (/[਀-੿]/.test(text)) return "pa"; // Gurmukhi
  if (/[ऀ-ॿ]/.test(text)) return "hi"; // Devanagari
  return null;
}

export function chooseLocale(stored: Locale | null, text: string | null): Locale {
  return scriptLocale(text) ?? stored ?? "en";
}
