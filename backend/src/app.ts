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
import { ConflictError, NotFoundError, Planner } from "./domain/planner";
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

export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : "info",
  // Never log tokens.
  redact: ["req.headers.authorization", "req.headers.cookie"],
});

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(pinoHttp({ logger }));
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
