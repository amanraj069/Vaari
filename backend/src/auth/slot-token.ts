/**
 * Farmer slot links: a signed token that opens one field's turn without an account. The token
 * carries chcId and fieldId, which are exactly the fields table's keys, so opening a slot is one
 * GetItem, and the field's linkVersion, so a helper can reissue a link and every older one stops
 * working. It expires 7 days after the season ends (SEASON_END_DATE). Signed with
 * SLOT_TOKEN_SECRET (separate from demo sessions).
 *
 * What a slot link may do (and nothing else): read its field and its "why", and shorten the
 * farmer's waiting limit ("I cannot wait longer"). It never sees a phone number.
 */
import { SignJWT, jwtVerify } from "jose";
import type { Config } from "../config";
import type { FieldRecord } from "../store/types";
import { AuthError } from "./tokens";

const SLOT_ISSUER = "vaari";
const SLOT_AUDIENCE = "vaari-slot";
const DAYS_AFTER_SEASON = 7;

export type SlotClaims = { chcId: string; fieldId: string; linkVersion: number };

const secretOf = (config: Config) => new TextEncoder().encode(config.SLOT_TOKEN_SECRET);

/** Seconds since the epoch at the end (UTC) of the 7th day after SEASON_END_DATE. */
export function slotLinkExpiry(config: Config): number {
  const seasonEnd = Date.parse(`${config.SEASON_END_DATE}T00:00:00Z`);
  return Math.floor((seasonEnd + (DAYS_AFTER_SEASON + 1) * 86_400_000) / 1000) - 1;
}

export async function mintSlotToken(config: Config, field: Pick<FieldRecord, "chcId" | "id" | "linkVersion">): Promise<string> {
  return new SignJWT({ typ: "slot", chc: field.chcId, fld: field.id, ver: field.linkVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SLOT_ISSUER)
    .setAudience(SLOT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(slotLinkExpiry(config))
    .sign(secretOf(config));
}

/** Signature, issuer, audience, expiry and shape. The caller still compares the link version. */
export async function verifySlotToken(config: Config, token: string): Promise<SlotClaims> {
  try {
    const { payload } = await jwtVerify(token, secretOf(config), { issuer: SLOT_ISSUER, audience: SLOT_AUDIENCE, algorithms: ["HS256"] });
    if (payload.typ !== "slot" || typeof payload.chc !== "string" || typeof payload.fld !== "string" || !Number.isInteger(payload.ver)) {
      throw new Error("not a slot token");
    }
    return { chcId: payload.chc, fieldId: payload.fld, linkVersion: payload.ver as number };
  } catch {
    throw new AuthError("invalid slot link");
  }
}

/** A link minted before the field's latest reissue is refused like a tampered one (401). */
export function assertCurrentLink(claims: SlotClaims, field: FieldRecord): void {
  if (claims.linkVersion !== field.linkVersion) throw new AuthError("slot link was reissued");
}
