/**
 * Plain-language sentences for the solver's reasons. This is the fallback that always works:
 * if the model is switched off, unavailable, or its reply fails the number check, the farmer reads
 * these. Every date and number here comes from the engine's reasons list.
 * Punjabi and Hindi strings are UNREVIEWED: a speaker must check them before the demo.
 */
import type { Locale, ReasonCode } from "../shared";

export type ReasonValues = { dates: string[]; machines: string[]; count: number | null };

const INTL_LOCALE: Record<Locale, string> = { en: "en-IN", pa: "pa-IN", hi: "hi-IN" };

export function formatDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

function list(items: string[], locale: Locale): string {
  const conjunction = new Intl.ListFormat(INTL_LOCALE[locale], { style: "long", type: "conjunction" });
  return conjunction.format(items);
}

type Template = (values: ReasonValues & { dateText: string; machineText: string }) => string;

const TEMPLATES: Record<Locale, Record<ReasonCode, Template>> = {
  en: {
    EARLIEST_PLAN_DAY: ({ dateText }) => `${dateText} is the earliest day in the plan.`,
    FIELD_NOT_READY: ({ dateText }) => `Your field is ready on ${dateText}. No machine can sow before that.`,
    RAIN: ({ dateText }) => `No sowing on ${dateText} because of rain.`,
    MACHINE_DOWN: ({ machineText, dateText }) => `${machineText} is in the workshop on ${dateText}.`,
    DAYS_FULL: ({ dateText }) => `${dateText}: every working machine is already full.`,
    PROMISES_HELD: ({ count }) => `${count} other farmers already hold promises for those days.`,
    EARLIER_DEADLINES_AHEAD: ({ count }) => `${count} farmers ahead of you reach their last waiting day sooner than you.`,
    ROUTE_GROUPING: () => `Your field is grouped with nearby fields so the machine travels less.`,
    BEFORE_BURN_DEADLINE: ({ count, dateText }) =>
      count === 0
        ? `Your date is the last day you said you can wait (${dateText}).`
        : `Your date is ${count} ${count === 1 ? "day" : "days"} before the last day you said you can wait (${dateText}).`,
  },
  pa: {
    EARLIEST_PLAN_DAY: ({ dateText }) => `${dateText} ਯੋਜਨਾ ਦਾ ਸਭ ਤੋਂ ਪਹਿਲਾ ਦਿਨ ਹੈ।`,
    FIELD_NOT_READY: ({ dateText }) => `ਤੁਹਾਡਾ ਖੇਤ ${dateText} ਨੂੰ ਤਿਆਰ ਹੈ। ਉਸ ਤੋਂ ਪਹਿਲਾਂ ਕੋਈ ਮਸ਼ੀਨ ਬਿਜਾਈ ਨਹੀਂ ਕਰ ਸਕਦੀ।`,
    RAIN: ({ dateText }) => `ਮੀਂਹ ਕਾਰਨ ${dateText} ਨੂੰ ਬਿਜਾਈ ਨਹੀਂ ਹੋਵੇਗੀ।`,
    MACHINE_DOWN: ({ machineText, dateText }) => `${machineText} ${dateText} ਨੂੰ ਵਰਕਸ਼ਾਪ ਵਿੱਚ ਹੈ।`,
    DAYS_FULL: ({ dateText }) => `${dateText}: ਹਰ ਚੱਲਦੀ ਮਸ਼ੀਨ ਪਹਿਲਾਂ ਹੀ ਭਰੀ ਹੋਈ ਹੈ।`,
    PROMISES_HELD: ({ count }) => `${count} ਹੋਰ ਕਿਸਾਨਾਂ ਨੂੰ ਉਹਨਾਂ ਦਿਨਾਂ ਦਾ ਵਾਅਦਾ ਪਹਿਲਾਂ ਹੀ ਮਿਲਿਆ ਹੋਇਆ ਹੈ।`,
    EARLIER_DEADLINES_AHEAD: ({ count }) => `ਤੁਹਾਡੇ ਤੋਂ ਅੱਗੇ ${count} ਕਿਸਾਨਾਂ ਦੀ ਉਡੀਕ ਦੀ ਆਖਰੀ ਤਰੀਕ ਤੁਹਾਡੇ ਤੋਂ ਪਹਿਲਾਂ ਹੈ।`,
    ROUTE_GROUPING: () => `ਤੁਹਾਡਾ ਖੇਤ ਨੇੜਲੇ ਖੇਤਾਂ ਨਾਲ ਜੋੜਿਆ ਗਿਆ ਹੈ ਤਾਂ ਜੋ ਮਸ਼ੀਨ ਘੱਟ ਸਫ਼ਰ ਕਰੇ।`,
    BEFORE_BURN_DEADLINE: ({ count, dateText }) =>
      `ਤੁਹਾਡੀ ਤਰੀਕ ਤੁਹਾਡੀ ਉਡੀਕ ਦੇ ਆਖਰੀ ਦਿਨ (${dateText}) ਤੋਂ ${count} ਦਿਨ ਪਹਿਲਾਂ ਹੈ।`,
  },
  hi: {
    EARLIEST_PLAN_DAY: ({ dateText }) => `${dateText} योजना का सबसे पहला दिन है।`,
    FIELD_NOT_READY: ({ dateText }) => `आपका खेत ${dateText} को तैयार है। उससे पहले कोई मशीन बुवाई नहीं कर सकती।`,
    RAIN: ({ dateText }) => `बारिश के कारण ${dateText} को बुवाई नहीं होगी।`,
    MACHINE_DOWN: ({ machineText, dateText }) => `${machineText} ${dateText} को वर्कशॉप में है।`,
    DAYS_FULL: ({ dateText }) => `${dateText}: हर चालू मशीन पहले से भरी हुई है।`,
    PROMISES_HELD: ({ count }) => `${count} अन्य किसानों को उन दिनों का वादा पहले से मिला हुआ है।`,
    EARLIER_DEADLINES_AHEAD: ({ count }) => `आपसे आगे ${count} किसानों की इंतज़ार की आख़िरी तारीख़ आपसे पहले है।`,
    ROUTE_GROUPING: () => `आपका खेत पास के खेतों के साथ जोड़ा गया है ताकि मशीन कम सफ़र करे।`,
    BEFORE_BURN_DEADLINE: ({ count, dateText }) => `आपकी तारीख़ आपके इंतज़ार के आख़िरी दिन (${dateText}) से ${count} दिन पहले है।`,
  },
};

export function reasonText(code: ReasonCode, values: ReasonValues, locale: Locale): string {
  const dateText = list(values.dates.map((date) => formatDate(date, locale)), locale);
  const machineText = list(values.machines, locale);
  return TEMPLATES[locale][code]({ ...values, dateText, machineText });
}
