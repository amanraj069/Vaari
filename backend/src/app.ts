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
import { logger } from "./logger";
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
  // Before express.json(): the webhook's signature is checked on the raw bytes.
  app.use(whatsappRouter(dependencies.config, dependencies.whatsapp.queue));
  app.use(express.json({ limit: "100kb" }));
  app.use(
    pinoHttp({
      logger,
      // No line per request. The error handler below logs each failure once, with its cause;
      // request.log adds the method and URL to that line. 4xx answers (expired session, not
      // found, conflict) are normal traffic and stay quiet.
      autoLogging: false,
      serializers: {
        // Slot and farmer-login tokens live in the path: logged URLs are redacted.
        req: requestSerializer,
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
