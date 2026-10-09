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

describe("season dates", () => {
  it("refuses a season that ends before it starts", () => {
    expect(() => loadConfig({ NODE_ENV: "test", SEASON_START_DATE: "2026-10-01", SEASON_END_DATE: "2026-09-30" })).toThrow("SEASON_END_DATE");
  });
});
