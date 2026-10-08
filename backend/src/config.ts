/**
 * Environment configuration, validated once at start-up. A missing or malformed value fails fast
 * with a clear message instead of surfacing later as a confusing runtime error.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(backendRoot, "..");

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  AUTH_MODE: z.enum(["demo", "cognito"]).default("demo"),
  DEMO_MODE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  DEMO_SESSION_SECRET: z.string().min(32).default("local-dev-only-demo-secret-change-me-0000"),
  COGNITO_USER_POOL_ID: z.string().default(""),
  COGNITO_CLIENT_ID: z.string().default(""),
  ENGINE_MODE: z.enum(["local", "http"]).default("local"),
  ENGINE_URL: z.string().default("http://localhost:8000"),
  ENGINE_SHARED_SECRET: z.string().default("local-dev-only"),
  ENGINE_PYTHON: z.string().default(path.join(backendRoot, "engine/.venv/bin/python")),
  ENGINE_DIR: z.string().default(path.join(backendRoot, "engine")),
  ENGINE_TIME_LIMIT_SECONDS: z.coerce.number().positive().default(2),
  DATA_DIR: z.string().default(path.join(repoRoot, "data")),
  STORE_MODE: z.enum(["memory", "dynamodb"]).default("memory"),
  // The demo runs on a simulated season clock: day 0 is the season start.
  SEASON_START_DATE: z.string().default("2026-10-01"),
  DEMO_TODAY: z.string().default("2026-10-31"),
  // PAU Package of Practices, Rabi 2025-26: first fortnight of November is the optimum.
  OPTIMUM_LAST_DATE: z.string().default("2026-11-15"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.DEMO_SESSION_SECRET.startsWith("local-dev-only")) {
    throw new Error("DEMO_SESSION_SECRET must be set in production");
  }
  return parsed.data;
}
