/**
 * The CSRF guard behind a proxy: on Amplify the Next server sees its internal address in
 * request.url, never the public one the browser posts from. Our own pages must pass; other sites
 * must not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PUBLIC = "https://main.d2n4tg60h10ven.amplifyapp.com";
const INTERNAL = "http://localhost:3000/api/proxy/operator/plan/generate";

async function guard() {
  vi.resetModules();
  return (await import("@/lib/same-origin")).isSameOrigin;
}
const post = (headers: Record<string, string>, url = INTERNAL) => new Request(url, { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("isSameOrigin", () => {
  it("lets our public pages through behind Amplify, by PUBLIC_BASE_URL or by the forwarded host", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", PUBLIC);
    const isSameOrigin = await guard();
    expect(isSameOrigin(post({ origin: PUBLIC }))).toBe(true);
    vi.stubEnv("PUBLIC_BASE_URL", "");
    const withoutConfig = await guard();
    expect(withoutConfig(post({ origin: PUBLIC, "x-forwarded-host": "main.d2n4tg60h10ven.amplifyapp.com", "x-forwarded-proto": "https" }))).toBe(true);
    expect(withoutConfig(post({ origin: PUBLIC, host: "main.d2n4tg60h10ven.amplifyapp.com" }))).toBe(true);
  });

  it("refuses another site, and still allows local development and calls without an Origin", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", PUBLIC);
    const isSameOrigin = await guard();
    expect(isSameOrigin(post({ origin: "https://evil.example", host: "main.d2n4tg60h10ven.amplifyapp.com" }))).toBe(false);
    expect(isSameOrigin(post({ origin: "https://main.d2n4tg60h10ven.amplifyapp.com.evil.example" }))).toBe(false);
    expect(isSameOrigin(post({ origin: "http://localhost:3000" }))).toBe(true);
    expect(isSameOrigin(post({}))).toBe(true);
  });
});
