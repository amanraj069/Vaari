/**
 * Everything Vaari says on WhatsApp that is not a date sentence. The date sentences themselves come
 * from explain/ (slot-reasons.ts, templates.ts), the same words as the slot page, so a farmer reads
 * the same thing everywhere. Button titles fit WhatsApp's 20 characters, list rows 24.
 * Punjabi and Hindi strings are UNREVIEWED: a speaker must check them before the demo.
 */
import type { Locale } from "../shared";
import { formatDate } from "../explain/templates";

/** A booking with its dates already in words (formatDate), for the Confirm and "booked" messages. */
export type BookingWords = { village: string; centre: string; acres: number; readyDate: string; lastDay: string };

type Words = {
  unknownNumber: (registerUrl: string) => string;
  noBookingsYet: (name: string) => string;
  offTopic: string;
  agentUnavailable: string;
  voiceNotSupported: string;
  heard: (text: string) => string;
  voiceNotUnderstood: string;
  menuBody: string;
  menuButton: string;
  menuDate: string;
  menuWhy: string;
  menuWait: string;
  menuPage: string;
  menuBook: string;
  bookAsk: string;
  bookOnWeb: (url: string) => string;
  bookConfirmBody: (booking: BookingWords) => string;
  booked: (booking: BookingWords & { token: string }) => string;
  bookFailed: string;
  /** What a booking still needs, from `bookDetail` (all three missing: bookAsk instead). */
  bookNeeds: (details: string) => string;
  bookDetail: Record<"village" | "acres" | "lastDay", string>;
  bookWhichVillage: (options: string) => string;
  bookUnknownVillage: (named: string) => string;
  bookBadDay: (maxDays: number) => string;
  bookTooMany: string;
  noFields: string;
  fieldNotFound: string;
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
    unknownNumber: (registerUrl) => `I could not find this number on Vaari. Register at ${registerUrl}, or ask your village helper to book for you.`,
    noBookingsYet: (name) => `Hello ${name}. You have no field booked yet. Tap Book a field and I will tell you its machine date here.`,
    offTopic: "Sorry, I can only help with your machine dates and with booking a field. Tap the menu to choose.",
    agentUnavailable: "I cannot answer in words right now. Tap the menu to choose.",
    voiceNotSupported: "I cannot listen to voice notes yet. Please type, or tap the menu.",
    heard: (text) => `I heard: "${text}"`,
    voiceNotUnderstood: "I could not make out that voice note. Please say it again, type it, or tap the menu.",
    menuBody: "What would you like to know about your machine date?",
    menuButton: "Menu",
    menuDate: "My date",
    menuWhy: "Why this day",
    menuWait: "I cannot wait longer",
    menuPage: "My fields page",
    menuBook: "Book a field",
    bookAsk:
      "Tell me in one message: your village, how many acres, and the last day you can wait for the machine. Add the harvest day if it is not today. For example: 4 acres in Balian, I can wait until 3 November.",
    bookOnWeb: (url) => `Book your field on this page: ${url}\nThe link opens once, for 15 minutes. Then tap "Book a new field".`,
    bookConfirmBody: (booking) =>
      `Please check your booking:\nVillage: ${booking.village}\nField: ${booking.acres} acres\nHarvest ready: ${booking.readyDate}\nLast day you can wait: ${booking.lastDay}\nMachine centre: ${booking.centre}\n\nTap Confirm to book it. Nothing is booked until you do.`,
    booked: (booking) =>
      `Booked. Your token is ${booking.token}: ${booking.acres} acres in ${booking.village}, harvest ready ${booking.readyDate}, you can wait until ${booking.lastDay}.\n\nThe operator at ${booking.centre} has been told. You will get your machine date as soon as the operator confirms the plan, and I will send it here with your slot link.`,
    bookFailed: "I could not book this field, so nothing was booked. Please send your village, acres and the last day you can wait again, or ask your village helper.",
    bookNeeds: (details) => `To book this field, please also tell me ${details}. For example: 4 acres in Balian, I can wait until 3 November.`,
    bookDetail: { village: "your village", acres: "how many acres", lastDay: "the last day you can wait for the machine" },
    bookWhichVillage: (options) => `Which village is it? Please send one of these names:\n${options}`,
    bookUnknownVillage: (named) => `No machine centre on Vaari serves a village called "${named}". Please check the village name and send it again, or ask your village helper.`,
    bookBadDay: (maxDays) => `I could not use that day. The last day you can wait must be after today, and at most ${maxDays} days after the harvest. Please send it again, for example: I can wait until 3 November.`,
    bookTooMany: "This number already has the most open fields Vaari allows. Please ask your village helper.",
    noFields: "You have no field booked on this number yet. Tap Book a field in the menu, or tell me your village, acres and the last day you can wait.",
    fieldNotFound: "I could not find that field. Tap the menu to choose one of your fields.",
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
    unknownNumber: (registerUrl) => `ਮੈਨੂੰ ਵਾਰੀ 'ਤੇ ਇਹ ਨੰਬਰ ਨਹੀਂ ਮਿਲਿਆ। ${registerUrl} 'ਤੇ ਰਜਿਸਟਰ ਕਰੋ, ਜਾਂ ਆਪਣੇ ਪਿੰਡ ਦੇ ਮਦਦਗਾਰ ਨੂੰ ਬੁਕਿੰਗ ਲਈ ਕਹੋ।`,
    noBookingsYet: (name) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${name}। ਤੁਹਾਡਾ ਅਜੇ ਕੋਈ ਖੇਤ ਬੁੱਕ ਨਹੀਂ ਹੈ। "ਖੇਤ ਬੁੱਕ ਕਰੋ" ਦਬਾਓ, ਮੈਂ ਇੱਥੇ ਤੁਹਾਨੂੰ ਮਸ਼ੀਨ ਦੀ ਤਰੀਕ ਦੱਸਾਂਗਾ।`,
    offTopic: "ਮਾਫ਼ ਕਰਨਾ, ਮੈਂ ਸਿਰਫ਼ ਤੁਹਾਡੀਆਂ ਮਸ਼ੀਨ ਦੀਆਂ ਤਰੀਕਾਂ ਅਤੇ ਖੇਤ ਬੁੱਕ ਕਰਨ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ। ਚੁਣਨ ਲਈ ਮੀਨੂ ਦਬਾਓ।",
    agentUnavailable: "ਮੈਂ ਹੁਣ ਸ਼ਬਦਾਂ ਵਿੱਚ ਜਵਾਬ ਨਹੀਂ ਦੇ ਸਕਦਾ। ਚੁਣਨ ਲਈ ਮੀਨੂ ਦਬਾਓ।",
    voiceNotSupported: "ਮੈਂ ਅਜੇ ਆਵਾਜ਼ ਵਾਲੇ ਸੁਨੇਹੇ ਨਹੀਂ ਸੁਣ ਸਕਦਾ। ਕਿਰਪਾ ਕਰਕੇ ਲਿਖੋ, ਜਾਂ ਮੀਨੂ ਦਬਾਓ।",
    heard: (text) => `ਮੈਂ ਸੁਣਿਆ: "${text}"`,
    voiceNotUnderstood: "ਮੈਂ ਇਹ ਆਵਾਜ਼ ਵਾਲਾ ਸੁਨੇਹਾ ਸਮਝ ਨਹੀਂ ਸਕਿਆ। ਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਬੋਲੋ, ਲਿਖੋ, ਜਾਂ ਮੀਨੂ ਦਬਾਓ।",
    menuBody: "ਤੁਸੀਂ ਆਪਣੀ ਮਸ਼ੀਨ ਦੀ ਤਰੀਕ ਬਾਰੇ ਕੀ ਜਾਣਨਾ ਚਾਹੁੰਦੇ ਹੋ?",
    menuButton: "ਮੀਨੂ",
    menuDate: "ਮੇਰੀ ਤਰੀਕ",
    menuWhy: "ਇਹ ਦਿਨ ਕਿਉਂ",
    menuWait: "ਹੋਰ ਉਡੀਕ ਨਹੀਂ",
    menuPage: "ਮੇਰੇ ਖੇਤਾਂ ਦਾ ਪੰਨਾ",
    menuBook: "ਖੇਤ ਬੁੱਕ ਕਰੋ",
    bookAsk:
      "ਇੱਕ ਸੁਨੇਹੇ ਵਿੱਚ ਦੱਸੋ: ਤੁਹਾਡਾ ਪਿੰਡ, ਕਿੰਨੇ ਏਕੜ, ਅਤੇ ਮਸ਼ੀਨ ਲਈ ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ। ਜੇ ਵਾਢੀ ਅੱਜ ਨਹੀਂ ਤਾਂ ਵਾਢੀ ਦਾ ਦਿਨ ਵੀ ਲਿਖੋ। ਜਿਵੇਂ: ਬਾਲੀਆਂ ਵਿੱਚ 4 ਏਕੜ, ਮੈਂ 3 ਨਵੰਬਰ ਤੱਕ ਉਡੀਕ ਕਰ ਸਕਦਾ ਹਾਂ।",
    bookOnWeb: (url) => `ਇਸ ਪੰਨੇ 'ਤੇ ਆਪਣਾ ਖੇਤ ਬੁੱਕ ਕਰੋ: ${url}\nਲਿੰਕ ਇੱਕ ਵਾਰ, 15 ਮਿੰਟ ਲਈ ਖੁੱਲ੍ਹਦਾ ਹੈ। ਫਿਰ "ਨਵਾਂ ਖੇਤ ਬੁੱਕ ਕਰੋ" ਦਬਾਓ।`,
    bookConfirmBody: (booking) =>
      `ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਬੁਕਿੰਗ ਦੇਖੋ:\nਪਿੰਡ: ${booking.village}\nਖੇਤ: ${booking.acres} ਏਕੜ\nਵਾਢੀ ਤਿਆਰ: ${booking.readyDate}\nਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ: ${booking.lastDay}\nਮਸ਼ੀਨ ਕੇਂਦਰ: ${booking.centre}\n\nਬੁੱਕ ਕਰਨ ਲਈ ਪੁਸ਼ਟੀ ਦਬਾਓ। ਉਸ ਤੋਂ ਪਹਿਲਾਂ ਕੁਝ ਬੁੱਕ ਨਹੀਂ ਹੁੰਦਾ।`,
    booked: (booking) =>
      `ਬੁੱਕ ਹੋ ਗਿਆ। ਤੁਹਾਡਾ ਟੋਕਨ ${booking.token} ਹੈ: ${booking.village} ਵਿੱਚ ${booking.acres} ਏਕੜ, ਵਾਢੀ ਤਿਆਰ ${booking.readyDate}, ਤੁਸੀਂ ${booking.lastDay} ਤੱਕ ਉਡੀਕ ਕਰ ਸਕਦੇ ਹੋ।\n\n${booking.centre} ਦੇ ਆਪਰੇਟਰ ਨੂੰ ਦੱਸ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਜਿਵੇਂ ਹੀ ਆਪਰੇਟਰ ਯੋਜਨਾ ਦੀ ਪੁਸ਼ਟੀ ਕਰੇਗਾ, ਤੁਹਾਨੂੰ ਮਸ਼ੀਨ ਦੀ ਤਰੀਕ ਮਿਲੇਗੀ, ਅਤੇ ਮੈਂ ਇੱਥੇ ਤੁਹਾਡੀ ਵਾਰੀ ਦੇ ਲਿੰਕ ਨਾਲ ਭੇਜਾਂਗਾ।`,
    bookFailed: "ਮੈਂ ਇਹ ਖੇਤ ਬੁੱਕ ਨਹੀਂ ਕਰ ਸਕਿਆ, ਕੁਝ ਵੀ ਬੁੱਕ ਨਹੀਂ ਹੋਇਆ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਪਿੰਡ, ਏਕੜ ਅਤੇ ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ ਫਿਰ ਭੇਜੋ, ਜਾਂ ਆਪਣੇ ਪਿੰਡ ਦੇ ਮਦਦਗਾਰ ਨੂੰ ਪੁੱਛੋ।",
    bookNeeds: (details) => `ਇਹ ਖੇਤ ਬੁੱਕ ਕਰਨ ਲਈ ਮੈਨੂੰ ${details} ਵੀ ਦੱਸੋ। ਜਿਵੇਂ: ਬਾਲੀਆਂ ਵਿੱਚ 4 ਏਕੜ, ਮੈਂ 3 ਨਵੰਬਰ ਤੱਕ ਉਡੀਕ ਕਰ ਸਕਦਾ ਹਾਂ।`,
    bookDetail: { village: "ਤੁਹਾਡਾ ਪਿੰਡ", acres: "ਕਿੰਨੇ ਏਕੜ", lastDay: "ਮਸ਼ੀਨ ਲਈ ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ" },
    bookWhichVillage: (options) => `ਕਿਹੜਾ ਪਿੰਡ? ਕਿਰਪਾ ਕਰਕੇ ਇਹਨਾਂ ਵਿੱਚੋਂ ਇੱਕ ਨਾਮ ਭੇਜੋ:\n${options}`,
    bookUnknownVillage: (named) => `ਵਾਰੀ 'ਤੇ ਕੋਈ ਮਸ਼ੀਨ ਕੇਂਦਰ "${named}" ਨਾਮ ਦੇ ਪਿੰਡ ਦੀ ਸੇਵਾ ਨਹੀਂ ਕਰਦਾ। ਕਿਰਪਾ ਕਰਕੇ ਪਿੰਡ ਦਾ ਨਾਮ ਦੇਖ ਕੇ ਫਿਰ ਭੇਜੋ, ਜਾਂ ਆਪਣੇ ਪਿੰਡ ਦੇ ਮਦਦਗਾਰ ਨੂੰ ਪੁੱਛੋ।`,
    bookBadDay: (maxDays) => `ਮੈਂ ਇਹ ਦਿਨ ਨਹੀਂ ਵਰਤ ਸਕਿਆ। ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ ਅੱਜ ਤੋਂ ਬਾਅਦ, ਅਤੇ ਵਾਢੀ ਤੋਂ ਵੱਧ ਤੋਂ ਵੱਧ ${maxDays} ਦਿਨ ਬਾਅਦ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਭੇਜੋ, ਜਿਵੇਂ: ਮੈਂ 3 ਨਵੰਬਰ ਤੱਕ ਉਡੀਕ ਕਰ ਸਕਦਾ ਹਾਂ।`,
    bookTooMany: "ਇਸ ਨੰਬਰ 'ਤੇ ਪਹਿਲਾਂ ਹੀ ਵਾਰੀ ਵੱਲੋਂ ਮਨਜ਼ੂਰ ਸਭ ਤੋਂ ਵੱਧ ਖੁੱਲ੍ਹੇ ਖੇਤ ਹਨ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੇ ਪਿੰਡ ਦੇ ਮਦਦਗਾਰ ਨੂੰ ਪੁੱਛੋ।",
    noFields: "ਇਸ ਨੰਬਰ 'ਤੇ ਅਜੇ ਕੋਈ ਖੇਤ ਬੁੱਕ ਨਹੀਂ ਹੈ। ਮੀਨੂ ਵਿੱਚ \"ਖੇਤ ਬੁੱਕ ਕਰੋ\" ਦਬਾਓ, ਜਾਂ ਮੈਨੂੰ ਆਪਣਾ ਪਿੰਡ, ਏਕੜ ਅਤੇ ਉਡੀਕ ਦਾ ਆਖਰੀ ਦਿਨ ਦੱਸੋ।",
    fieldNotFound: "ਮੈਨੂੰ ਉਹ ਖੇਤ ਨਹੀਂ ਮਿਲਿਆ। ਆਪਣਾ ਖੇਤ ਚੁਣਨ ਲਈ ਮੀਨੂ ਦਬਾਓ।",
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
    unknownNumber: (registerUrl) => `मुझे वारी पर यह नंबर नहीं मिला। ${registerUrl} पर रजिस्टर करें, या अपने गाँव के सहायक से बुकिंग करवाएँ।`,
    noBookingsYet: (name) => `नमस्ते ${name}। आपका अभी कोई खेत बुक नहीं है। "खेत बुक करें" दबाएँ, मैं यहाँ आपको मशीन की तारीख़ बताऊँगा।`,
    offTopic: "माफ़ कीजिए, मैं सिर्फ़ आपकी मशीन की तारीख़ों और खेत बुक करने में मदद कर सकता हूँ। चुनने के लिए मेन्यू दबाएँ।",
    agentUnavailable: "मैं अभी शब्दों में जवाब नहीं दे सकता। चुनने के लिए मेन्यू दबाएँ।",
    voiceNotSupported: "मैं अभी आवाज़ वाले संदेश नहीं सुन सकता। कृपया लिखें, या मेन्यू दबाएँ।",
    heard: (text) => `मैंने सुना: "${text}"`,
    voiceNotUnderstood: "मैं यह आवाज़ वाला संदेश समझ नहीं सका। कृपया फिर से बोलें, लिखें, या मेन्यू दबाएँ।",
    menuBody: "आप अपनी मशीन की तारीख़ के बारे में क्या जानना चाहते हैं?",
    menuButton: "मेन्यू",
    menuDate: "मेरी तारीख़",
    menuWhy: "यह दिन क्यों",
    menuWait: "और इंतज़ार नहीं",
    menuPage: "मेरे खेतों का पेज",
    menuBook: "खेत बुक करें",
    bookAsk:
      "एक संदेश में बताएँ: आपका गाँव, कितने एकड़, और मशीन के इंतज़ार का आख़िरी दिन। अगर कटाई आज नहीं है तो कटाई का दिन भी लिखें। जैसे: बालियां में 4 एकड़, मैं 3 नवंबर तक इंतज़ार कर सकता हूँ।",
    bookOnWeb: (url) => `इस पेज पर अपना खेत बुक करें: ${url}\nलिंक एक बार, 15 मिनट के लिए खुलता है। फिर "नया खेत बुक करें" दबाएँ।`,
    bookConfirmBody: (booking) =>
      `कृपया अपनी बुकिंग देखें:\nगाँव: ${booking.village}\nखेत: ${booking.acres} एकड़\nकटाई तैयार: ${booking.readyDate}\nइंतज़ार का आख़िरी दिन: ${booking.lastDay}\nमशीन केंद्र: ${booking.centre}\n\nबुक करने के लिए पुष्टि दबाएँ। उससे पहले कुछ बुक नहीं होता।`,
    booked: (booking) =>
      `बुक हो गया। आपका टोकन ${booking.token} है: ${booking.village} में ${booking.acres} एकड़, कटाई तैयार ${booking.readyDate}, आप ${booking.lastDay} तक इंतज़ार कर सकते हैं।\n\n${booking.centre} के ऑपरेटर को बता दिया गया है। जैसे ही ऑपरेटर योजना की पुष्टि करेगा, आपको मशीन की तारीख़ मिलेगी, और मैं यहाँ आपकी बारी के लिंक के साथ भेजूँगा।`,
    bookFailed: "मैं यह खेत बुक नहीं कर सका, कुछ भी बुक नहीं हुआ। कृपया अपना गाँव, एकड़ और इंतज़ार का आख़िरी दिन फिर भेजें, या अपने गाँव के सहायक से पूछें।",
    bookNeeds: (details) => `यह खेत बुक करने के लिए मुझे ${details} भी बताएँ। जैसे: बालियां में 4 एकड़, मैं 3 नवंबर तक इंतज़ार कर सकता हूँ।`,
    bookDetail: { village: "आपका गाँव", acres: "कितने एकड़", lastDay: "मशीन के इंतज़ार का आख़िरी दिन" },
    bookWhichVillage: (options) => `कौन सा गाँव? कृपया इनमें से एक नाम भेजें:\n${options}`,
    bookUnknownVillage: (named) => `वारी पर कोई मशीन केंद्र "${named}" नाम के गाँव की सेवा नहीं करता। कृपया गाँव का नाम देखकर फिर भेजें, या अपने गाँव के सहायक से पूछें।`,
    bookBadDay: (maxDays) => `मैं यह दिन इस्तेमाल नहीं कर सका। इंतज़ार का आख़िरी दिन आज के बाद, और कटाई से ज़्यादा से ज़्यादा ${maxDays} दिन बाद होना चाहिए। कृपया फिर भेजें, जैसे: मैं 3 नवंबर तक इंतज़ार कर सकता हूँ।`,
    bookTooMany: "इस नंबर पर पहले से ही वारी में मंज़ूर सबसे ज़्यादा खुले खेत हैं। कृपया अपने गाँव के सहायक से पूछें।",
    noFields: "इस नंबर पर अभी कोई खेत बुक नहीं है। मेन्यू में \"खेत बुक करें\" दबाएँ, या मुझे अपना गाँव, एकड़ और इंतज़ार का आख़िरी दिन बताएँ।",
    fieldNotFound: "मुझे वह खेत नहीं मिला। अपना खेत चुनने के लिए मेन्यू दबाएँ।",
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
export const MENU_ACTIONS = ["date", "why", "wait", "book", "page"] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];
