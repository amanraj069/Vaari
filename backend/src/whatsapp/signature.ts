/**
 * Meta signs every webhook POST: X-Hub-Signature-256 is "sha256=" + the hex HMAC-SHA256 of the RAW
 * request body, keyed with the app secret. A body that was parsed and re-serialised would not match,
 * so this runs on the bytes as received. No secret configured: nothing is valid.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function validSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const sent = Buffer.from(header.slice("sha256=".length), "hex");
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

/** For tests and local tools: the header Meta would send for this body. */
export function signatureFor(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}
