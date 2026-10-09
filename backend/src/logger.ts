/**
 * The API's logger (also used by the WhatsApp webhook and worker). Never log tokens, message text
 * or full phone numbers: request logs keep only the method and a redacted URL, and WhatsApp code
 * logs phones masked to their last 4 digits.
 */
import pino from "pino";
import { redactUrl } from "./http/redact";

/**
 * Dev logs are for spotting problems, so they are one short line per event: the start-up line,
 * failed requests (5xx) with their stack, and permission denials. Successful requests are not
 * logged at all. Production (ECS, CloudWatch) keeps pino's JSON lines so they stay searchable.
 */
const LEVEL_LABEL: Record<number, string> = { 10: "TRACE", 20: "DEBUG", 30: "INFO ", 40: "WARN ", 50: "ERROR", 60: "FATAL" };

export const devLines = {
  write(line: string) {
    const entry = JSON.parse(line) as {
      level: number;
      time: number;
      msg: string;
      req?: { method: string; url: string };
      res?: { statusCode: number };
      err?: { message?: string; stack?: string };
      [key: string]: unknown;
    };
    const { level, time, msg, req, res, err, ...details } = entry;
    const clock = new Date(time).toTimeString().slice(0, 8);
    const request = req ? ` ${req.method} ${redactUrl(req.url)}${res ? ` -> ${res.statusCode}` : ""}` : "";
    const extra = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
    process.stdout.write(`${clock} ${LEVEL_LABEL[level] ?? level} ${msg}${request}${extra}\n`);
    if (err?.stack) process.stdout.write(`${err.stack}\n`);
  },
};

export const logger = pino(
  {
    level: process.env.NODE_ENV === "test" ? "silent" : "info",
    base: undefined, // no pid or hostname on every line
    // Never log tokens.
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  process.env.NODE_ENV === "production" ? undefined : devLines,
);
