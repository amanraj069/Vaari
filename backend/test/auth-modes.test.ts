/** Demo sessions keep working when Cognito is switched on, and stop when DEMO_MODE is off. */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { AuthError, createTokenVerifier, mintDemoToken } from "../src/auth/tokens";
import { MemoryStore } from "../src/store/memory";

const user = { userId: "u1", name: "Harpal", role: "operator" as const, chcId: "chc-a", language: "en" as const };

async function setup(environment: Record<string, string>) {
  const config = loadConfig({ NODE_ENV: "test", ...environment });
  const store = new MemoryStore();
  await store.putUser(user);
  const { token } = await mintDemoToken(config, user);
  return { verifier: createTokenVerifier(config, store), token };
}

describe("auth modes", () => {
  it("accepts demo sessions alongside Cognito", async () => {
    const { verifier, token } = await setup({ AUTH_MODE: "cognito", DEMO_MODE: "true", COGNITO_USER_POOL_ID: "us-east-1_TESTPOOL1", COGNITO_CLIENT_ID: "testclient" });
    await expect(verifier.verify(token)).resolves.toMatchObject({ userId: "u1", role: "operator", demo: true });
  });
  it("rejects demo sessions when DEMO_MODE is off", async () => {
    const { verifier, token } = await setup({ AUTH_MODE: "cognito", DEMO_MODE: "false", COGNITO_USER_POOL_ID: "us-east-1_TESTPOOL1", COGNITO_CLIENT_ID: "testclient" });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthError);
  });
  it("rejects garbage", async () => {
    const { verifier } = await setup({ AUTH_MODE: "demo" });
    await expect(verifier.verify("not-a-jwt")).rejects.toBeInstanceOf(AuthError);
  });
  it("a stored 'farmer' role from before farmers lost their accounts grants nothing", async () => {
    const config = loadConfig({ NODE_ENV: "test", AUTH_MODE: "demo" });
    const store = new MemoryStore();
    // An old DynamoDB row: role "farmer" is no longer a role.
    await store.putUser({ ...user, userId: "old-farmer", role: "farmer" as never });
    const { token } = await mintDemoToken(config, { userId: "old-farmer" });
    await expect(createTokenVerifier(config, store).verify(token)).resolves.toMatchObject({ userId: "old-farmer", role: null });
  });
});
