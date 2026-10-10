/**
 * The WhatsApp worker: everything after the webhook. For each queued webhook body:
 *   - delivery statuses (sent, delivered, read, failed) update our outbound notices, nothing else;
 *   - each inbound message is handled once (claimed by its WhatsApp id, a conditional write);
 *   - the sender's number (Meta signed the payload) is the identity: normalised to E.164 and looked
 *     up on phone-index and farmer-accounts. Unknown (no booking, no account): one fixed reply with
 *     the registration link, no data, no model. A registered farmer with no field yet can book one;
 *   - known: a FarmerPhone principal, a per-phone rate limit, the reply language, then
 *       a button or list reply -> the tools directly (no model),
 *       text -> the agent when AGENT_ENABLED (its reply checked against this turn's tool results,
 *               else the template reply), otherwise the menu,
 *       a voice note -> "please type or tap the menu" (transcription is not built).
 * A change needs a tap: cannot_wait_longer and book_field draft; only a Confirm button reply naming
 * that draft, from the same phone, within 15 minutes, calls planner.shortenWaitingLimit or books the
 * field (the same checks as /farmer/new). Typed words never do. A booked field waits for the
 * operator's next published plan (their board counts it as a new request); the notice after that
 * approval carries the field's slot link (notices.ts).
 * Logs carry the phone's last 4 digits only, never message text, never tokens.
 */
import type { Locale } from "../shared";
import type { FarmerPhonePrincipal } from "../auth/farmer-session";
import { mintFarmerLoginLink } from "../auth/farmer-session";
import { authorize, fieldResource } from "../authz/cedar";
import { bookFieldForPhone } from "../domain/farmer-booking";
import { ConflictError } from "../domain/planner";
import { formatDate } from "../explain/templates";
import { logger } from "../logger";
import type { AgentRunner } from "./agent";
import { checkReply } from "./output-check";
import { chooseLocale, scriptLocale } from "./language";
import { MENU_ACTIONS, promiseWords, words, type MenuAction } from "./messages";
import { parseWebhook, type InboundMessage } from "./payload";
import { fromWhatsAppNumber, maskPhone } from "./phone";
import type { WhatsAppSender } from "./sender";
import { FarmerSession, type BookingDetails, type FarmerToolDeps, type ToolCall } from "./tools";

const DEDUPE_DAYS = 3;

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

export type WorkerDeps = FarmerToolDeps & { sender: WhatsAppSender; runner: AgentRunner | null; now?: () => Date };

export function createWorker(deps: WorkerDeps) {
  const now = deps.now ?? (() => new Date());
  const limiter = new PhoneRateLimiter(deps.config.WHATSAPP_MESSAGES_PER_PHONE_PER_HOUR);
  const { sender, store, config } = deps;

  async function storedLanguage(session: FarmerSession, accountLanguage: Locale | null): Promise<Locale | null> {
    const newest = (await session.fields())[0];
    return (newest ? ((await store.getFarmer(newest.field.farmerId))?.language ?? null) : null) ?? accountLanguage;
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
    if (config.AGENT_ENABLED && deps.runner) return sender.text(phone, said.bookAsk);
    const link = await mintFarmerLoginLink(config, store, phone);
    // Link previews off: a preview fetch would use up the one-time link.
    return sender.text(phone, said.bookOnWeb(`${config.WEB_BASE_URL.replace(/\/$/, "")}${link.path}`), { previewUrl: false });
  }

  /** A booking's dates in words, for the Confirm and "booked" messages. */
  const bookingWords = (booking: BookingDetails, locale: Locale) => ({ ...booking, readyDate: formatDate(booking.readyDate, locale), lastDay: formatDate(booking.lastDay, locale) });

  /** The reply built only from this turn's tool results, with the en/pa/hi sentences in explain/. */
  function templateReply(calls: ToolCall[], locale: Locale): string {
    const said = words(locale);
    const parts: string[] = [];
    for (const call of calls) {
      const output = call.output;
      if (typeof output.error === "string") {
        parts.push(call.tool === "book_field" ? said.bookFailed : said.cannotShorten);
      } else if (call.tool === "list_my_fields") {
        const fields = output.fields as { token: number; village: string; promise: Parameters<typeof promiseWords>[0] }[];
        parts.push(fields.map((field) => `#${String(field.token).padStart(3, "0")} ${field.village}: ${promiseWords(field.promise, locale)}`).join("\n"));
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
        const link = await mintFarmerLoginLink(config, store, phone);
        // Link previews off: a preview fetch would use up the one-time link.
        await sender.text(phone, said.pageLink(`${config.WEB_BASE_URL.replace(/\/$/, "")}${link.path}`), { previewUrl: false });
      }
    }
    session.pending.length = 0;
  }

  async function sendCalls(session: FarmerSession) {
    const text = templateReply(session.calls, session.locale);
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

  /** `noFieldsLead`: what a registered farmer with no field yet reads above the menu. */
  async function agentTurn(session: FarmerSession, text: string, noFieldsLead: string | null) {
    const phone = session.principal.phone;
    const said = words(session.locale);
    let reply: string | null = null;
    let failed = false;
    try {
      reply = await deps.runner!.run({ text, locale: session.locale, tools: session.tools() });
    } catch (error) {
      failed = true;
      // Bedrock's error names the problem (AccessDeniedException, ThrottlingException, a timeout);
      // it never echoes the farmer's words.
      logger.warn({ phone: maskPhone(phone), err: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }, "whatsapp agent failed; template reply");
    }
    if (session.calls.length === 0) {
      // No tool, no facts: either the model failed, or the question was not about their dates (a
      // farmer with no field yet is shown how to book one).
      return sendMenu(session, failed ? said.agentUnavailable : (noFieldsLead ?? said.offTopic));
    }
    // A drafted change or booking is announced only by our own Confirm message: the model's words
    // could say "done" for something that has not happened, and that is not a number the check could catch.
    if (session.pending.some((action) => action.kind === "confirm" || action.kind === "confirmBooking")) return sendCalls(session);
    const check = reply ? checkReply(reply, session.calls) : { ok: false, unsupported: [] };
    if (reply && check.ok) {
      await sender.text(phone, reply);
      return flushPending(session);
    }
    if (reply) logger.warn({ phone: maskPhone(phone), unsupported: check.unsupported.length }, "whatsapp agent reply failed the number check; template reply");
    return sendCalls(session);
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
    const session = new FarmerSession(deps, principal, chooseLocale(await storedLanguage(probe, account?.language ?? null), message.text), now);
    const noFieldsLead = account ? words(session.locale).noBookingsYet(account.name) : null;
    if (message.kind === "reply" && message.replyId) {
      await handleReply(session, message.replyId);
      return `answered button/list reply ${message.replyId.split(":")[0]}`;
    }
    if (message.kind === "text" && message.text) {
      if (config.AGENT_ENABLED && deps.runner) {
        await agentTurn(session, message.text, noFieldsLead);
        return "answered text with the agent";
      }
      await sendMenu(session, noFieldsLead ?? undefined);
      return "answered text with the menu (AGENT_ENABLED=false)";
    }
    if (message.kind === "audio") {
      await sendMenu(session, words(session.locale).voiceNotSupported);
      return "voice note: sent 'please type' and the menu";
    }
    await sendMenu(session, noFieldsLead ?? undefined);
    return `answered ${message.kind} message with the menu`;
  }

  return {
    /** One queued webhook body. Never throws for one bad message; the rest are still handled. */
    async handle(body: string) {
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
