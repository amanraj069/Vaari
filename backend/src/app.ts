/**
 * The Express app. Only the web service reaches it (private network in production). Every
 * request is validated with Zod, every protected route verifies the bearer token, and every
 * resource access is checked by Cedar. Errors map to plain status codes with a short code.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { trustProxySetting, type Config } from "./config";
import { requestSerializer } from "./http/redact";
import { logger, noteForLog } from "./logger";
import { AuthError, type TokenVerifier } from "./auth/tokens";
import { EngineError, type EngineClient } from "./engine/client";
import { ConflictError, ImpossibleMoveError, NotFoundError, Planner } from "./domain/planner";
import { PromiseTransitionError } from "./domain/promises";
import type { VaariStore } from "./store/types";
import { ForbiddenError, buildRoutes } from "./routes";
import type { WhatsAppRuntime } from "./whatsapp";
import { whatsappRouter } from "./whatsapp/webhook";

export type AppDependencies = {
  config: Config;
  store: VaariStore;
  engine: EngineClient;
  verifier: TokenVerifier;
  planner: Planner;
  resetDemo: () => Promise<void>;
  whatsapp: WhatsAppRuntime;
};

export { devLines, logger } from "./logger";

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  // Which hops may set X-Forwarded-For (TRUST_PROXY). Rate limits use it, together with the
  // client address our Next proxy vouches for (http/client-ip.ts).
  app.set("trust proxy", trustProxySetting(dependencies.config));
  app.use(helmet());
  // One log line per request, written when the response ends; mounted before the webhook so every
  // webhook call is on record too. logger.ts says what is logged at which level.
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (request) => request.url === "/healthz" },
      customLogLevel: (request, response, error) => {
        if (error || response.statusCode >= 500) return "error";
        if (response.statusCode >= 400) return "warn";
        const noted = localsOf(response).logMessage !== undefined;
        return noted || !["GET", "HEAD", "OPTIONS"].includes(request.method ?? "") ? "info" : "debug";
      },
      customSuccessMessage: (_request, response) => localsOf(response).logMessage ?? (response.statusCode >= 400 ? "request refused" : "request"),
      customErrorMessage: (_request, response) => localsOf(response).logMessage ?? "request failed",
      // Also called when the response ends: the reason or summary a handler noted (noteForLog).
      customProps: (_request, response) => localsOf(response).logDetails ?? {},
      serializers: {
        // Slot and farmer-login tokens live in the path: logged URLs are redacted.
        req: requestSerializer,
        res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
      },
    }),
  );
  // Before express.json(): the webhook's signature is checked on the raw bytes.
  app.use(whatsappRouter(dependencies.config, dependencies.whatsapp.queue));
  app.use(express.json({ limit: "100kb" }));
  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(buildRoutes(dependencies));

  // Each answer notes its reason on the request's log line (never a token, a body or a phone).
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      noteForLog(response, { reason: "invalid request", issues: error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`) });
      response.status(400).json({ error: "INVALID_REQUEST", issues: error.issues });
    } else if (error instanceof AuthError) {
      noteForLog(response, { reason: `unauthenticated: ${error.message}` });
      response.status(401).json({ error: "UNAUTHENTICATED" });
    } else if (error instanceof ForbiddenError) {
      noteForLog(response, { reason: "cedar denied", policyErrors: error.errors });
      response.status(403).json({ error: "FORBIDDEN" });
    } else if (error instanceof NotFoundError) {
      noteForLog(response, { reason: `not found: ${error.message}` });
      response.status(404).json({ error: "NOT_FOUND", message: error.message });
    } else if (error instanceof ConflictError) {
      noteForLog(response, { reason: `conflict: ${error.message}` });
      response.status(409).json({ error: "CONFLICT", message: error.message });
    } else if (error instanceof PromiseTransitionError) {
      noteForLog(response, { reason: `promise rule: ${error.message}` });
      response.status(409).json({ error: "PROMISE_RULE", message: error.message });
    } else if (error instanceof ImpossibleMoveError) {
      noteForLog(response, { reason: `impossible move: ${error.message}` });
      response.status(422).json({ error: "IMPOSSIBLE_MOVE", message: error.message });
    } else if (error instanceof EngineError) {
      noteForLog(response, { reason: `engine ${error.code}: ${error.message}` });
      response.status(error.code === "IMPOSSIBLE_PIN" ? 422 : 502).json({ error: error.code });
    } else if (isClientBodyError(error)) {
      // express.json(): malformed JSON or too large, a client mistake rather than a server
      // failure (this used to answer 500). The parser's message quotes the body: only its type is logged.
      noteForLog(response, { reason: `unreadable body: ${error.type}` });
      response.status(error.status).json({ error: error.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" });
    } else {
      // pino-http puts this error, with its stack, on the request's log line.
      response.err = error instanceof Error ? error : new Error(String(error));
      response.status(500).json({ error: "INTERNAL" });
    }
  });
  return app;
}

const localsOf = (response: unknown) => ((response as Response).locals ?? {}) as { logDetails?: Record<string, unknown>; logMessage?: string };

/** body-parser errors carry a 4xx status and a type such as "entity.parse.failed" or "entity.too.large". */
function isClientBodyError(error: unknown): error is { status: number; type: string } {
  if (typeof error !== "object" || error === null) return false;
  const { status, type } = error as { status?: unknown; type?: unknown };
  return typeof status === "number" && status >= 400 && status < 500 && typeof type === "string";
}
