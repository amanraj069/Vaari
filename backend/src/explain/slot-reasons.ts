/**
 * The one plain sentence under the date on a farmer's slot page.
 *
 * Why it exists: the date alone does not tell a farmer whether to trust it. This sentence says
 * where the turn stands in words, from stored facts only (the published plan's route, the promise
 * history); no engine call, so the slot page answers instantly. The deeper "why this date?" list
 * still comes from the solver (`/slot/:token/why`).
 * Punjabi and Hindi strings are UNREVIEWED: a speaker must check them before the demo.
 */
import type { Locale, SlotReasonCode } from "../shared";
import type { PromiseReason } from "../store/types";
import { formatDate } from "./templates";

export type SlotReasonValues = {
  chcName: string;
  date?: string; // ISO
  startDate?: string; // ISO
  endDate?: string; // ISO
  machineName?: string;
  villageName?: string;
  stop?: number;
  stops?: number;
  movedBecause?: PromiseReason;
};

type Phrase = (values: SlotReasonValues, date: (iso?: string) => string) => string;

const MOVED_BECAUSE: Record<Locale, Partial<Record<PromiseReason, string>>> = {
  en: { breakdown: "a machine broke down", rain: "rain stopped sowing", manual_move: "the operator had to rearrange the day", replan: "the plan had to change" },
  pa: { breakdown: "ਇੱਕ ਮਸ਼ੀਨ ਖ਼ਰਾਬ ਹੋ ਗਈ", rain: "ਮੀਂਹ ਕਾਰਨ ਬਿਜਾਈ ਰੁਕ ਗਈ", manual_move: "ਆਪਰੇਟਰ ਨੂੰ ਦਿਨ ਬਦਲਣਾ ਪਿਆ", replan: "ਯੋਜਨਾ ਬਦਲਣੀ ਪਈ" },
  hi: { breakdown: "एक मशीन ख़राब हो गई", rain: "बारिश से बुवाई रुक गई", manual_move: "ऑपरेटर को दिन बदलना पड़ा", replan: "योजना बदलनी पड़ी" },
};

const PHRASES: Record<Locale, Record<SlotReasonCode, Phrase>> = {
  en: {
    requested: ({ chcName }) =>
      `Your request is with ${chcName}. The operator plans the machines each evening; your date appears here as soon as they publish a plan that includes your field.`,
    unplaced: () =>
      "Every machine is full for the next 10 days. Your operator sees your field marked at risk and is looking for room.",
    window: ({ startDate, endDate }, date) =>
      `Your turn is between ${date(startDate)} and ${date(endDate)}. Vaari fixes the exact day two days before, when that day's routes are set.`,
    firm_route: ({ machineName, villageName, stop, stops, date: day }, date) =>
      `${machineName} comes to ${villageName} on ${date(day)}. Your field is stop ${stop} of ${stops} that day.`,
    firm: ({ date: day }, date) => `Your date is fixed: ${date(day)}.`,
    moved: ({ movedBecause }) =>
      `Your date had to move because ${MOVED_BECAUSE.en[movedBecause ?? "replan"] ?? MOVED_BECAUSE.en.replan}. The date above is the earliest Vaari could find.`,
    kept: () => "The machine has sown this field. Your promise was kept.",
    broken_no_date: () =>
      "Your date had to move and no machine has room in the next 10 days. Your operator has been told and will call you.",
  },
  pa: {
    requested: ({ chcName }) =>
      `ਤੁਹਾਡੀ ਬੇਨਤੀ ${chcName} ਕੋਲ ਹੈ। ਆਪਰੇਟਰ ਹਰ ਸ਼ਾਮ ਮਸ਼ੀਨਾਂ ਦੀ ਯੋਜਨਾ ਬਣਾਉਂਦਾ ਹੈ; ਜਦੋਂ ਉਹ ਤੁਹਾਡੇ ਖੇਤ ਵਾਲੀ ਯੋਜਨਾ ਜਾਰੀ ਕਰੇਗਾ, ਤੁਹਾਡੀ ਤਰੀਕ ਇੱਥੇ ਦਿਖੇਗੀ।`,
    unplaced: () => "ਅਗਲੇ 10 ਦਿਨ ਹਰ ਮਸ਼ੀਨ ਭਰੀ ਹੋਈ ਹੈ। ਤੁਹਾਡੇ ਆਪਰੇਟਰ ਨੂੰ ਤੁਹਾਡਾ ਖੇਤ ਖ਼ਤਰੇ ਵਿੱਚ ਦਿਖ ਰਿਹਾ ਹੈ ਅਤੇ ਉਹ ਥਾਂ ਲੱਭ ਰਿਹਾ ਹੈ।",
    window: ({ startDate, endDate }, date) =>
      `ਤੁਹਾਡੀ ਵਾਰੀ ${date(startDate)} ਅਤੇ ${date(endDate)} ਦੇ ਵਿਚਕਾਰ ਹੈ। ਪੱਕਾ ਦਿਨ ਦੋ ਦਿਨ ਪਹਿਲਾਂ ਤੈਅ ਹੁੰਦਾ ਹੈ, ਜਦੋਂ ਉਸ ਦਿਨ ਦੇ ਰਸਤੇ ਬਣ ਜਾਂਦੇ ਹਨ।`,
    firm_route: ({ machineName, villageName, stop, stops, date: day }, date) =>
      `${machineName} ${date(day)} ਨੂੰ ${villageName} ਆਵੇਗੀ। ਉਸ ਦਿਨ ਤੁਹਾਡਾ ਖੇਤ ${stops} ਵਿੱਚੋਂ ${stop}ਵਾਂ ਹੈ।`,
    firm: ({ date: day }, date) => `ਤੁਹਾਡੀ ਤਰੀਕ ਪੱਕੀ ਹੈ: ${date(day)}।`,
    moved: ({ movedBecause }) =>
      `ਤੁਹਾਡੀ ਤਰੀਕ ਬਦਲਣੀ ਪਈ ਕਿਉਂਕਿ ${MOVED_BECAUSE.pa[movedBecause ?? "replan"] ?? MOVED_BECAUSE.pa.replan}। ਉੱਪਰ ਵਾਲੀ ਤਰੀਕ ਸਭ ਤੋਂ ਪਹਿਲੀ ਹੈ ਜੋ ਵਾਰੀ ਲੱਭ ਸਕੀ।`,
    kept: () => "ਮਸ਼ੀਨ ਨੇ ਇਸ ਖੇਤ ਦੀ ਬਿਜਾਈ ਕਰ ਦਿੱਤੀ ਹੈ। ਤੁਹਾਡਾ ਵਾਅਦਾ ਨਿਭਾਇਆ ਗਿਆ।",
    broken_no_date: () => "ਤੁਹਾਡੀ ਤਰੀਕ ਬਦਲਣੀ ਪਈ ਅਤੇ ਅਗਲੇ 10 ਦਿਨ ਕਿਸੇ ਮਸ਼ੀਨ ਕੋਲ ਥਾਂ ਨਹੀਂ ਹੈ। ਤੁਹਾਡੇ ਆਪਰੇਟਰ ਨੂੰ ਦੱਸ ਦਿੱਤਾ ਗਿਆ ਹੈ ਅਤੇ ਉਹ ਤੁਹਾਨੂੰ ਫ਼ੋਨ ਕਰੇਗਾ।",
  },
  hi: {
    requested: ({ chcName }) =>
      `आपका अनुरोध ${chcName} के पास है। ऑपरेटर हर शाम मशीनों की योजना बनाता है; जब वह आपके खेत वाली योजना जारी करेगा, आपकी तारीख़ यहाँ दिखेगी।`,
    unplaced: () => "अगले 10 दिन हर मशीन भरी हुई है। आपके ऑपरेटर को आपका खेत ख़तरे में दिख रहा है और वह जगह ढूँढ रहा है।",
    window: ({ startDate, endDate }, date) =>
      `आपकी बारी ${date(startDate)} और ${date(endDate)} के बीच है। पक्का दिन दो दिन पहले तय होता है, जब उस दिन के रास्ते बन जाते हैं।`,
    firm_route: ({ machineName, villageName, stop, stops, date: day }, date) =>
      `${machineName} ${date(day)} को ${villageName} आएगी। उस दिन आपका खेत ${stops} में से ${stop}वाँ है।`,
    firm: ({ date: day }, date) => `आपकी तारीख़ पक्की है: ${date(day)}।`,
    moved: ({ movedBecause }) =>
      `आपकी तारीख़ बदलनी पड़ी क्योंकि ${MOVED_BECAUSE.hi[movedBecause ?? "replan"] ?? MOVED_BECAUSE.hi.replan}। ऊपर वाली तारीख़ सबसे पहली है जो वारी ढूँढ सकी।`,
    kept: () => "मशीन ने इस खेत की बुवाई कर दी है। आपका वादा निभाया गया।",
    broken_no_date: () => "आपकी तारीख़ बदलनी पड़ी और अगले 10 दिन किसी मशीन के पास जगह नहीं है। आपके ऑपरेटर को बता दिया गया है और वह आपको फ़ोन करेगा।",
  },
};

export function slotReasonText(code: SlotReasonCode, values: SlotReasonValues, locale: Locale): string {
  return PHRASES[locale][code](values, (iso) => (iso ? formatDate(iso, locale) : ""));
}
