/**
 * Slot routes are rate-limited per farmer, not per Next server. The Next proxy sends the browser's
 * address in x-vaari-client-ip with x-vaari-proxy-secret; the API believes the address only with
 * the right secret. Two clients behind the same proxy get separate limits; a caller who forges
 * the header without the secret is limited on their own address.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from "../src/http/client-ip";
import { buildRuntime } from "../src/server";

const SECRET = "test-proxy-secret-of-at-least-32-characters";
const LIMIT = 3;
let app: ReturnType<typeof createApp>;
let slotToken = "";

const viaProxy = (clientIp: string, secret = SECRET) => ({ [CLIENT_IP_HEADER]: clientIp, [PROXY_SECRET_HEADER]: secret });

beforeAll(async () => {
  const runtime = await buildRuntime({ freshDemo: true });
  app = createApp({ ...runtime.dependencies, config: { ...runtime.dependencies.config, PROXY_SHARED_SECRET: SECRET, SLOT_RATE_LIMIT_PER_MINUTE: LIMIT } });
  const operator = (await request(app).post("/auth/demo").send({ role: "operator" }).expect(200)).body.accessToken;
  slotToken = (await request(app).get("/fields/f-jaswinder/slot-link").set({ authorization: `Bearer ${operator}` }).expect(200)).body.token;
});

describe("slot rate limits", () => {
  it("give two clients behind the proxy separate limits", async () => {
    for (let call = 0; call < LIMIT; call += 1) await request(app).get(`/slot/${slotToken}`).set(viaProxy("203.0.113.10")).expect(200);
    await request(app).get(`/slot/${slotToken}`).set(viaProxy("203.0.113.10")).expect(429);
    // Same proxy, another farmer: unaffected.
    await request(app).get(`/slot/${slotToken}`).set(viaProxy("203.0.113.20")).expect(200);
    // IPv6 clients are keyed too.
    await request(app).get(`/slot/${slotToken}`).set(viaProxy("2001:db8::1")).expect(200);
  });

  it("ignore a client address sent without the proxy's secret", async () => {
    // A direct caller rotating forged addresses: all of them count against the caller's own address.
    for (let call = 0; call < LIMIT; call += 1) {
      await request(app).get(`/slot/${slotToken}`).set(viaProxy(`198.51.100.${call + 1}`, "wrong-secret-wrong-secret-wrong-secret")).expect(200);
    }
    await request(app).get(`/slot/${slotToken}`).set(viaProxy("198.51.100.99", "wrong-secret-wrong-secret-wrong-secret")).expect(429);
    await request(app).get(`/slot/${slotToken}`).set({ [CLIENT_IP_HEADER]: "198.51.100.100" }).expect(429);
  });

  it("ignore a malformed client address even with the secret", async () => {
    // Not an IP: falls back to the connection's address, which the previous test used up.
    await request(app).get(`/slot/${slotToken}`).set(viaProxy("not-an-ip")).expect(429);
  });
});
