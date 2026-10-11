/**
 * The WhatsApp worker: everything after the webhook. For each queued webhook body:
 *   - delivery statuses (sent, delivered, read, failed) update our outbound notices, nothing else;
 *   - each inbound message is handled once (claimed by its WhatsApp id, a conditional write);
 *   - the sender's number (Meta signed the payload) is the identity: normalised to E.164 and looked
 *     up on phone-index and farmer-accounts. Unknown (no booking, no account): one fixed reply with
 *     the registration link, no data, no model. A registered farmer with no field yet can book one;
 *   - known: a FarmerPhone principal, a per-phone rate limit, the reply language (the script the
 *     farmer just wrote in, Latin letters being English, or tapped in; remembered on their farmer
 *     records; else the remembered one, else English), then
 *       a button or list reply -> the tools directly (no model),
 *       text -> the agent when AGENT_ENABLED, with the last few exchanges with this phone (its reply
 *               checked against this turn's tool results, else the template reply; a reply with no
 *               tool call is sent only if it holds no number or date: a question back, or "I can
 *               only help with ..."; a booking that is not ready is always answered by code, with
 *               exactly what is missing or wrong, and the details said so far are kept for 15
 *               minutes), otherwise the menu,
 *       a voice note -> with VOICE_ENABLED and the agent: Transcribe's words (and language) go
 *               through the same agent turn as text, the farmer first reads what was heard, and
 *               Polly reads back what that turn sent as a voice note after the text; otherwise
 *               "please type or tap the menu".
 * A change needs a tap: cannot_wait_longer and book_field draft; only a Confirm button reply naming
 * that draft, from the same phone, within 15 minutes, calls planner.shortenWaitingLimit or books the
 * field (the same checks as /farmer/new). Typed words never do. A booked field waits for the
 * operator's next published plan (their board counts it as a new request); the notice after that
 * approval carries the field's slot link (notices.ts).
 * Logs carry the phone's last 4 digits only, never message text, never tokens.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locale } from "../shared";
import type { FarmerPhonePrincipal } from "../auth/farmer-session";
import { mintFarmerLoginLink } from "../auth/farmer-session";
import { authorize, fieldResource } from "../authz/cedar";
import { bookFieldForPhone } from "../domain/farmer-booking";
import { ConflictError } from "../domain/planner";
import { formatDate } from "../explain/templates";
import { logger } from "../logger";
import type { FarmerAccountRecord, FarmerRecord } from "../store/types";
import type { AgentRunner, Exchange } from "./agent";
import { checkReply } from "./output-check";
import { scriptLocale, storedLanguage, toDevanagari } from "./language";
import { MENU_ACTIONS, promiseWords, words, type MenuAction } from "./messages";
import { parseWebhook, type InboundMessage } from "./payload";
import { fromWhatsAppNumber, maskPhone } from "./phone";
import type { WhatsAppSender } from "./sender";
import { FarmerSession, MAX_WAIT_DAYS, type BookingDetail, type BookingDetails, type BookingProblem, type BookingSoFar, type FarmerToolDeps, type ToolCall } from "./tools";
import { type Heard, type SpeechService } from "./voice";

const DEDUPE_DAYS = 3;
/** Polly takes up to 3,000 billed characters; a spoken reply is cut well before that. */
const SPOKEN_CHARACTERS = 1_500;
/** How much of a conversation the model sees: enough for "which village?" -> "Balian". */
const HISTORY_EXCHANGES = 3;
const HISTORY_MINUTES = 15;
const HISTORY_CHARACTERS = 600;

/** One inbound message being handled: the farmer's words (typed, tapped or heard) and every body sent back. */
type Turn = { farmerWords: string | null; sent: string[] };

/** At most `limit` messages per phone per rolling hour (one worker process; SQS runs one worker). */
export class PhoneRateLimiter {
  private readonly seen = new Map<string, number[]>();
  constructor(private readonly limit: number) {}
  allow(phone: string, now: number): boolean {
    const recent = (this.seen.get(phone) ?? []).filter((at) => now - at < 3_600_000);
    if (recent.length >= this.limit) {
      this.seen.set(phone, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(phone, recent);
    return true;
  }
}

/**
 * Short-lived memory per phone, in this process only (SQS runs one worker): forgotten `minutes` after
 * it was last written, never logged and never written to the store. A restart forgets, and the
 * farmer says it again.
 */
export class PhoneMemory<Value> {
  private readonly byPhone = new Map<string, { value: Value; lastAt: number }>();
  constructor(private readonly minutes: number) {}

  get(phone: string, now: number): Value | undefined {
    const entry = this.byPhone.get(phone);
    return entry && now - entry.lastAt < this.minutes * 60_000 ? entry.value : undefined;
  }

  set(phone: string, value: Value, now: number) {
    // Drop every entry that has gone quiet, so the map only ever holds recent phones.
    for (const [otherPhone, entry] of this.byPhone) if (now - entry.lastAt >= this.minutes * 60_000) this.byPhone.delete(otherPhone);
    this.byPhone.set(phone, { value, lastAt: now });
  }

  delete(phone: string) {
    this.byPhone.delete(phone);
  }
}

/** The last few exchanges with each phone, so the model reads "Balian, 4 acres" as the answer to the question Vaari just asked. */
export class RecentExchanges {
  private readonly memory: PhoneMemory<Exchange[]>;
  constructor(
    private readonly keep: number,
    minutes: number,
  ) {
    this.memory = new PhoneMemory(minutes);
  }

  recent(phone: string, now: number): Exchange[] {
    return this.memory.get(phone, now) ?? [];
  }

  add(phone: string, exchange: Exchange, now: number) {
    this.memory.set(phone, [...this.recent(phone, now), exchange].slice(-this.keep), now);
  }
}

/** Words the number check refused, for the log: names and short numbers as they are, a longer number (a phone?) by its length only. */
const refusedForLog = (unsupported: string[]) => unsupported.slice(0, 10).map((token) => (/^\d[\d.,]{4,}$/.test(token) ? `<${token.length}-digit number>` : token));

/**
 * Words kept for the model's history. One-time login links are replaced: a link must never reach
 * the model (it is a live credential), and the model never needs one.
 */
const forHistory = (text: string) => text.replace(/https?:\/\/\S+/g, "[link]").slice(0, HISTORY_CHARACTERS);

export type WorkerDeps = FarmerToolDeps & { sender: WhatsAppSender; runner: AgentRunner | null; speech?: SpeechService | null; now?: () => Date };

export function createWorker(deps: WorkerDeps) {
  const now = deps.now ?? (() => new Date());
  const limiter = new PhoneRateLimiter(deps.config.WHATSAPP_MESSAGES_PER_PHONE_PER_HOUR);
  const exchanges = new RecentExchanges(HISTORY_EXCHANGES, HISTORY_MINUTES);
  // What a farmer has said so far towards a booking ("4 acres", then "Balian", then "till 3 November").
  const bookings = new PhoneMemory<BookingSoFar>(HISTORY_MINUTES);
  const { store, config } = deps;
  const speech = deps.speech ?? null;

  // While a message is handled, every body sent (text, buttons, list) is also collected on its turn,
  // so the exchange can be remembered and a voice reply says exactly what the farmer can read;
  // every send path stays as it is.
  const currentTurn = new AsyncLocalStorage<Turn>();
  const sender: WhatsAppSender = {
    text: (to, body, options) => (currentTurn.getStore()?.sent.push(body), deps.sender.text(to, body, options)),
    buttons: (to, body, buttons) => (currentTurn.getStore()?.sent.push(body), deps.sender.buttons(to, body, buttons)),
    list: (to, body, buttonLabel, rows) => (currentTurn.getStore()?.sent.push(body), deps.sender.list(to, body, buttonLabel, rows)),
    template: (...args) => deps.sender.template(...args),
    authCode: (...args) => deps.sender.authCode(...args),
    voice: (...args) => deps.sender.voice(...args),
    uploadMedia: (...args) => deps.sender.uploadMedia(...args),
    downloadMedia: (...args) => deps.sender.downloadMedia(...args),
  };

  /** The farmer records behind this phone, the newest booking's first, then the account's own. */
  async function farmerRecords(session: FarmerSession, account: FarmerAccountRecord | null): Promise<FarmerRecord[]> {
    const farmerIds = new Set((await session.fields()).map((entry) => entry.field.farmerId));
    if (account) farmerIds.add(account.farmerId);
    const records = await Promise.all([...farmerIds].map((farmerId) => store.getFarmer(farmerId)));
    return records.filter((record): record is FarmerRecord => record !== null);
  }

  /**
   * A farmer who writes (or taps) in Gurmukhi, Devanagari or Latin letters is answered in Punjabi,
   * Hindi or English from now on, and sent their notices in it, on every farmer record of this phone.
   * A message with no letters ("4", an emoji) changes nothing. A registered farmer whose own farmer
   * record is missing gets one, so the choice is kept.
   */
  async function rememberLanguage(records: FarmerRecord[], account: FarmerAccountRecord | null, written: Locale): Promise<FarmerRecord[]> {
    const own: FarmerRecord[] = account && !records.some((record) => record.id === account.farmerId) ? [{ id: account.farmerId, name: account.name, phone: account.phone, language: written, facilitatorId: null }] : [];
    const remembered = [...records, ...own].map((record) => ({ ...record, language: written, languageChosen: true }));
    for (const [index, record] of remembered.entries()) {
      const before = index < records.length ? records[index]! : null;
      if (!before || before.language !== written || !before.languageChosen) await store.putFarmer(record);
    }
    if (account && account.language !== written) {
      await store.putFarmerAccount({ ...account, language: written });
    }
    return remembered;
  }

  /** The menu: everything for a farmer with fields; only "Book a field" for one without. */
  async function sendMenu(session: FarmerSession, lead?: string) {
    const said = words(session.locale);
    const hasFields = (await session.fields()).length > 0;
    const book = { id: "menu:book", title: said.menuBook };
    const rows = hasFields
      ? [{ id: "menu:date", title: said.menuDate }, { id: "menu:why", title: said.menuWhy }, { id: "menu:wait", title: said.menuWait }, book, { id: "menu:page", title: said.menuPage }]
      : [book];
    await sender.list(session.principal.phone, lead ? `${lead}\n\n${said.menuBody}` : said.menuBody, said.menuButton, rows);
  }

  /** "Book a field" from the menu: ask for the details when the model can read them, else the web form. */
  async function askForBooking(session: FarmerSession) {
    const said = words(session.locale);
    const phone = session.principal.phone;
    // A new booking starts from nothing, whatever was said towards an earlier one.
    bookings.delete(phone);
    if (config.AGENT_ENABLED && deps.runner) return sender.text(phone, said.bookAsk);
    const link = await mintFarmerLoginLink(store, phone, { locale: session.locale });
    // Link previews off: a preview fetch would use up the one-time link.
    return sender.text(phone, said.bookOnWeb(`${config.WEB_BASE_URL.replace(/\/$/, "")}${link.path}`), { previewUrl: false });
  }

  /** A booking's dates in words, for the Confirm and "booked" messages. */
  const bookingWords = (booking: BookingDetails, locale: Locale) => ({ ...booking, readyDate: formatDate(booking.readyDate, locale), lastDay: formatDate(booking.lastDay, locale) });

  /** A booking that drafted nothing, in the farmer's language: exactly what is still missing or wrong. */
  function bookingProblemWords(output: Record<string, unknown>, said: ReturnType<typeof words>): string {
    const missing = (output.missing as BookingDetail[] | undefined) ?? [];
    const suggestions = (output.suggestions as string[] | undefined) ?? [];
    const named = (output.understood as { village?: string | null } | undefined)?.village;
    switch (output.problem as BookingProblem | undefined) {
      case "missingDetails": {
        if (missing.length >= 3) return said.bookAsk;
        const needs = said.bookNeeds(missing.map((detail) => said.bookDetail[detail]).join(", "));
        return suggestions.length > 0 ? `${needs}\n${suggestions.join("\n")}` : needs;
      }
      case "whichVillage":
        return said.bookWhichVillage(suggestions.join("\n"));
      case "unknownVillage":
        return named ? said.bookUnknownVillage(named) : said.bookFailed;
      case "badDate":
        return said.bookBadDay(MAX_WAIT_DAYS);
      case "tooManyFields":
        return said.bookTooMany;
      default:
        return said.bookFailed;
    }
  }

  /** The reply built only from this turn's tool results, with the en/pa/hi sentences in explain/ and messages.ts. */
  function templateReply(calls: ToolCall[], locale: Locale): string {
    const said = words(locale);
    // A booking drafted in this turn is announced by its Confirm message; an earlier call's problem is then moot.
    const drafted = calls.some((call) => call.tool === "book_field" && call.output.needsConfirmation === true);
    const parts: string[] = [];
    for (const call of calls) {
      const output = call.output;
      if (call.tool === "book_field") {
        if (!drafted) parts.push(bookingProblemWords(output, said));
      } else if (typeof output.error === "string") {
        parts.push(call.tool === "cannot_wait_longer" ? said.cannotShorten : call.tool === "send_my_fields_page" ? said.noFields : said.fieldNotFound);
      } else if (call.tool === "list_my_fields") {
        const fields = output.fields as { token: number; village: string; promise: Parameters<typeof promiseWords>[0] }[];
        parts.push(fields.length === 0 ? said.noFields : fields.map((field) => `#${String(field.token).padStart(3, "0")} ${field.village}: ${promiseWords(field.promise, locale)}`).join("\n"));
      } else if (call.tool === "get_slot") {
        parts.push(`${output.sentence as string}\n${said.lastDayYouCanWait(formatDate(output.lastDayYouCanWait as string, locale))}`);
      } else if (call.tool === "why_this_day") {
        parts.push((output.reasons as string[]).map((reason) => `• ${reason}`).join("\n"));
      } else if (call.tool === "send_my_fields_page") {
        parts.push(said.pageSent);
      }
      // cannot_wait_longer: the Confirm message that follows says it all.
    }
    return [...new Set(parts)].join("\n\n");
  }

  /** What the worker does after a turn, never the model: the Confirm buttons, the page link. */
  async function flushPending(session: FarmerSession) {
    const said = words(session.locale);
    const phone = session.principal.phone;
    for (const action of session.pending) {
      if (action.kind === "confirm") {
        await sender.buttons(phone, said.confirmBody(formatDate(action.newLastDay, session.locale)), [
          { id: `confirm:${action.draftId}`, title: said.confirm },
          { id: `cancel:${action.draftId}`, title: said.cancel },
        ]);
      } else if (action.kind === "confirmBooking") {
        await sender.buttons(phone, said.bookConfirmBody(bookingWords(action.booking, session.locale)), [
          { id: `confirm:${action.draftId}`, title: said.confirm },
          { id: `cancel:${action.draftId}`, title: said.cancel },
        ]);
      } else {
        const link = await mintFarmerLoginLink(store, phone, { locale: session.locale });
        // Link previews off: a preview fetch would use up the one-time link.
        await sender.text(phone, said.pageLink(`${config.WEB_BASE_URL.replace(/\/$/, "")}${link.path}`), { previewUrl: false });
      }
    }
    session.pending.length = 0;
  }

  /** The template reply and what follows it; the menu when the turn would otherwise send nothing at all. */
  async function sendCalls(session: FarmerSession) {
    const text = templateReply(session.calls, session.locale);
    if (!text && session.pending.length === 0) return sendMenu(session);
    if (text) await sender.text(session.principal.phone, text);
    await flushPending(session);
  }

  /** A field picker (list message) for an action, or the action at once when there is one field. */
  async function forEachField(session: FarmerSession, action: Exclude<MenuAction, "page" | "book">) {
    const entries = await session.fields();
    if (entries.length === 0) return sendMenu(session);
    if (entries.length === 1) return runAction(session, action, entries[0]!.key);
    const said = words(session.locale);
    const listed = (await session.tool("list_my_fields").run({})).fields as { fieldRef: number; token: number; village: string; promise: Parameters<typeof promiseWords>[0] }[];
    session.calls.length = 0;
    const rows = entries.slice(0, 10).map((entry) => {
      const field = listed.find((item) => item.fieldRef === entry.ref);
      return {
        id: `act:${action}:${entry.key}`,
        title: `#${String(entry.field.token).padStart(3, "0")} ${field?.village ?? ""}`.trim(),
        description: field ? promiseWords(field.promise, session.locale) : "",
      };
    });
    await sender.list(session.principal.phone, said.pickField, said.pickFieldButton, rows);
  }

  async function runAction(session: FarmerSession, action: Exclude<MenuAction, "page" | "book">, key: string) {
    const entry = await session.resolveKey(key);
    const said = words(session.locale);
    if (!entry) return sendMenu(session, said.listOutOfDate);
    if (action === "date") {
      await session.tool("get_slot").run({ fieldRef: entry.ref });
      return sendCalls(session);
    }
    if (action === "why") {
      await session.tool("why_this_day").run({ fieldRef: entry.ref });
      return sendCalls(session);
    }
    // wait: offer shorter waits, each with its new last day.
    const field = entry.field;
    if (field.state === "done" || field.waitingLimitDays <= 1) return sender.text(session.principal.phone, said.cannotShorten);
    const rows = [];
    for (let days = field.waitingLimitDays - 1; days >= 1 && rows.length < 10; days -= 1) {
      rows.push({ id: `wait:${entry.key}:${days}`, title: said.daysRow(days), description: said.daysRowDetail(formatDate(deps.planner.dayToIso(field.readyDay + days), session.locale)) });
    }
    await sender.list(session.principal.phone, said.pickDays(formatDate(deps.planner.dayToIso(field.readyDay + field.waitingLimitDays), session.locale)), said.pickDaysButton, rows);
  }

  /** Button and list replies: our own ids, run without the model. */
  async function handleReply(session: FarmerSession, replyId: string) {
    const phone = session.principal.phone;
    const said = words(session.locale);
    const [kind, first, second] = replyId.split(":");

    if (kind === "menu" && (MENU_ACTIONS as readonly string[]).includes(first ?? "")) {
      if (first === "page") {
        await session.tool("send_my_fields_page").run({});
        return sendCalls(session);
      }
      if (first === "book") return askForBooking(session);
      return forEachField(session, first as Exclude<MenuAction, "page" | "book">);
    }
    if (kind === "act" && (first === "date" || first === "why" || first === "wait") && second) return runAction(session, first, second);
    if (kind === "wait" && first && second && /^\d+$/.test(second)) {
      const entry = await session.resolveKey(first);
      if (!entry) return sendMenu(session, said.listOutOfDate);
      await session.tool("cannot_wait_longer").run({ fieldRef: entry.ref, days: Number(second) });
      return sendCalls(session);
    }
    if (kind === "confirm" && first) {
      const draft = await store.useWhatsAppDraft(first, phone, now().toISOString());
      if (!draft) return sender.text(phone, said.expired);
      if (draft.booking) {
        // Every check again (another field may have been booked since the draft), then the booking.
        const booked = await bookFieldForPhone(deps, session.principal, draft.booking, session.locale);
        if (!booked.ok) return sender.text(phone, said.bookFailed);
        const village = deps.planner.villages().find((item) => item.id === booked.field.villageId);
        const villageName = session.locale === "pa" && village?.namePa ? village.namePa : (village?.name ?? booked.field.villageId);
        const lastDay = deps.planner.dayToIso(booked.field.readyDay + booked.field.waitingLimitDays);
        logger.info({ phone: maskPhone(phone), chcId: booked.chc.id }, "whatsapp booking made");
        return sender.text(
          phone,
          said.booked({
            ...bookingWords({ village: villageName, centre: booked.chc.name, acres: booked.field.acres, readyDate: draft.booking.readyDate, lastDay }, session.locale),
            token: `#${String(booked.field.token).padStart(3, "0")}`,
          }),
        );
      }
      const field = await store.getField(draft.chcId, draft.fieldId);
      // The draft names a field; this phone must still be allowed to change it.
      if (!field || !authorize(session.principal, "RequestSooner", fieldResource(field)).allowed) return sender.text(phone, said.cannotShorten);
      try {
        const updated = await deps.planner.shortenWaitingLimit(field.chcId, field.id, draft.waitingLimitDays);
        return sender.text(phone, said.done(formatDate(deps.planner.dayToIso(updated.readyDay + updated.waitingLimitDays), session.locale)));
      } catch (error) {
        if (error instanceof ConflictError) return sender.text(phone, said.cannotShorten);
        throw error;
      }
    }
    if (kind === "cancel" && first) {
      await store.useWhatsAppDraft(first, phone, now().toISOString());
      return sender.text(phone, said.cancelled);
    }
    return sendMenu(session);
  }

  /**
   * One message through the agent; returns which path answered, for the "whatsapp message handled"
   * log line. `noFieldsLead`: what a registered farmer with no field yet reads above the menu.
   */
  async function agentTurn(session: FarmerSession, text: string, noFieldsLead: string | null): Promise<string> {
    const phone = session.principal.phone;
    const said = words(session.locale);
    const startedAt = now().getTime();
    session.bookingSoFar = bookings.get(phone, startedAt) ?? {};
    let reply: string | null = null;
    let failed = false;
    try {
      reply = await deps.runner!.run({ text, locale: session.locale, tools: session.tools(), history: exchanges.recent(phone, startedAt) });
    } catch (error) {
      failed = true;
      // Bedrock's error names the problem (AccessDeniedException, ThrottlingException, a timeout);
      // it never echoes the farmer's words.
      logger.warn({ phone: maskPhone(phone), err: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }, "whatsapp agent failed; template reply");
    }
    // The booking details so far outlive the turn; none left (drafted, or never started): forgotten.
    if (session.calls.some((call) => call.tool === "book_field")) {
      if (Object.keys(session.bookingSoFar).length > 0) bookings.set(phone, session.bookingSoFar, startedAt);
      else bookings.delete(phone);
    }

    if (session.calls.length === 0) {
      // No tool, no facts. With no tool result the check allows no number or date at all, so a reply
      // that passes is a question back or "I can only help with ...": sent as it is. Otherwise the
      // model failed or wrote a number or date of its own: the menu (a farmer with no field yet is
      // shown how to book one), and the log says why.
      const check = reply ? checkReply(reply, []) : null;
      if (reply && check?.ok) {
        await sender.text(phone, reply);
        return "agent: its reply (no tool)";
      }
      if (!failed) logger.warn({ phone: maskPhone(phone), empty: !reply, refused: refusedForLog(check?.unsupported ?? []) }, "whatsapp agent reply without a tool was not usable; menu");
      await sendMenu(session, failed ? said.agentUnavailable : (noFieldsLead ?? said.offTopic));
      return failed ? "agent failed: menu" : "agent: menu (no tool, reply not usable)";
    }
    // A drafted change or booking is announced only by our own Confirm message: the model's words
    // could say "done" for something that has not happened, and that is not a number the check could catch.
    if (session.pending.some((action) => action.kind === "confirm" || action.kind === "confirmBooking")) {
      await sendCalls(session);
      return "agent: Confirm buttons";
    }
    // A booking that is not ready: code says exactly what is missing or wrong (with its example),
    // never the model, whose question could carry a number of its own and be refused.
    if (session.calls.some((call) => call.tool === "book_field")) {
      await sendCalls(session);
      return `agent: booking (${session.calls.filter((call) => call.tool === "book_field").map((call) => String(call.output.problem)).join(", ")})`;
    }
    const check = reply ? checkReply(reply, session.calls) : { ok: false, unsupported: [] };
    if (reply && check.ok) {
      await sender.text(phone, reply);
      await flushPending(session);
      return "agent: its reply";
    }
    if (reply) logger.warn({ phone: maskPhone(phone), refused: refusedForLog(check.unsupported) }, "whatsapp agent reply failed the number check; template reply");
    await sendCalls(session);
    return failed ? "agent failed: template reply" : "agent: template reply";
  }

  /** Polly reads what a voice turn sent, as a voice note. A failure leaves the text the farmer already has. */
  async function speakReply(session: FarmerSession, spoken: string[]): Promise<boolean> {
    if (!speech || (session.locale === "pa" && !config.VOICE_PUNJABI_AUDIO)) return false;
    // Links are for tapping, not hearing; "#007" is said as "007"; bullets are not said.
    const text = spoken
      .join("\n\n")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/#(\d)/g, "$1")
      .replace(/•/g, "")
      .trim()
      .slice(0, SPOKEN_CHARACTERS);
    if (!text) return false;
    try {
      const audio = await speech.speak(session.locale === "pa" ? toDevanagari(text) : text, session.locale === "en" ? "en-IN" : "hi-IN");
      await sender.voice(session.principal.phone, await sender.uploadMedia(audio, "audio/ogg"));
      return true;
    } catch (error) {
      logger.warn({ phone: maskPhone(session.principal.phone), err: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }, "whatsapp voice reply failed; the text reply stands");
      return false;
    }
  }

  /**
   * A voice note: Transcribe's words go through the same agent turn as typed text, in the language it
   * heard. The farmer first reads what was heard (a misheard word shows, and a booking or change still
   * needs their Confirm tap); then the turn's replies; then the same replies spoken.
   */
  async function voiceTurn(message: InboundMessage, principal: FarmerPhonePrincipal, fallback: Locale, account: FarmerAccountRecord | null): Promise<string> {
    const phone = principal.phone;
    let heard: Heard | null = null;
    try {
      const media = await sender.downloadMedia(message.mediaId ?? "", config.VOICE_MAX_BYTES);
      heard = await speech!.transcribe(media.bytes, message.id);
    } catch (error) {
      logger.warn({ phone: maskPhone(phone), err: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }, "whatsapp voice note not transcribed");
    }
    const session = new FarmerSession(deps, principal, heard?.locale ?? fallback, now);
    const said = words(session.locale);
    if (!heard) {
      await sendMenu(session, said.voiceNotUnderstood);
      return "voice note: not understood; sent the menu";
    }
    const found = await farmerRecords(session, account);
    await rememberLanguage(found, account, heard.locale);
    const heardText = heard.text;
    await sender.text(phone, said.heard(heardText));
    // The answer starts after "I heard": only the answer is spoken, and remembered with the heard words.
    const turn = currentTurn.getStore()!;
    turn.farmerWords = heardText;
    turn.sent.length = 0;
    const answered = await agentTurn(session, heardText, account ? said.noBookingsYet(account.name) : null);
    const voiced = await speakReply(session, turn.sent);
    return `voice note (${heard.locale}), ${answered}${voiced ? ", spoken" : ", text only"}`;
  }

  /** Handles one message; returns what was done, for the "whatsapp message handled" log line. */
  async function handleMessage(message: InboundMessage): Promise<string> {
    const at = now();
    const claimed = await store.claimInboundMessage(message.id, at.toISOString(), new Date(at.getTime() + DEDUPE_DAYS * 86_400_000).toISOString());
    if (!claimed) return "skipped: already handled (Meta delivered it again)";
    const phone = fromWhatsAppNumber(message.sender);
    // No sender number: nobody to answer and nothing to look up.
    if (!phone) return "dropped: no sender number in the payload";
    const principal: FarmerPhonePrincipal = { kind: "farmerPhone", phone };
    const probe = new FarmerSession(deps, principal, "en", now);
    const hasFields = (await probe.fields()).length > 0;
    const account = hasFields ? null : await store.getFarmerAccount(phone);
    if (!hasFields && !account) {
      // Never seen: one fixed reply, and the model is never called. Registering (name and their own
      // consent) happens on the web, or their village helper books for them.
      const web = config.WEB_BASE_URL.replace(/\/$/, "");
      await sender.text(phone, words(scriptLocale(message.text) ?? "en").unknownNumber(`${web}/farmer/signin`), { previewUrl: false });
      return "unknown number (no field, no account): sent the registration link";
    }
    if (!limiter.allow(phone, at.getTime())) return `dropped: over ${config.WHATSAPP_MESSAGES_PER_PHONE_PER_HOUR} messages this hour`;
    const written = scriptLocale(message.text, message.kind === "text");
    const found = await farmerRecords(probe, account);
    const records = written ? await rememberLanguage(found, account, written) : found;
    const session = new FarmerSession(deps, principal, written ?? storedLanguage(records, account) ?? "en", now);

    const turn: Turn = { farmerWords: message.text, sent: [] };
    const outcome = await currentTurn.run(turn, () => answer(message, session, account));
    if (turn.farmerWords && turn.sent.length > 0) {
      exchanges.add(phone, { farmer: forHistory(turn.farmerWords), vaari: forHistory(turn.sent.join("\n\n")) }, at.getTime());
    }
    return outcome;
  }

  /** A known phone's message, by kind; returns what was done. */
  async function answer(message: InboundMessage, session: FarmerSession, account: FarmerAccountRecord | null): Promise<string> {
    const noFieldsLead = account ? words(session.locale).noBookingsYet(account.name) : null;
    if (message.kind === "reply" && message.replyId) {
      await handleReply(session, message.replyId);
      return `answered button/list reply ${message.replyId.split(":")[0]}`;
    }
    if (message.kind === "text" && message.text) {
      if (config.AGENT_ENABLED && deps.runner) {
        return `text, ${await agentTurn(session, message.text, noFieldsLead)}`;
      }
      await sendMenu(session, noFieldsLead ?? undefined);
      return "answered text with the menu (AGENT_ENABLED=false)";
    }
    if (message.kind === "audio") {
      if (config.VOICE_ENABLED && speech && config.AGENT_ENABLED && deps.runner && message.mediaId) {
        return voiceTurn(message, session.principal, session.locale, account);
      }
      await sendMenu(session, words(session.locale).voiceNotSupported);
      return "voice note: sent 'please type' and the menu";
    }
    await sendMenu(session, noFieldsLead ?? undefined);
    return `answered ${message.kind} message with the menu`;
  }

  return {
    /** One queued webhook body. Never throws for one bad message; the rest are still handled. */
    async handle(body: string) {
      // The season's today may have moved since the last message.
      await deps.planner.refreshClock().catch(() => undefined);
      let parsed;
      try {
        parsed = parseWebhook(body);
      } catch (error) {
        logger.warn({ err: error instanceof Error ? error.name : "unknown" }, "whatsapp webhook body was not a WhatsApp payload; dropped");
        return;
      }
      for (const status of parsed.statuses) {
        // Meta's verdict on a message we sent; "failed" carries its error code and title.
        if (status.status === "failed") logger.warn({ messageId: status.messageId, error: status.error }, "whatsapp delivery failed");
        else logger.info({ messageId: status.messageId, status: status.status }, "whatsapp delivery status");
        await store.setNoticeStatus(status.messageId, status.status, status.at, status.error);
      }
      for (const message of parsed.messages) {
        const started = Date.now();
        const context = { messageId: message.id, phone: maskPhone(fromWhatsAppNumber(message.sender)), kind: message.kind };
        try {
          const outcome = await handleMessage(message);
          logger.info({ ...context, outcome, ms: Date.now() - started }, "whatsapp message handled");
        } catch (error) {
          logger.error({ ...context, err: error, ms: Date.now() - started }, "whatsapp message failed");
        }
      }
    },
  };
}

export type WhatsAppWorker = ReturnType<typeof createWorker>;
