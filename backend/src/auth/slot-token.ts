/**
 * Farmer slot links: a signed token that opens one field's turn without an account. The token
 * carries chcId and fieldId, which are exactly the fields table's keys, so opening a slot is one
 * GetItem. Signed with SLOT_TOKEN_SECRET (separate from sessions); read-only by design.
 */
import { SignJWT, jwtVerify } from "jose";
import type { Config } from "../config";
import { AuthError } from "./tokens";

const SLOT_ISSUER = "vaari";
const SLOT_AUDIENCE = "vaari-slot";
const SLOT_LIFETIME = "60d"; // covers a sowing season

export type SlotClaims = { chcId: string; fieldId: string };

const secretOf = (config: Config) => new TextEncoder().encode(config.SLOT_TOKEN_SECRET);

export async function mintSlotToken(config: Config, claims: SlotClaims): Promise<string> {
  return new SignJWT({ typ: "slot", chc: claims.chcId, fld: claims.fieldId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SLOT_ISSUER)
    .setAudience(SLOT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(SLOT_LIFETIME)
    .sign(secretOf(config));
}

export async function verifySlotToken(config: Config, token: string): Promise<SlotClaims> {
  try {
    const { payload } = await jwtVerify(token, secretOf(config), { issuer: SLOT_ISSUER, audience: SLOT_AUDIENCE });
    if (payload.typ !== "slot" || typeof payload.chc !== "string" || typeof payload.fld !== "string") throw new Error("not a slot token");
    return { chcId: payload.chc, fieldId: payload.fld };
  } catch {
    throw new AuthError("invalid slot link");
  }
}
