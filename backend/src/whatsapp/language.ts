/**
 * Scripts: the reply language (the script the farmer just wrote in, else their stored language, else
 * English), a phone's own language for notices (storedLanguage, phoneLanguage), Gurmukhi ->
 * Devanagari for the Hindi voice, and either script -> rough Latin letters for matching what a
 * farmer wrote or said against village names.
 */
import type { Locale } from "../shared";
import type { FarmerAccountRecord, FarmerRecord, VaariStore } from "../store/types";

/**
 * The language of what the farmer just wrote: Gurmukhi is Punjabi, Devanagari is Hindi, and Latin
 * letters are English (team decision 2026-10-11: "Sat Shri Kal" typed in Latin letters is answered in
 * English, not in the last language used). Null when there are no letters at all ("4", an emoji).
 * `latinIsEnglish` is false for a tapped button or row: its title may hold a village's Latin name
 * inside a Punjabi or Hindi list, so only Gurmukhi or Devanagari in it counts.
 */
export function scriptLocale(text: string | null | undefined, latinIsEnglish = true): Locale | null {
  if (!text) return null;
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa"; // Gurmukhi
  if (/[\u0900-\u097F]/.test(text)) return "hi"; // Devanagari
  if (latinIsEnglish && /[A-Za-z]/.test(text)) return "en"; // Latin
  return null;
}

/**
 * The language a farmer chose, from their farmer records: a registered farmer's own record (the
 * script they last wrote to Vaari in on WhatsApp), else the language they registered in; for a phone
 * without an account, a language they wrote in. Null when they never chose one: Vaari then writes
 * in English. A stored language nobody chose (an old booking's default) does not count.
 */
export function storedLanguage(records: FarmerRecord[], account: FarmerAccountRecord | null): Locale | null {
  const chosen = (record: FarmerRecord | undefined) => (record?.languageChosen ? record.language : null);
  if (account) return chosen(records.find((record) => record.id === account.farmerId)) ?? account.language;
  return records.map(chosen).find((language) => language !== null) ?? null;
}

/** storedLanguage for one phone, read from the store; `farmerId` is the field's own farmer record. */
export async function phoneLanguage(store: Pick<VaariStore, "getFarmerAccount" | "getFarmer">, phone: string, farmerId?: string): Promise<Locale | null> {
  const account = phone ? await store.getFarmerAccount(phone) : null;
  const targetFarmerId = account?.farmerId ?? farmerId;
  const record = targetFarmerId ? await store.getFarmer(targetFarmerId) : null;
  return storedLanguage(record ? [record] : [], account);
}

const GURMUKHI_ADDAK = 0x0a71;
const isGurmukhiConsonant = (code: number) => (code >= 0x0a15 && code <= 0x0a39) || (code >= 0x0a59 && code <= 0x0a5e);

/**
 * Punjabi in Gurmukhi -> the same words in Devanagari, so the Hindi voice can read them. The Unicode
 * blocks line up (Devanagari = Gurmukhi - 0x100) for every letter, vowel sign, nukta, virama and
 * digit. The rest: tippi (ੰ) is a nasal like bindi -> anusvara (ं); addak (ੱ) doubles the consonant
 * after it (ਪੱਕਾ -> पक्का); ੲ and ੳ (bare vowel carriers) -> इ and उ; ੴ -> ॐ. Anything else passes through.
 */
export function toDevanagari(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x0a00 || code > 0x0a7f) {
      out += text[index];
    } else if (code === GURMUKHI_ADDAK) {
      const next = text.charCodeAt(index + 1);
      if (isGurmukhiConsonant(next)) out += `${String.fromCharCode(next - 0x100)}\u094d`;
    } else if (code === 0x0a70) {
      out += "\u0902";
    } else if (code === 0x0a72) {
      out += "\u0907";
    } else if (code === 0x0a73) {
      out += "\u0909";
    } else if (code === 0x0a74) {
      out += "\u0950";
    } else if (code <= 0x0a6f) {
      out += String.fromCharCode(code - 0x100);
    }
    // Gurmukhi-only marks without a Devanagari match (udaat, yakash) are dropped.
  }
  return out;
}

/** Devanagari letters -> Latin, for matching names only (long and short vowels are not told apart). */
const DEVANAGARI_LATIN: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", ळ: "l", व: "v",
  श: "sh", ष: "sh", स: "s", ह: "h", "\u0958": "k", "\u0959": "kh", "\u095a": "g", "\u095b": "z",
  "\u095c": "r", "\u095d": "rh", "\u095e": "f", "\u095f": "y",
};
const DEVANAGARI_VOWELS: Record<string, string> = {
  अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au",
  "\u093e": "a", "\u093f": "i", "\u0940": "i", "\u0941": "u", "\u0942": "u", "\u0943": "ri", "\u0947": "e", "\u0948": "ai", "\u094b": "o", "\u094c": "au",
};
const NUKTA = "\u093c";
const VIRAMA = "\u094d";
/** With a nukta: ड़ is r, ढ़ rh, फ़ f, ज़ z; the rest sound as without. */
const NUKTA_LATIN: Record<string, string> = { ड: "r", ढ: "rh", फ: "f", ज: "z" };

/**
 * Devanagari or Gurmukhi -> rough Latin letters ("बालियां" -> "baliyan", "ਬਾਲੀਆਂ" -> "balian"), so
 * a village said or written in Hindi or Punjabi can be matched against its English name with a small
 * edit distance. Not a transliteration to show anyone: vowel length is dropped and the short "a" after
 * a consonant is written except at the end of a word. Latin text passes through unchanged.
 */
export function romanize(text: string): string {
  const letters = [...toDevanagari(text).normalize("NFC")];
  let out = "";
  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index]!;
    const consonant = DEVANAGARI_LATIN[letter];
    if (consonant === undefined) {
      if (DEVANAGARI_VOWELS[letter] !== undefined) out += DEVANAGARI_VOWELS[letter];
      else if (letter === "\u0902" || letter === "\u0901") out += "n"; // anusvara, chandrabindu
      else if (letter === "\u0903") out += "h"; // visarga
      else if (letter !== NUKTA && letter !== VIRAMA) out += letter;
      continue;
    }
    let next = letters[index + 1];
    if (next === NUKTA) {
      out += NUKTA_LATIN[letter] ?? consonant;
      index += 1;
      next = letters[index + 1];
    } else {
      out += consonant;
    }
    // The short "a" every consonant carries, unless a vowel sign or virama follows, or the word ends
    // (ढं in ढंडीवाल keeps it: "dhan").
    if (next !== undefined && /[\u0900-\u097f]/.test(next) && next !== VIRAMA && !/[\u093e-\u094c]/.test(next)) out += "a";
  }
  return out;
}
