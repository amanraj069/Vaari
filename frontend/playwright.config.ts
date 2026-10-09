/**
 * End-to-end: starts its own backend (in-memory store, demo sign-in) on :4100 and its own Next dev
 * server on :3100 with a separate build folder, so it never touches your running servers or your
 * DynamoDB tables. Uses the installed Google Chrome (no browser download).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", channel: "chrome", headless: true, viewport: { width: 390, height: 844 } },
  webServer: [
    {
      command: "npm run dev",
      cwd: "../backend",
      url: "http://localhost:4100/healthz",
      env: { PORT: "4100", REPO: "memory", AUTH_MODE: "demo", DEMO_MODE: "true", ENGINE_TIME_LIMIT_SECONDS: "1", NODE_ENV: "development", PROXY_SHARED_SECRET: "e2e-proxy-secret-at-least-32-characters" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx next dev --port 3100",
      url: "http://localhost:3100/signin",
      // WHATSAPP_BUSINESS_NUMBER: a placeholder (not a real Indian mobile number); only rendered into a wa.me link, never opened.
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        API_URL: "http://localhost:4100",
        AUTH_MODE: "demo",
        DEMO_MODE: "true",
        PUBLIC_BASE_URL: "http://localhost:3100",
        PROXY_SHARED_SECRET: "e2e-proxy-secret-at-least-32-characters",
        WHATSAPP_BUSINESS_NUMBER: "910000000000",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
