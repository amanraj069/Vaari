/**
 * The Express app. Only the web service reaches it (private network in production). Every
 * request is validated with Zod, every protected route verifies the bearer token, and every
 * resource access is checked by Cedar. Errors map to plain status codes with a short code.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import pino from "pino";
import { ZodError } from "zod";
import type { Config } from "./config";
import { AuthError, type TokenVerifier } from "./auth/tokens";
import { EngineError, type EngineClient } from "./engine/client";
import { ConflictError, ImpossibleMoveError, NotFoundError, Planner } from "./domain/planner";
import { PromiseTransitionError } from "./domain/promises";
import type { VaariStore } from "./store/types";
import { ForbiddenError, buildRoutes } from "./routes";

export type AppDependencies = {
  config: Config;
  store: VaariStore;
  engine: EngineClient;
  verifier: TokenVerifier;
  planner: Planner;
  resetDemo: () => Promise<void>;
};

/**
 * Dev logs are for spotting problems, so they are one short line per event: the start-up line,
 * failed requests (5xx) with their stack, and permission denials. Successful requests are not
 * logged at all. Production (ECS, CloudWatch) keeps pino's JSON lines so they stay searchable.
 */
const LEVEL_LABEL: Record<number, string> = { 10: "TRACE", 20: "DEBUG", 30: "INFO ", 40: "WARN ", 50: "ERROR", 60: "FATAL" };

const devLines = {
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
    const request = req ? ` ${req.method} ${req.url}${res ? ` -> ${res.statusCode}` : ""}` : "";
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

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(
    pinoHttp({
      logger,
      // No line per request. The error handler below logs each failure once, with its cause;
      // request.log adds the method and URL to that line. 4xx answers (expired session, not
      // found, conflict) are normal traffic and stay quiet.
      autoLogging: false,
      serializers: {
        req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url }),
        res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
      },
    }),
  );
  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(buildRoutes(dependencies));

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "INVALID_REQUEST", issues: error.issues });
    } else if (error instanceof AuthError) {
      response.status(401).json({ error: "UNAUTHENTICATED" });
    } else if (error instanceof ForbiddenError) {
      request.log.warn({ policyErrors: error.errors }, "cedar denied");
      response.status(403).json({ error: "FORBIDDEN" });
    } else if (error instanceof NotFoundError) {
      response.status(404).json({ error: "NOT_FOUND", message: error.message });
    } else if (error instanceof ConflictError) {
      response.status(409).json({ error: "CONFLICT", message: error.message });
    } else if (error instanceof PromiseTransitionError) {
      response.status(409).json({ error: "PROMISE_RULE", message: error.message });
    } else if (error instanceof ImpossibleMoveError) {
      response.status(422).json({ error: "IMPOSSIBLE_MOVE", message: error.message });
    } else if (error instanceof EngineError) {
      request.log.error({ code: error.code, message: error.message }, "engine error");
      response.status(error.code === "IMPOSSIBLE_PIN" ? 422 : 502).json({ error: error.code });
    } else {
      request.log.error({ err: error }, "unhandled error");
      response.status(500).json({ error: "INTERNAL" });
    }
  });
  return app;
}
