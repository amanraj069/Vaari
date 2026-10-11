/**
 * A farmer is their phone number. To see all their fields they get a one-time login link (on
 * WhatsApp from the bot; for the demo farmer, from the "Try as farmer" button), which the web exchanges for
 * a 7-day session scoped to that phone, or they sign in on the web with a one-time code
 * (auth/farmer-otp.ts), which ends in the same session.
 *
 *   login link    /farmer/login/<16 random characters> (96 bits), 15 minutes, usable once. Only a
 *                 SHA-256 of it is stored, with the phone and the language the link was sent in;
 *                 using it is a conditional write, so a replayed or forwarded link fails. Short on
 *                 purpose: it is read on a phone in WhatsApp, and a signed token (all the facts in
 *                 the link itself) made it over 300 characters when the store holds them anyway.
 *   session token typ "farmer-session", phone, 7 days, signed with SLOT_TOKEN_SECRET and its own
 *                 audience (so no other token works as one); it can only read fields with that
 *                 phone (Cedar FarmerPhone principal), never act on them
 *
 * When the bot sends a login link it must turn link previews off (preview_url: false): a preview
 * fetch would use up the link before the farmer taps it.
 */
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { toE164, type Locale } from "../shared";
import type { Config } from "../config";
import type { VaariStore } from "../store/types";
import { AuthError } from "./tokens";

const ISSUER = "vaari";
const SESSION_AUDIENCE = "vaari-farmer-session";
/** 12 random bytes: 16 URL-safe characters. */
const LOGIN_TOKEN_BYTES = 12;
const LOGIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const FARMER_LOGIN_SECONDS = 15 * 60;
export const FARMER_SESSION_SECONDS = 7 * 24 * 60 * 60;

/** Who a farmer session is: a phone number, nothing else. */
export type FarmerPhonePrincipal = { kind: "farmerPhone"; phone: string };

const secretOf = (config: Config) => new TextEncoder().encode(config.SLOT_TOKEN_SECRET);

/** The stored key of a login link: its SHA-256, so the table cannot be read back into working links. */
const loginKey = (token: string) => createHash("sha256").update(token).digest("base64url");

/**
 * The internal function that mints a farmer's login link. The WhatsApp worker calls it when a farmer
 * asks for their fields page or books on the web; the demo farmer's "Try as farmer" calls it too.
 * Not an HTTP route. `locale`: the language the link was sent in, so the web opens in it.
 */
export async function mintFarmerLoginLink(
  store: VaariStore,
  phone: string,
  options: { locale?: Locale; now?: Date } = {},
): Promise<{ token: string; path: string; expiresAt: string }> {
  if (toE164(phone) !== phone) throw new Error("mintFarmerLoginLink needs a phone number in E.164");
  const token = randomBytes(LOGIN_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date((options.now ?? new Date()).getTime() + FARMER_LOGIN_SECONDS * 1000).toISOString();
  await store.putLoginToken({ jti: loginKey(token), phone, expiresAt, usedAt: null, ...(options.locale ? { locale: options.locale } : {}) });
  return { token, path: `/farmer/login/${token}`, expiresAt };
}

/**
 * Uses a login link once and returns a session for its phone, with the language the link was sent
 * in (if any). Any failure is a plain AuthError (401).
 */
export async function exchangeFarmerLogin(
  config: Config,
  store: VaariStore,
  token: string,
  now: Date = new Date(),
): Promise<{ sessionToken: string; expiresIn: number; locale?: Locale }> {
  if (!LOGIN_TOKEN_PATTERN.test(token)) throw new AuthError("invalid farmer login link");
  const used = await store.useLoginToken(loginKey(token), now.toISOString());
  if (!used) throw new AuthError("farmer login link already used or unknown");
  if (used.expiresAt <= now.toISOString()) throw new AuthError("farmer login link expired");
  return { ...(await mintFarmerSession(config, used.phone)), ...(used.locale ? { locale: used.locale } : {}) };
}

/** A 7-day phone session, after a login link or a one-time code (auth/farmer-otp.ts) proved the phone. */
export async function mintFarmerSession(config: Config, phone: string): Promise<{ sessionToken: string; expiresIn: number }> {
  if (toE164(phone) !== phone) throw new Error("mintFarmerSession needs a phone number in E.164");
  const sessionToken = await new SignJWT({ typ: "farmer-session", phone })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${FARMER_SESSION_SECONDS}s`)
    .sign(secretOf(config));
  return { sessionToken, expiresIn: FARMER_SESSION_SECONDS };
}

export async function verifyFarmerSession(config: Config, token: string): Promise<FarmerPhonePrincipal> {
  try {
    const { payload } = await jwtVerify(token, secretOf(config), { issuer: ISSUER, audience: SESSION_AUDIENCE, algorithms: ["HS256"] });
    if (payload.typ !== "farmer-session" || typeof payload.phone !== "string" || toE164(payload.phone) !== payload.phone) throw new Error("not a farmer session");
    return { kind: "farmerPhone", phone: payload.phone };
  } catch {
    throw new AuthError("invalid farmer session");
  }
}
