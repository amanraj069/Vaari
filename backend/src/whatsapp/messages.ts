/**
 * Everything Vaari says on WhatsApp that is not a date sentence. The date sentences themselves come
 * from explain/ (slot-reasons.ts, templates.ts), the same words as the slot page, so a farmer reads
 * the same thing everywhere. Button titles fit WhatsApp's 20 characters, list rows 24.
 * Punjabi and Hindi strings are UNREVIEWED: a speaker must check them before the demo.
 */
import type { Locale } from "../shared";
import { formatDate } from "../explain/templates";

type Words = {
  unknownNumber: string;
  offTopic: string;
  agentUnavailable: string;
  voiceNotSupported: string;
  menuBody: string;
  menuButton: string;
  menuDate: string;
  menuWhy: string;
  menuWait: string;
  menuPage: string;
  pickField: string;
  pickFieldButton: string;
  pickDays: (lastDay: string) => string;
  pickDaysButton: string;
  daysRow: (days: number) => string;
  daysRowDetail: (lastDay: string) => string;
  confirmBody: (lastDay: string) => string;
  confirm: string;
  cancel: string;
  done: (lastDay: string) => string;
  cancelled: string;
  expired: string;
  cannotShorten: string;
  listOutOfDate: string;
  pageLink: (url: string) => string;
  pageSent: string;
  lastDayYouCanWait: (lastDay: string) => string;
  firm: (date: string) => string;
  window: (start: string, end: string) => string;
  noDate: string;
};

const WORDS: Record<Locale, Words> = {
  en: {
    unknownNumber: "I could not find a booking for this number. Please ask your village helper.",
    offTopic: "Sorry, I can only help with your machine dates. Tap the menu to choose.",
    agentUnavailable: "I cannot answer in words right now. Tap the menu to choose.",
    voiceNotSupported: "I cannot listen to voice notes yet. Please type, or tap the menu.",
    menuBody: "What would you like to know about your machine date?",
    menuButton: "Menu",
    menuDate: "My date",
    menuWhy: "Why this day",
    menuWait: "I cannot wait longer",
    menuPage: "My fields page",
    pickField: "Which field?",
    pickFieldButton: "Fields",
    pickDays: (lastDay) => `Your last waiting day is ${lastDay}. How many days after harvest can you wait now?`,
    pickDaysButton: "Days",
    daysRow: (days) => `${days} ${days === 1 ? "day" : "days"}`,
    daysRowDetail: (lastDay) => `Last day: ${lastDay}`,
    confirmBody: (lastDay) =>
      `Change your last waiting day to ${lastDay}? Your operator will plan again. Your date can only get earlier, never later. Tap Confirm to send it.`,
    confirm: "Confirm",
    cancel: "Cancel",
    done: (lastDay) => `Done. Your operator now sees that you can wait until ${lastDay}. You will get a message when they publish the new plan.`,
    cancelled: "Cancelled. Nothing changed.",
    expired: "That request has expired or was already used. Nothing changed. Tap the menu to start again.",
    cannotShorten: "That cannot be changed from here. Please ask your village helper.",
    listOutOfDate: "That list is out of date. Here is the menu again.",
    pageLink: (url) => `Your fields: ${url}\nThe link opens once, for 15 minutes.`,
    pageSent: "I am sending you a link to all your fields.",
    lastDayYouCanWait: (lastDay) => `You can wait until ${lastDay}.`,
    firm: (date) => `firm date ${date}`,
    window: (start, end) => `between ${start} and ${end}`,
    noDate: "no date yet",
  },
  pa: {
    unknownNumber: "ਮੈਨੂੰ ਇਸ ਨੰਬਰ ਦੀ ਕੋਈ ਬੁਕਿੰਗ ਨਹੀਂ ਮਿਲੀ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੇ ਪਿੰਡ ਦੇ ਮਦਦਗਾਰ ਨੂੰ ਪੁੱਛੋ।",
    offTopic: "ਮਾਫ਼ ਕਰਨਾ, ਮੈਂ ਸਿਰਫ਼ ਤੁਹਾਡੀਆਂ ਮਸ਼ੀਨ ਦੀਆਂ ਤਰੀਕਾਂ ਬਾਰੇ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ। ਚੁਣਨ ਲਈ ਮੀਨੂ ਦਬਾਓ।",
    agentUnavailable: "ਮੈਂ ਹੁਣ ਸ਼ਬਦਾਂ ਵਿੱਚ ਜਵਾਬ ਨਹੀਂ ਦੇ ਸਕਦਾ। ਚੁਣਨ ਲਈ ਮੀਨੂ ਦਬਾਓ।",
    voiceNotSupported: "ਮੈਂ ਅਜੇ ਆਵਾਜ਼ ਵਾਲੇ ਸੁਨੇਹੇ ਨਹੀਂ ਸੁਣ ਸਕਦਾ। ਕਿਰਪਾ ਕਰਕੇ ਲਿਖੋ, ਜਾਂ ਮੀਨੂ ਦਬਾਓ।",
    menuBody: "ਤੁਸੀਂ ਆਪਣੀ ਮਸ਼ੀਨ ਦੀ ਤਰੀਕ ਬਾਰੇ ਕੀ ਜਾਣਨਾ ਚਾਹੁੰਦੇ ਹੋ?",
    menuButton: "ਮੀਨੂ",
    menuDate: "ਮੇਰੀ ਤਰੀਕ",
    menuWhy: "ਇਹ ਦਿਨ ਕਿਉਂ",
    menuWait: "ਹੋਰ ਉਡੀਕ ਨਹੀਂ",
    menuPage: "ਮੇਰੇ ਖੇਤਾਂ ਦਾ ਪੰਨਾ",
    pickField: "ਕਿਹੜਾ ਖੇਤ?",
    pickFieldButton: "ਖੇਤ",
    pickDays: (lastDay) => `ਤੁਹਾਡੀ ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ ${lastDay} ਹੈ। ਹੁਣ ਤੁਸੀਂ ਵਾਢੀ ਤੋਂ ਬਾਅਦ ਕਿੰਨੇ ਦਿਨ ਉਡੀਕ ਕਰ ਸਕਦੇ ਹੋ?`,
    pickDaysButton: "ਦਿਨ",
    daysRow: (days) => `${days} ਦਿਨ`,
    daysRowDetail: (lastDay) => `ਆਖਰੀ ਦਿਨ: ${lastDay}`,
    confirmBody: (lastDay) =>
      `ਕੀ ਆਪਣੀ ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ ${lastDay} ਕਰਨਾ ਹੈ? ਤੁਹਾਡਾ ਆਪਰੇਟਰ ਮੁੜ ਯੋਜਨਾ ਬਣਾਏਗਾ। ਤੁਹਾਡੀ ਤਰੀਕ ਸਿਰਫ਼ ਪਹਿਲਾਂ ਹੋ ਸਕਦੀ ਹੈ, ਕਦੇ ਬਾਅਦ ਨਹੀਂ। ਭੇਜਣ ਲਈ ਪੁਸ਼ਟੀ ਦਬਾਓ।`,
    confirm: "ਪੁਸ਼ਟੀ ਕਰੋ",
    cancel: "ਰੱਦ ਕਰੋ",
    done: (lastDay) => `ਹੋ ਗਿਆ। ਤੁਹਾਡੇ ਆਪਰੇਟਰ ਨੂੰ ਹੁਣ ਪਤਾ ਹੈ ਕਿ ਤੁਸੀਂ ${lastDay} ਤੱਕ ਉਡੀਕ ਕਰ ਸਕਦੇ ਹੋ। ਨਵੀਂ ਯੋਜਨਾ ਜਾਰੀ ਹੋਣ ਤੇ ਤੁਹਾਨੂੰ ਸੁਨੇਹਾ ਮਿਲੇਗਾ।`,
    cancelled: "ਰੱਦ ਕੀਤਾ। ਕੁਝ ਨਹੀਂ ਬਦਲਿਆ।",
    expired: "ਇਹ ਬੇਨਤੀ ਪੁਰਾਣੀ ਹੋ ਗਈ ਹੈ ਜਾਂ ਪਹਿਲਾਂ ਵਰਤੀ ਜਾ ਚੁੱਕੀ ਹੈ। ਕੁਝ ਨਹੀਂ ਬਦਲਿਆ। ਮੁੜ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਮੀਨੂ ਦਬਾਓ।",
    cannotShorten: "ਇਹ ਇੱਥੋਂ ਨਹੀਂ ਬਦਲਿਆ ਜਾ ਸਕਦਾ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੇ ਪਿੰਡ ਦੇ ਮਦਦਗਾਰ ਨੂੰ ਪੁੱਛੋ।",
    listOutOfDate: "ਉਹ ਸੂਚੀ ਪੁਰਾਣੀ ਹੋ ਗਈ ਹੈ। ਮੀਨੂ ਫਿਰ ਹਾਜ਼ਰ ਹੈ।",
    pageLink: (url) => `ਤੁਹਾਡੇ ਖੇਤ: ${url}\nਲਿੰਕ ਇੱਕ ਵਾਰ, 15 ਮਿੰਟ ਲਈ ਖੁੱਲ੍ਹਦਾ ਹੈ।`,
    pageSent: "ਮੈਂ ਤੁਹਾਨੂੰ ਤੁਹਾਡੇ ਸਾਰੇ ਖੇਤਾਂ ਦਾ ਲਿੰਕ ਭੇਜ ਰਿਹਾ ਹਾਂ।",
    lastDayYouCanWait: (lastDay) => `ਤੁਸੀਂ ${lastDay} ਤੱਕ ਉਡੀਕ ਕਰ ਸਕਦੇ ਹੋ।`,
    firm: (date) => `ਪੱਕੀ ਤਰੀਕ ${date}`,
    window: (start, end) => `${start} ਅਤੇ ${end} ਦੇ ਵਿਚਕਾਰ`,
    noDate: "ਅਜੇ ਕੋਈ ਤਰੀਕ ਨਹੀਂ",
  },
  hi: {
    unknownNumber: "मुझे इस नंबर की कोई बुकिंग नहीं मिली। कृपया अपने गाँव के सहायक से पूछें।",
    offTopic: "माफ़ कीजिए, मैं सिर्फ़ आपकी मशीन की तारीख़ों में मदद कर सकता हूँ। चुनने के लिए मेन्यू दबाएँ।",
    agentUnavailable: "मैं अभी शब्दों में जवाब नहीं दे सकता। चुनने के लिए मेन्यू दबाएँ।",
    voiceNotSupported: "मैं अभी आवाज़ वाले संदेश नहीं सुन सकता। कृपया लिखें, या मेन्यू दबाएँ।",
    menuBody: "आप अपनी मशीन की तारीख़ के बारे में क्या जानना चाहते हैं?",
    menuButton: "मेन्यू",
    menuDate: "मेरी तारीख़",
    menuWhy: "यह दिन क्यों",
    menuWait: "और इंतज़ार नहीं",
    menuPage: "मेरे खेतों का पेज",
    pickField: "कौन सा खेत?",
    pickFieldButton: "खेत",
    pickDays: (lastDay) => `आपके इंतज़ार का आख़िरी दिन ${lastDay} है। अब आप कटाई के बाद कितने दिन इंतज़ार कर सकते हैं?`,
    pickDaysButton: "दिन",
    daysRow: (days) => `${days} दिन`,
    daysRowDetail: (lastDay) => `आख़िरी दिन: ${lastDay}`,
    confirmBody: (lastDay) =>
      `क्या अपने इंतज़ार का आख़िरी दिन ${lastDay} करना है? आपका ऑपरेटर फिर से योजना बनाएगा। आपकी तारीख़ सिर्फ़ पहले हो सकती है, कभी बाद में नहीं। भेजने के लिए पुष्टि दबाएँ।`,
    confirm: "पुष्टि करें",
    cancel: "रद्द करें",
    done: (lastDay) => `हो गया। आपके ऑपरेटर को अब पता है कि आप ${lastDay} तक इंतज़ार कर सकते हैं। नई योजना जारी होने पर आपको संदेश मिलेगा।`,
    cancelled: "रद्द किया। कुछ नहीं बदला।",
    expired: "यह अनुरोध पुराना हो गया है या पहले इस्तेमाल हो चुका है। कुछ नहीं बदला। फिर से शुरू करने के लिए मेन्यू दबाएँ।",
    cannotShorten: "यह यहाँ से नहीं बदला जा सकता। कृपया अपने गाँव के सहायक से पूछें।",
    listOutOfDate: "वह सूची पुरानी हो गई है। मेन्यू फिर से हाज़िर है।",
    pageLink: (url) => `आपके खेत: ${url}\nलिंक एक बार, 15 मिनट के लिए खुलता है।`,
    pageSent: "मैं आपको आपके सभी खेतों का लिंक भेज रहा हूँ।",
    lastDayYouCanWait: (lastDay) => `आप ${lastDay} तक इंतज़ार कर सकते हैं।`,
    firm: (date) => `पक्की तारीख़ ${date}`,
    window: (start, end) => `${start} और ${end} के बीच`,
    noDate: "अभी कोई तारीख़ नहीं",
  },
};

export const words = (locale: Locale): Words => WORDS[locale];

/** A promise in a few words: "firm date Sunday, 1 November" / "between ... and ..." / "no date yet". */
export function promiseWords(promise: { kind: "firm"; date: string } | { kind: "window"; startDate: string; endDate: string } | null, locale: Locale): string {
  const said = WORDS[locale];
  if (!promise) return said.noDate;
  return promise.kind === "firm" ? said.firm(formatDate(promise.date, locale)) : said.window(formatDate(promise.startDate, locale), formatDate(promise.endDate, locale));
}

/** Menu and confirmation ids that are ours alone (a farmer cannot type a button id). */
export const MENU_ACTIONS = ["date", "why", "wait", "page"] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];
