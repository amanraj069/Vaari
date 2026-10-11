/** Phone numbers as Meta sends them, masking for logs, the reply language, and payload parsing. */
import { describe, expect, it } from "vitest";
import { scriptLocale, storedLanguage } from "../src/whatsapp/language";
import { parseWebhook } from "../src/whatsapp/payload";
import { fromWhatsAppNumber, maskPhone, toWhatsAppNumber } from "../src/whatsapp/phone";
import { PhoneRateLimiter } from "../src/whatsapp/worker";
import { messageBody, statusBody } from "./whatsapp-helpers";

describe("the sender's number", () => {
  it("normalises the formats Meta sends (digits with country code, no '+') to E.164", () => {
    expect(fromWhatsAppNumber("919876543210")).toBe("+919876543210");
    expect(fromWhatsAppNumber("447700900017")).toBe("+447700900017");
    expect(fromWhatsAppNumber("12025550143")).toBe("+12025550143");
    expect(fromWhatsAppNumber("+919876543210")).toBe("+919876543210");
    expect(fromWhatsAppNumber(" 91 98765 43210 ")).toBe("+919876543210");
  });

  it("is null when there is no number or it is not one", () => {
    for (const raw of [undefined, null, "", "   ", "abc", "12345", "910123456789"]) expect(fromWhatsAppNumber(raw)).toBeNull();
  });

  it("goes back to Meta as digits, and into logs as its last 4 digits only", () => {
    expect(toWhatsAppNumber("+919876543210")).toBe("919876543210");
    expect(maskPhone("+919876543210")).toBe("***3210");
    expect(maskPhone(null)).toBe("***");
  });
});

describe("the reply language", () => {
  it("stored: only a language the farmer chose counts (an old booking's Punjabi default does not)", () => {
    const record = (id: string, language: "en" | "hi" | "pa", languageChosen?: boolean) => ({ id, name: "A", phone: "+919876543210", language, languageChosen, facilitatorId: null });
    const account = { phone: "+919876543210", farmerId: "own", name: "A", language: "hi" as const, consentAt: "", consentBy: "farmer", createdAt: "" };
    expect(storedLanguage([record("old", "pa")], null)).toBeNull();
    expect(storedLanguage([record("old", "pa"), record("wrote", "hi", true)], null)).toBe("hi");
    expect(storedLanguage([record("own", "pa")], account)).toBe("hi"); // registered in Hindi; the record's default ignored
    expect(storedLanguage([record("own", "en", true)], account)).toBe("en"); // then wrote in English
    expect(storedLanguage([], account)).toBe("hi");
  });

  it("is the script the farmer just wrote in: Gurmukhi, Devanagari or Latin letters", () => {
    expect(scriptLocale("ਮੇਰੀ ਤਰੀਕ")).toBe("pa");
    expect(scriptLocale("मेरी तारीख़")).toBe("hi");
    expect(scriptLocale("my date")).toBe("en");
    expect(scriptLocale("Sat Shri Kal")).toBe("en");
    expect(scriptLocale("Balian, 30 नवंबर तक")).toBe("hi");
    // A tapped row's title: Latin letters (a village's name in a Punjabi list) do not count.
    expect(scriptLocale("#035 Balian", false)).toBeNull();
    expect(scriptLocale("खेत बुक करें", false)).toBe("hi");
    // No letters at all: no language.
    expect(scriptLocale("4")).toBeNull();
    expect(scriptLocale("🙏")).toBeNull();
    expect(scriptLocale(null)).toBeNull();
  });
});

describe("webhook payloads", () => {
  it("reads text, button and list replies, voice notes and the sender (from, else wa_id)", () => {
    expect(parseWebhook(messageBody({ id: "m1", from: "447700900017", text: "hi" })).messages).toEqual([{ id: "m1", sender: "447700900017", kind: "text", text: "hi", replyId: null, mediaId: null }]);
    expect(parseWebhook(messageBody({ id: "m2", button: "confirm:abc" })).messages[0]).toMatchObject({ kind: "reply", replyId: "confirm:abc" });
    expect(parseWebhook(messageBody({ id: "m3", listRow: "menu:date" })).messages[0]).toMatchObject({ kind: "reply", replyId: "menu:date" });
    expect(parseWebhook(messageBody({ id: "m4", audio: true })).messages[0]).toMatchObject({ kind: "audio", mediaId: "media-1" });
    expect(parseWebhook(messageBody({ id: "m5", from: null })).messages[0]?.sender).toBeNull();
  });

  it("reads delivery statuses with their time", () => {
    expect(parseWebhook(statusBody("wamid.x", "delivered", 1_793_000_000)).statuses).toEqual([
      { messageId: "wamid.x", status: "delivered", at: new Date(1_793_000_000_000).toISOString(), error: null },
    ]);
  });

  it("refuses a body that is not a WhatsApp payload", () => {
    expect(() => parseWebhook("{}")).toThrow();
    expect(() => parseWebhook("not json")).toThrow();
  });
});

describe("per-phone rate limit", () => {
  it("allows the limit per rolling hour, per phone", () => {
    const limiter = new PhoneRateLimiter(2);
    expect([limiter.allow("+447700900017", 0), limiter.allow("+447700900017", 1), limiter.allow("+447700900017", 2)]).toEqual([true, true, false]);
    expect(limiter.allow("+447700900018", 2)).toBe(true);
    expect(limiter.allow("+447700900017", 3_600_001)).toBe(true);
  });
});
