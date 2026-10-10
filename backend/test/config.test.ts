/**
 * Production refuses to start with a missing, short or placeholder secret, so a copied
 * .env.example (or no env at all) can never sign real slot links or sessions. Development keeps
 * working with its defaults.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, PLACEHOLDER_SECRETS } from "../src/config";

const SECRETS = ["SLOT_TOKEN_SECRET", "DEMO_SESSION_SECRET", "ENGINE_SHARED_SECRET", "PROXY_SHARED_SECRET"] as const;
const strong = (name: string) => `${name.toLowerCase()}-a-real-random-secret-0123456789`;
const production = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  ...Object.fromEntries(SECRETS.map((name) => [name, strong(name)])),
  ...overrides,
});

const exampleValues = Object.fromEntries(
  readFileSync(path.resolve(import.meta.dirname, "../.env.example"), "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

describe("production secrets", () => {
  it("starts with four strong secrets", () => {
    expect(() => loadConfig(production())).not.toThrow();
  });

  for (const name of SECRETS) {
    it(`refuses a missing, empty, short or placeholder ${name}`, () => {
      expect(() => loadConfig(production({ [name]: undefined }))).toThrow(`${name} is missing`);
      expect(() => loadConfig(production({ [name]: "" }))).toThrow(`${name} is missing`);
      expect(() => loadConfig(production({ [name]: "x".repeat(31) }))).toThrow(`${name} is shorter than 32 characters`);
      expect(() => loadConfig(production({ [name]: exampleValues[name] }))).toThrow(`${name} is a placeholder`);
    });
  }

  it("refuses every value .env.example ships for these secrets", () => {
    for (const name of SECRETS) {
      expect(exampleValues[name], `${name} must be in backend/.env.example`).toBeDefined();
      expect(PLACEHOLDER_SECRETS).toContain(exampleValues[name]);
    }
  });

  it("names every problem at once", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "Refusing to start in production: SLOT_TOKEN_SECRET is missing; DEMO_SESSION_SECRET is missing; ENGINE_SHARED_SECRET is missing; PROXY_SHARED_SECRET is missing",
    );
  });

  it("keeps development and tests working on the defaults", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: "test" })).not.toThrow();
  });
});

describe("WhatsApp in production", () => {
  const WHATSAPP = {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_TOKEN: "token",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_VERIFY_TOKEN: "verify",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_TEMPLATE_NEW_DATE: "vaari_new_date",
    WHATSAPP_TEMPLATE_FIRM_DATE: "vaari_firm_date",
    WHATSAPP_TEMPLATE_DATE_CHANGED: "vaari_date_changed",
  };

  it("starts with every WhatsApp setting present, and without them when WhatsApp is off", () => {
    expect(() => loadConfig(production(WHATSAPP))).not.toThrow();
    expect(() => loadConfig(production())).not.toThrow();
  });

  it("refuses to start with WHATSAPP_ENABLED and any secret or template missing", () => {
    for (const name of Object.keys(WHATSAPP).filter((key) => key !== "WHATSAPP_ENABLED")) {
      expect(() => loadConfig(production({ ...WHATSAPP, [name]: undefined })), name).toThrow(name);
    }
    expect(() => loadConfig(production({ ...WHATSAPP, WHATSAPP_QUEUE: "sqs" }))).toThrow("WHATSAPP_SQS_QUEUE_URL");
  });

  it(".env.example names every WhatsApp and agent setting (with no values for the secrets)", () => {
    for (const name of [...Object.keys(WHATSAPP), "WHATSAPP_QUEUE", "WHATSAPP_SQS_QUEUE_URL", "AGENT_ENABLED", "BEDROCK_MODEL_ID", "WEB_BASE_URL"]) {
      expect(exampleValues[name], name).toBeDefined();
    }
    for (const secret of ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) expect(exampleValues[secret]).toBe("");
  });
});

describe("farmer sign-in codes", () => {
  it("are off unless WhatsApp can send them (demo farmers' codes show on screen either way), and never 'demo' for everyone", () => {
    expect(loadConfig({ NODE_ENV: "test" }).FARMER_OTP_DELIVERY).toBe("off");
    expect(loadConfig({ NODE_ENV: "test", WHATSAPP_ENABLED: "true", WHATSAPP_TEMPLATE_OTP: "vaari_code" }).FARMER_OTP_DELIVERY).toBe("whatsapp");
    expect(() => loadConfig({ NODE_ENV: "test", FARMER_OTP_DELIVERY: "demo" })).toThrow();
  });

  it("starts the season clock at DATE_TODAY, which must fall inside the season", () => {
    expect(loadConfig({ NODE_ENV: "test", DATE_TODAY: "2026-11-02" }).DATE_TODAY).toBe("2026-11-02");
    expect(() => loadConfig({ NODE_ENV: "test", DATE_TODAY: "2026-09-01" })).toThrow("DATE_TODAY must fall inside the season");
    expect(() => loadConfig({ NODE_ENV: "test", DATE_TODAY: "24 October" })).toThrow();
  });

  it("sends codes on WhatsApp only with WhatsApp on and an authentication template", () => {
    expect(() => loadConfig({ NODE_ENV: "test", FARMER_OTP_DELIVERY: "whatsapp" })).toThrow("WHATSAPP_TEMPLATE_OTP");
    expect(() => loadConfig({ NODE_ENV: "test", FARMER_OTP_DELIVERY: "whatsapp", WHATSAPP_ENABLED: "true" })).toThrow("WHATSAPP_TEMPLATE_OTP");
    expect(loadConfig({ NODE_ENV: "test", FARMER_OTP_DELIVERY: "whatsapp", WHATSAPP_ENABLED: "true", WHATSAPP_TEMPLATE_OTP: "vaari_code" }).FARMER_OTP_DELIVERY).toBe("whatsapp");
    expect(exampleValues.FARMER_OTP_DELIVERY).toBeDefined();
    expect(exampleValues.WHATSAPP_TEMPLATE_OTP).toBeDefined();
  });
});

describe("season dates", () => {
  it("refuses a season that ends before it starts", () => {
    expect(() => loadConfig({ NODE_ENV: "test", SEASON_START_DATE: "2026-10-01", SEASON_END_DATE: "2026-09-30" })).toThrow("SEASON_END_DATE");
  });
});
