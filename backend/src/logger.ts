/**
 * The API's logger (also used by the WhatsApp webhook and worker). Never log tokens, message text
 * or full phone numbers: request logs keep only the method and a redacted URL, and WhatsApp code
 * logs phones masked to their last 4 digits.
 */
import type { Response } from "express";
import pino from "pino";
import { redactUrl } from "./http/redact";

/**
 * Dev logs are one short line per event: `time LEVEL message METHOD url -> status (ms) {details}`,
 * then the stack for a failure. Every request that changes something (and every webhook) gets a
 * line; successful GETs are debug, since the web app polls every few seconds (LOG_LEVEL=debug shows
 * them). Refused requests (4xx) are warn with the reason, failures (5xx) error with the cause.
 * Production (EC2, CloudWatch) keeps pino's JSON lines so they stay searchable.
 */
const LEVEL_LABEL: Record<number, string> = { 10: "TRACE", 20: "DEBUG", 30: "INFO ", 40: "WARN ", 50: "ERROR", 60: "FATAL" };
const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

type SerializedError = { type?: string; message?: string; stack?: string; code?: unknown; status?: unknown; $metadata?: { httpStatusCode?: number } };

export const devLines = {
  write(line: string) {
    const entry = JSON.parse(line) as {
      level: number;
      time: number;
      msg: string;
      req?: { method: string; url: string };
      res?: { statusCode: number };
      responseTime?: number;
      err?: SerializedError | string;
      [key: string]: unknown;
    };
    const { level, time, msg, req, res, responseTime, err, ...details } = entry;
    const clock = new Date(time).toTimeString().slice(0, 8);
    const timing = responseTime !== undefined ? ` (${responseTime} ms)` : "";
    const request = req ? ` ${req.method} ${redactUrl(req.url)}${res ? ` -> ${res.statusCode}${timing}` : ""}` : "";
    // The error's class and message on the line itself (AccessDeniedException, ECONNREFUSED, ...):
    // the stack below is long, and the first line is what one scans for.
    let cause = "";
    if (typeof err === "string") cause = ` | ${err}`;
    else if (err) {
      const status = err.status ?? err.$metadata?.httpStatusCode;
      cause = ` | ${err.type ?? "Error"}: ${err.message ?? ""}${err.code !== undefined ? ` [code ${String(err.code)}]` : ""}${status !== undefined ? ` [status ${String(status)}]` : ""}`;
    }
    const extra = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
    process.stdout.write(`${clock} ${LEVEL_LABEL[level] ?? level} ${msg}${request}${extra}${cause}\n`);
    if (typeof err === "object" && err?.stack) process.stdout.write(`${err.stack}\n`);
  },
};

/** LOG_LEVEL (default info; tests are silent). An unknown value falls back to info. */
function logLevel(): string {
  const wanted = process.env.LOG_LEVEL?.toLowerCase();
  if (wanted && (LEVELS as readonly string[]).includes(wanted)) return wanted;
  return process.env.NODE_ENV === "test" ? "silent" : "info";
}

export const logger = pino(
  {
    level: logLevel(),
    base: undefined, // no pid or hostname on every line
    // Never log tokens.
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  process.env.NODE_ENV === "production" ? undefined : devLines,
);

/**
 * A rejected promise nobody awaited, or a throw outside any request, is logged with its stack
 * instead of vanishing (rejection) or killing the process with no JSON line (exception).
 */
export function logProcessFailures(processName: string) {
  process.on("unhandledRejection", (reason) => logger.error({ process: processName, err: reason }, "unhandled promise rejection"));
  process.on("uncaughtException", (error) => {
    logger.fatal({ process: processName, err: error }, "uncaught exception: exiting");
    process.exit(1);
  });
}

/**
 * Adds details to this request's one log line (the line pino-http writes when the response ends):
 * why it was refused, what a webhook carried. `message` replaces the generic "request" text.
 */
export function noteForLog(response: Response, details: Record<string, unknown>, message?: string) {
  const locals = response.locals as { logDetails?: Record<string, unknown>; logMessage?: string };
  locals.logDetails = { ...locals.logDetails, ...details };
  if (message) locals.logMessage = message;
}
