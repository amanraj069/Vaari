/**
 * On WhatsApp the sender's number is the identity. Meta sends it as digits with the country code and
 * no "+" ("919876543210" in `from` and `contacts[].wa_id`); our store keeps E.164 ("+919876543210").
 */
import { toE164 } from "../shared";

/** The sender's number in E.164, or null when there is none or it is not a phone number. */
export function fromWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const direct = toE164(raw);
  if (direct) return direct;
  const digits = raw.replace(/\D/g, "");
  return digits ? toE164(`+${digits}`) : null;
}

/** For logs: the last 4 digits only. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

/** Meta's "to" field: digits with the country code, no "+". */
export const toWhatsAppNumber = (e164: string) => e164.replace(/\D/g, "");
