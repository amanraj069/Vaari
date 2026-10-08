import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The core-loop test calls the real Python engine several times.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: "test", ENGINE_TIME_LIMIT_SECONDS: "1" },
  },
});
