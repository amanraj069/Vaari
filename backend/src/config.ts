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
  ENGINE_SHARED_SECRET: z.string().default("local-dev-only-engine-secret-change-me-00"),
  ENGINE_PYTHON: z.string().default(path.join(backendRoot, "engine/.venv/bin/python")),
  ENGINE_DIR: z.string().default(path.join(backendRoot, "engine")),
  ENGINE_TIME_LIMIT_SECONDS: z.coerce.number().positive().default(2),
  // cpsat: the reference planner, with a time limit; when it finds no plan in time the engine falls
  // back to the search planner (model.py). search: the fast planner alone (earliest burn deadline +
  // seeded local search, a fraction of a second), seeded by ENGINE_SEARCH_SEED. The simulator uses search.
  ENGINE_METHOD: z.enum(["cpsat", "search"]).default("cpsat"),
  ENGINE_SEARCH_SEED: z.coerce.number().int().default(1),
  DATA_DIR: z.string().default(path.join(repoRoot, "data")),
  // Data: REPO=memory for tests and quick runs, REPO=dynamo for the real tables.
  REPO: z.enum(["memory", "dynamo"]).default("memory"),
  TABLE_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes")
    .default("vaari-dev"),
  AWS_REGION: z.string().optional(),
  // Only for DynamoDB Local in development; production uses the regional endpoint.
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  // Signs farmer slot links, farmer login links and farmer sessions (separate from the demo session secret).
  SLOT_TOKEN_SECRET: z.string().min(32).default("local-dev-only-slot-secret-change-me-00000"),
  // The demo runs on a simulated season clock: day 0 is the season start.
  SEASON_START_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-10-01"),
  // ASSUMPTION: the last day of the wheat sowing season. Slot links expire 7 days after it.
  SEASON_END_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-12-31"),
  DEMO_TODAY: z.string().default("2026-10-31"),
  // PAU Package of Practices, Rabi 2025-26: first fortnight of November is the optimum.
  OPTIMUM_LAST_DATE: z.string().default("2026-11-15"),
  // Express "trust proxy": which hops in front of the API may set X-Forwarded-For. "loopback" in
  // development; behind CloudFront in production, "1" (CloudFront is the one hop in front of the API).
  TRUST_PROXY: z.string().default("loopback"),
  // Shared with the Next server: it proves that x-vaari-client-ip comes from our proxy, so rate
  // limits key on the farmer's own address rather than on the Next server's.
  PROXY_SHARED_SECRET: z.string().default(""),
  SLOT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),

  // WhatsApp (Cloud API). Off by default: the webhook answers 404 and no notice is sent.
  WHATSAPP_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  WHATSAPP_TOKEN: z.string().default(""),
  // Meta signs every webhook body with the app secret (X-Hub-Signature-256).
  WHATSAPP_APP_SECRET: z.string().default(""),
  // Echoed back during Meta's webhook verification (GET hub.verify_token).
  WHATSAPP_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  // Utility templates approved in WhatsApp Manager, each with two body parameters: {{1}} the date, {{2}} the sentence.
  WHATSAPP_TEMPLATE_NEW_DATE: z.string().default(""),
  WHATSAPP_TEMPLATE_FIRM_DATE: z.string().default(""),
  WHATSAPP_TEMPLATE_DATE_CHANGED: z.string().default(""),
  // Authentication template (copy-code button) for farmer sign-in codes, in en, pa and hi.
  WHATSAPP_TEMPLATE_OTP: z.string().default(""),
  // In DEMO_MODE, notices go only to these numbers (comma-separated, E.164).
  WHATSAPP_ALLOWED_TEST_NUMBERS: z.string().default(""),
  // memory: in-process (dev, tests). sqs: the webhook writes to SQS and `npm run worker` reads it.
  WHATSAPP_QUEUE: z.enum(["memory", "sqs"]).default("memory"),
  WHATSAPP_SQS_QUEUE_URL: z.string().default(""),
  WHATSAPP_MESSAGES_PER_PHONE_PER_HOUR: z.coerce.number().int().positive().default(30),
  // The web app's public address, for the one-time /farmer login links sent on WhatsApp.
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  // The agent: off by default; then farmers get the menu and button replies (no model).
  AGENT_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Nova 2 Lite has no in-region or geo inference in ap-south-1: the global profile is the one callable from there.
  BEDROCK_MODEL_ID: z.string().default("global.amazon.nova-2-lite-v1:0"),
  BEDROCK_REGION: z.string().optional(),
  AGENT_TIMEOUT_SECONDS: z.coerce.number().positive().default(20),
  // How a farmer's sign-in code reaches them. demo: shown on screen (DEMO_MODE only). whatsapp: the
  // WHATSAPP_TEMPLATE_OTP template. off: farmer sign-in is closed. Unset: demo with DEMO_MODE, else off.
  FARMER_OTP_DELIVERY: z.enum(["off", "demo", "whatsapp"]).optional(),
});

export type Config = Omit<z.infer<typeof configSchema>, "FARMER_OTP_DELIVERY"> & { FARMER_OTP_DELIVERY: "off" | "demo" | "whatsapp" };

/**
 * Values that must never sign anything in production: the development defaults above and the
 * placeholders in backend/.env.example (test/config.test.ts checks this list against that file).
 */
export const PLACEHOLDER_SECRETS: readonly string[] = [
  "local-dev-only-demo-secret-change-me-0000",
  "local-dev-only-slot-secret-change-me-00000",
  "local-dev-only-engine-secret-change-me-00",
  "change-me-local-only-32-characters-min",
  "change-me-local-only-engine-secret-32ch",
  "change-me-local-only-proxy-secret-32chars",
  "change-me-local-only",
  "local-dev-only",
];

const PRODUCTION_SECRETS = ["SLOT_TOKEN_SECRET", "DEMO_SESSION_SECRET", "ENGINE_SHARED_SECRET", "PROXY_SHARED_SECRET"] as const;
const MIN_SECRET_LENGTH = 32;

/** Why a production secret is unusable, or null when it is fine. Reads the raw environment, before defaults. */
function secretProblem(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return "is missing";
  if (raw.length < MIN_SECRET_LENGTH) return `is shorter than ${MIN_SECRET_LENGTH} characters`;
  if (PLACEHOLDER_SECRETS.includes(raw)) return "is a placeholder from .env.example or a development default";
  return null;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  // Secrets first, on the raw environment: in production a missing secret must never fall back to
  // a development default, and each problem is named plainly.
  if (environment.NODE_ENV === "production") {
    const problems = PRODUCTION_SECRETS.map((name) => {
      const problem = secretProblem(environment[name]);
      return problem ? `${name} ${problem}` : null;
    }).filter((problem): problem is string => problem !== null);
    if (problems.length > 0) throw new Error(`Refusing to start in production: ${problems.join("; ")}`);
  }
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.WHATSAPP_ENABLED) {
    const required = [
      "WHATSAPP_TOKEN",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_TEMPLATE_NEW_DATE",
      "WHATSAPP_TEMPLATE_FIRM_DATE",
      "WHATSAPP_TEMPLATE_DATE_CHANGED",
      ...(parsed.data.WHATSAPP_QUEUE === "sqs" ? ["WHATSAPP_SQS_QUEUE_URL", "AWS_REGION"] : []),
    ] as const;
    const missing = required.filter((name) => !environment[name]);
    if (missing.length > 0) throw new Error(`Refusing to start in production: WHATSAPP_ENABLED=true but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing`);
  }
  if (parsed.data.SEASON_END_DATE < parsed.data.SEASON_START_DATE) {
    throw new Error("SEASON_END_DATE must not be before SEASON_START_DATE");
  }
  if (parsed.data.REPO === "dynamo" && !parsed.data.AWS_REGION) {
    throw new Error("REPO=dynamo needs AWS_REGION (credentials come from the AWS default provider chain)");
  }
  const otpDelivery = parsed.data.FARMER_OTP_DELIVERY ?? (parsed.data.DEMO_MODE ? "demo" : "off");
  if (otpDelivery === "demo" && !parsed.data.DEMO_MODE) {
    throw new Error("FARMER_OTP_DELIVERY=demo shows sign-in codes on screen, so it needs DEMO_MODE=true");
  }
  if (otpDelivery === "whatsapp" && (!parsed.data.WHATSAPP_ENABLED || !parsed.data.WHATSAPP_TEMPLATE_OTP)) {
    throw new Error("FARMER_OTP_DELIVERY=whatsapp needs WHATSAPP_ENABLED=true and WHATSAPP_TEMPLATE_OTP");
  }
  return { ...parsed.data, FARMER_OTP_DELIVERY: otpDelivery };
}

/** WHATSAPP_ALLOWED_TEST_NUMBERS as E.164 numbers (anything that is not a phone number is ignored). */
export function allowedTestNumbers(config: Config, normalise: (input: string) => string | null): Set<string> {
  return new Set(
    config.WHATSAPP_ALLOWED_TEST_NUMBERS.split(",")
      .map((item) => normalise(item))
      .filter((item): item is string => item !== null),
  );
}

/** Express's "trust proxy" value from TRUST_PROXY: a hop count ("1"), "true"/"false", or names/CIDRs. */
export function trustProxySetting(config: Config): number | boolean | string {
  const value = config.TRUST_PROXY.trim();
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
