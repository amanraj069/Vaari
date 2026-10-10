/**
 * A farmer is their phone number. To see all their fields they get a one-time login link (on
 * WhatsApp from the bot; in DEMO_MODE from the "Try as farmer" button), which the web exchanges for
 * a 7-day session scoped to that phone, or they sign in on the web with a one-time code
 * (auth/farmer-otp.ts), which ends in the same session.
 *
 *   login token   typ "farmer-login", phone, jti, 15 minutes, usable once (the jti is stored and
 *                 marked used in a conditional write, so a replayed or forwarded link fails)
 *   session token typ "farmer-session", phone, 7 days; it can only read fields with that phone
 *                 (Cedar FarmerPhone principal), never act on them
 *
 * Both are signed with SLOT_TOKEN_SECRET and carry their own audience, so no token works as
 * another kind. When the bot sends a login link it must turn link previews off (preview_url:
 * false): a preview fetch would use up the link before the farmer taps it.
 */
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { toE164 } from "../shared";
import type { Config } from "../config";
import type { VaariStore } from "../store/types";
import { AuthError } from "./tokens";

const ISSUER = "vaari";
const LOGIN_AUDIENCE = "vaari-farmer-login";
const SESSION_AUDIENCE = "vaari-farmer-session";
export const FARMER_LOGIN_SECONDS = 15 * 60;
export const FARMER_SESSION_SECONDS = 7 * 24 * 60 * 60;

/** Who a farmer session is: a phone number, nothing else. */
export type FarmerPhonePrincipal = { kind: "farmerPhone"; phone: string };

const secretOf = (config: Config) => new TextEncoder().encode(config.SLOT_TOKEN_SECRET);

/**
 * The internal function that mints a farmer's login link. The WhatsApp worker will call it when a
 * farmer writes "my fields"; DEMO_MODE's farmer persona calls it today. Not an HTTP route.
 */
export async function mintFarmerLoginLink(
  config: Config,
  store: VaariStore,
  phone: string,
  now: Date = new Date(),
): Promise<{ token: string; path: string; expiresAt: string }> {
  if (toE164(phone) !== phone) throw new Error("mintFarmerLoginLink needs a phone number in E.164");
  const jti = randomUUID();
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + FARMER_LOGIN_SECONDS;
  const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
  await store.putLoginToken({ jti, phone, expiresAt, usedAt: null });
  const token = await new SignJWT({ typ: "farmer-login", phone })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(LOGIN_AUDIENCE)
    .setJti(jti)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(expiresAtSeconds)
    .sign(secretOf(config));
  return { token, path: `/farmer/login/${token}`, expiresAt };
}

/** Uses a login link once and returns a session for its phone. Any failure is a plain AuthError (401). */
export async function exchangeFarmerLogin(config: Config, store: VaariStore, token: string): Promise<{ sessionToken: string; expiresIn: number }> {
  let phone: string;
  let jti: string;
  try {
    const { payload } = await jwtVerify(token, secretOf(config), { issuer: ISSUER, audience: LOGIN_AUDIENCE, algorithms: ["HS256"] });
    if (payload.typ !== "farmer-login" || typeof payload.phone !== "string" || typeof payload.jti !== "string") throw new Error("not a login token");
    phone = payload.phone;
    jti = payload.jti;
  } catch {
    throw new AuthError("invalid farmer login link");
  }
  const used = await store.useLoginToken(jti, new Date().toISOString());
  if (!used) throw new AuthError("farmer login link already used or unknown");
  if (used.phone !== phone) throw new AuthError("farmer login link does not match its record");
  return mintFarmerSession(config, phone);
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
