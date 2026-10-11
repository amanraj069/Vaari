/**
 * The deploy's config check: it must stop a deploy for the mistakes that crash the API in a
 * container (a missing secret, the local engine without Python, no data), and never print a secret.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfig } from "../src/check-config";

const dataDir = path.resolve(import.meta.dirname, "../../data");
const production = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  SLOT_TOKEN_SECRET: "slot-token-secret-a-real-random-value-0123",
  DEMO_SESSION_SECRET: "demo-session-secret-a-real-random-value-01",
  ENGINE_SHARED_SECRET: "engine-shared-secret-a-real-random-value-0",
  PROXY_SHARED_SECRET: "proxy-shared-secret-a-real-random-value-01",
  ENGINE_MODE: "http",
  ENGINE_URL: "http://engine:8000",
  DATA_DIR: dataDir,
  WEB_BASE_URL: "https://main.example.amplifyapp.com",
  ...overrides,
});

describe("checkConfig", () => {
  it("passes a complete container environment and prints no secret", () => {
    const report = checkConfig(production());
    expect(report).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(report.summary.join("\n")).toContain("ENGINE_MODE=http ENGINE_URL=http://engine:8000");
    expect(report.summary.join("\n")).not.toContain("a-real-random-value");
  });

  it("names a missing production secret", () => {
    const report = checkConfig(production({ ENGINE_SHARED_SECRET: undefined }));
    expect(report.ok).toBe(false);
    expect(report.errors.join()).toContain("ENGINE_SHARED_SECRET is missing");
  });

  it("refuses the local engine when its Python is not there", () => {
    const report = checkConfig(production({ ENGINE_MODE: "local", ENGINE_PYTHON: "/nowhere/python" }));
    expect(report.errors.join()).toContain("ENGINE_MODE=local but /nowhere/python does not exist");
  });

  it("refuses a data folder without villages", () => {
    expect(checkConfig(production({ DATA_DIR: "/nowhere" })).errors.join()).toContain("DATA_DIR=/nowhere has no villages.json");
  });

  it("warns when WhatsApp replies need the worker", () => {
    const report = checkConfig(
      production({
        WHATSAPP_ENABLED: "true",
        WHATSAPP_QUEUE: "sqs",
        WHATSAPP_SQS_QUEUE_URL: "https://sqs.ap-south-1.amazonaws.com/123456789012/vaari",
        AWS_REGION: "ap-south-1",
        WHATSAPP_TOKEN: "token",
        WHATSAPP_APP_SECRET: "secret",
        WHATSAPP_VERIFY_TOKEN: "verify",
        WHATSAPP_PHONE_NUMBER_ID: "1",
        WHATSAPP_TEMPLATE_NEW_DATE: "new_date",
        WHATSAPP_TEMPLATE_FIRM_DATE: "firm_date",
        WHATSAPP_TEMPLATE_DATE_CHANGED: "date_changed",
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.join()).toContain("COMPOSE_PROFILES=worker");
  });

  it("names the settings that would quietly turn voice notes off, and shows whether voice is on", () => {
    const whatsapp = {
      WHATSAPP_ENABLED: "true",
      WHATSAPP_TOKEN: "token",
      WHATSAPP_APP_SECRET: "secret",
      WHATSAPP_VERIFY_TOKEN: "verify",
      WHATSAPP_PHONE_NUMBER_ID: "1",
      WHATSAPP_TEMPLATE_NEW_DATE: "new_date",
      WHATSAPP_TEMPLATE_FIRM_DATE: "firm_date",
      WHATSAPP_TEMPLATE_DATE_CHANGED: "date_changed",
    };
    const noBucket = checkConfig(production({ ...whatsapp, AGENT_ENABLED: "true", VOICE_ENABLED: "true" }));
    expect(noBucket.ok).toBe(true);
    expect(noBucket.warnings.join()).toContain("VOICE_S3_BUCKET is not set");
    expect(noBucket.summary.join("\n")).toContain("VOICE_ENABLED=true VOICE_S3_BUCKET=(unset)");
    const noAgent = checkConfig(production({ ...whatsapp, VOICE_ENABLED: "true", VOICE_S3_BUCKET: "vaari-voice" }));
    expect(noAgent.warnings.join()).toContain("AGENT_ENABLED=false");
    const ready = checkConfig(production({ ...whatsapp, AGENT_ENABLED: "true", VOICE_ENABLED: "true", VOICE_S3_BUCKET: "vaari-voice" }));
    expect(ready.warnings).toEqual([]);
    expect(ready.summary.join("\n")).toContain("VOICE_ENABLED=true VOICE_S3_BUCKET=vaari-voice");
  });
});
