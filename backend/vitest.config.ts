import { defineConfig } from "vitest/config";

// Tests touch real DynamoDB tables only when REPO=dynamo AND TABLE_PREFIX ends in "-test".
// Anything else runs on the in-memory store, so a stray REPO=dynamo can never hit dev or prod data.
const prefix = process.env.TABLE_PREFIX ?? "";
const useDynamo = process.env.REPO === "dynamo" && prefix.endsWith("-test");

export default defineConfig({
  test: {
    environment: "node",
    // The core-loop test calls the real Python engine several times.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: "test", ENGINE_TIME_LIMIT_SECONDS: "1", REPO: useDynamo ? "dynamo" : "memory", ...(useDynamo ? {} : { TABLE_PREFIX: "vaari-unit" }) },
    // Shared tables: run files one at a time against DynamoDB so demo resets do not collide.
    fileParallelism: !useDynamo,
    globalSetup: useDynamo ? ["./test/dynamo-global-setup.ts"] : [],
  },
});
