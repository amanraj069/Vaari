/**
 * Who is calling, for rate limits. Browsers never reach the API directly: they call the Next server
 * (same origin), which calls the API. So the API's own view of the caller (request.ip) is the Next
 * server, and a limit keyed on it would be one bucket shared by every farmer.
 *
 * The Next proxy therefore sends the browser's address in x-vaari-client-ip, together with
 * x-vaari-proxy-secret (PROXY_SHARED_SECRET). The API believes that header only when the secret
 * matches; anyone else who sends it is keyed on their own address. request.ip itself follows
 * Express "trust proxy" (TRUST_PROXY: "1" behind CloudFront, so it is the address CloudFront saw,
 * which a caller cannot forge by adding their own X-Forwarded-For).
 */
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Config } from "../config";

export const CLIENT_IP_HEADER = "x-vaari-client-ip";
export const PROXY_SECRET_HEADER = "x-vaari-proxy-secret";

function sameSecret(sent: string, expected: string): boolean {
  const left = Buffer.from(sent);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The caller's address: the browser's, when our proxy vouches for it; otherwise the connection's. */
export function clientAddress(config: Config, request: Request): string {
  const secret = request.get(PROXY_SECRET_HEADER);
  const forwarded = request.get(CLIENT_IP_HEADER)?.trim();
  if (config.PROXY_SHARED_SECRET && secret && forwarded && isIP(forwarded) && sameSecret(secret, config.PROXY_SHARED_SECRET)) {
    return forwarded;
  }
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

/** A per-client limiter (IPv6 addresses share a /56, as express-rate-limit recommends). */
export function clientRateLimit(config: Config, limitPerMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => ipKeyGenerator(clientAddress(config, request)),
  });
}
