import { defineConfig } from "vitest/config";

// Tests touch real DynamoDB tables only when REPO=dynamo AND TABLE_PREFIX ends in "-test".
// Anything else runs on the in-memory store, so a stray REPO=dynamo can never hit dev or prod data.
const prefix = process.env.TABLE_PREFIX ?? "";
const useDynamo = process.env.REPO === "dynamo" && prefix.endsWith("-test");
// The sign-in tests' numbers (+91 90000 00000 to 00999) are demo farmer phones: their codes show on
// screen, as a demo account's do. Never a real person's number.
const demoFarmerPhones = Array.from({ length: 1000 }, (_, index) => `+919000000${String(index).padStart(3, "0")}`).join(",");

export default defineConfig({
  test: {
    environment: "node",
    // The core-loop test calls the real Python engine several times.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: "test", ENGINE_TIME_LIMIT_SECONDS: "1", DEMO_FARMER_PHONES: demoFarmerPhones, REPO: useDynamo ? "dynamo" : "memory", ...(useDynamo ? {} : { TABLE_PREFIX: "vaari-unit" }) },
    // Shared tables: run files one at a time against DynamoDB so demo resets do not collide.
    fileParallelism: !useDynamo,
    globalSetup: useDynamo ? ["./test/dynamo-global-setup.ts"] : [],
  },
});
