/**
 * `node dist/check-config.js`: validates the environment exactly as the API will see it, then exits.
 * Why it exists: the deploy script runs it in the new image with the host's .env before replacing
 * the running containers, so a missing secret or a wrong path stops the deploy with the setting's
 * name instead of a crash loop. It prints settings, never secret values.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config";
import { whatsappSetupProblems } from "./whatsapp";

export type ConfigReport = { ok: boolean; errors: string[]; warnings: string[]; summary: string[] };

export function checkConfig(environment: NodeJS.ProcessEnv): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(environment);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], warnings, summary: [] };
  }
  // The API image has no Python: inside it the engine must be the separate service (ENGINE_MODE=http).
  if (config.ENGINE_MODE === "local" && !existsSync(config.ENGINE_PYTHON)) {
    errors.push(`ENGINE_MODE=local but ${config.ENGINE_PYTHON} does not exist (in Docker use ENGINE_MODE=http)`);
  }
  if (!existsSync(path.join(config.DATA_DIR, "villages.json"))) {
    errors.push(`DATA_DIR=${config.DATA_DIR} has no villages.json`);
  }
  if (config.AUTH_MODE === "cognito" && (!config.COGNITO_USER_POOL_ID || !config.COGNITO_CLIENT_ID)) {
    errors.push("AUTH_MODE=cognito needs COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID");
  }
  if (config.WHATSAPP_ENABLED && config.WHATSAPP_QUEUE === "sqs") {
    warnings.push("WHATSAPP_QUEUE=sqs: replies need the worker service running (COMPOSE_PROFILES=worker)");
  }
  // The settings that make WhatsApp (or its voice notes) quietly do nothing, as the API and the
  // worker log them at start-up: shown at deploy time too, where someone is looking.
  warnings.push(...whatsappSetupProblems(config));
  if (config.NODE_ENV === "production" && config.WEB_BASE_URL.startsWith("http://localhost")) {
    warnings.push("WEB_BASE_URL is localhost: farmer login links sent on WhatsApp will not open");
  }
  const summary = [
    `NODE_ENV=${config.NODE_ENV} AUTH_MODE=${config.AUTH_MODE} REPO=${config.REPO}${config.REPO === "dynamo" ? ` TABLE_PREFIX=${config.TABLE_PREFIX}` : ""} AWS_REGION=${config.AWS_REGION ?? "(unset)"}`,
    `ENGINE_MODE=${config.ENGINE_MODE}${config.ENGINE_MODE === "http" ? ` ENGINE_URL=${config.ENGINE_URL}` : ""} ENGINE_METHOD=${config.ENGINE_METHOD} DATA_DIR=${config.DATA_DIR}`,
    `DATE_TODAY=${config.DATE_TODAY} WEB_BASE_URL=${config.WEB_BASE_URL} TRUST_PROXY=${config.TRUST_PROXY}`,
    `WHATSAPP_ENABLED=${config.WHATSAPP_ENABLED} WHATSAPP_QUEUE=${config.WHATSAPP_QUEUE} AGENT_ENABLED=${config.AGENT_ENABLED} FARMER_OTP_DELIVERY=${config.FARMER_OTP_DELIVERY}`,
    `VOICE_ENABLED=${config.VOICE_ENABLED}${config.VOICE_ENABLED ? ` VOICE_S3_BUCKET=${config.VOICE_S3_BUCKET || "(unset)"}` : ""}`,
  ];
  return { ok: errors.length === 0, errors, warnings, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = checkConfig(process.env);
  for (const line of report.summary) console.log(`  ${line}`);
  for (const warning of report.warnings) console.log(`  warning: ${warning}`);
  for (const error of report.errors) console.error(`  error: ${error}`);
  console.log(report.ok ? "config ok" : "config has errors");
  process.exit(report.ok ? 0 : 1);
}
