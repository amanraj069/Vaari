/**
 * The farmer's session token never reaches the browser: the proxy refuses the two API routes that
 * answer with one, and /api/farmer/otp/verify keeps it in the httpOnly cookie, passing refusals on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ apiFetch: vi.fn(), setFarmerSession: vi.fn() }));
vi.mock("@/lib/session", () => session);
vi.mock("server-only", () => ({}));

import { GET as proxyGet, POST as proxyPost } from "@/app/api/proxy/[...path]/route";
import { POST as verifyPost } from "@/app/api/farmer/otp/verify/route";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const post = (url: string, body: unknown, origin = "http://localhost:3000") => new Request(url, { method: "POST", body: JSON.stringify(body), headers: { origin, "content-type": "application/json" } });

beforeEach(() => {
  session.apiFetch.mockReset();
  session.setFarmerSession.mockReset();
});

describe("the proxy and farmer sessions", () => {
  it.each([["farmer", "login"], ["farmer", "otp", "verify"], ["farmer", "otp", "verify", ""]])("never forwards %s", async (...path) => {
    const response = await proxyPost(post(`http://localhost:3000/api/proxy/${path.join("/")}`, {}), { params: Promise.resolve({ path }) });
    expect(response.status).toBe(404);
    expect(session.apiFetch).not.toHaveBeenCalled();
  });

  it("forwards asking for a code", async () => {
    session.apiFetch.mockResolvedValue(json(200, { channel: "demo" }));
    const response = await proxyPost(post("http://localhost:3000/api/proxy/farmer/otp/request", { purpose: "login" }), { params: Promise.resolve({ path: ["farmer", "otp", "request"] }) });
    expect(response.status).toBe(200);
    expect(session.apiFetch).toHaveBeenCalledWith("/farmer/otp/request", expect.objectContaining({ method: "POST" }));
  });
});

describe("the proxy and the officer's dashboard", () => {
  it("forwards the officer's overview, and nothing outside the allowed prefixes", async () => {
    session.apiFetch.mockResolvedValue(json(200, { totals: {} }));
    const overview = await proxyGet(new Request("http://localhost:3000/api/proxy/officer/overview"), { params: Promise.resolve({ path: ["officer", "overview"] }) });
    expect(overview.status).toBe(200);
    expect(session.apiFetch).toHaveBeenCalledWith("/officer/overview", expect.anything());
    session.apiFetch.mockClear();
    const other = await proxyGet(new Request("http://localhost:3000/api/proxy/whatsapp/webhook"), { params: Promise.resolve({ path: ["whatsapp", "webhook"] }) });
    expect(other.status).toBe(404);
    expect(session.apiFetch).not.toHaveBeenCalled();
  });
});

describe("/api/farmer/otp/verify", () => {
  it("keeps the session in the cookie and answers without it", async () => {
    session.apiFetch.mockResolvedValue(json(200, { sessionToken: "secret-session", expiresIn: 604800, registered: false }));
    const response = await verifyPost(post("http://localhost:3000/api/farmer/otp/verify", { phone: "+447700900201", code: "123456" }));
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ signedIn: true, registered: false });
    expect(session.setFarmerSession).toHaveBeenCalledWith("secret-session", 604800);
    expect(await response.text()).not.toContain("secret-session");
  });

  it("passes a refusal on, sets nothing, and refuses another origin", async () => {
    session.apiFetch.mockResolvedValue(json(401, { error: "CODE_WRONG", attemptsLeft: 2 }));
    const refused = await verifyPost(post("http://localhost:3000/api/farmer/otp/verify", { phone: "+447700900201", code: "000000" }));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "CODE_WRONG", attemptsLeft: 2 });
    const foreign = await verifyPost(post("http://localhost:3000/api/farmer/otp/verify", {}, "https://evil.example"));
    expect(foreign.status).toBe(403);
    expect(session.setFarmerSession).not.toHaveBeenCalled();
  });
});
