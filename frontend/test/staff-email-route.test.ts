/**
 * /api/auth/email: staff email sign-in through Cognito's own API, server side. Passwords go to
 * Cognito only; tokens land in httpOnly cookies (setSession), never in the answer; Cognito's
 * refusals come back as codes the form turns into words; only our own pages may call it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => {
  const values = new Map<string, string>();
  return { values, set: vi.fn((name: string, value: string) => values.set(name, value)), get: (name: string) => (values.has(name) ? { value: values.get(name) } : undefined), delete: vi.fn() };
});
vi.mock("next/headers", () => ({ cookies: async () => jar, headers: async () => new Headers() }));
const session = vi.hoisted(() => ({ setSession: vi.fn(), setRoleCookie: vi.fn() }));
vi.mock("@/lib/session", () => session);

type Route = typeof import("@/app/api/auth/email/route");
let POST: Route["POST"];
const cognitoCalls: { target: string; body: Record<string, unknown> }[] = [];
let cognitoAnswers: Record<string, { status: number; body: unknown }> = {};
let me: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  vi.stubEnv("AUTH_MODE", "cognito");
  vi.stubEnv("COGNITO_CLIENT_ID", "client-123");
  vi.stubEnv("COGNITO_DOMAIN", "https://vaari.auth.ap-south-1.amazoncognito.com");
  vi.stubEnv("API_URL", "http://api.test");
  ({ POST } = await import("@/app/api/auth/email/route"));
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  cognitoCalls.length = 0;
  cognitoAnswers = {};
  jar.values.clear();
  session.setSession.mockReset();
  session.setRoleCookie.mockReset();
  me = { status: 200, body: { userId: "u1", name: "Harpal", role: "operator", chcId: "chc-balian", language: "en", demo: false, needsOnboarding: false } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://api.test/me") return new Response(JSON.stringify(me.body), { status: me.status });
      expect(url).toBe("https://cognito-idp.ap-south-1.amazonaws.com/");
      const target = new Headers(init?.headers).get("x-amz-target")!.split(".")[1]!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      cognitoCalls.push({ target, body });
      const answer = cognitoAnswers[target] ?? { status: 200, body: {} };
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});

const post = (body: unknown, origin = "http://localhost:3000") => POST(new Request("http://localhost:3000/api/auth/email", { method: "POST", body: JSON.stringify(body), headers: { origin, "content-type": "application/json" } }));
const TOKENS = { AuthenticationResult: { AccessToken: "access-token", RefreshToken: "refresh-token", ExpiresIn: 3600 } };

describe("/api/auth/email", () => {
  it("signs in: the tokens go to the session cookies, never into the answer; the person goes to their page", async () => {
    cognitoAnswers.InitiateAuth = { status: 200, body: TOKENS };
    const response = await post({ step: "signIn", email: " Harpal@Example.org ", password: "Secret-123", pick: "operator" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ next: "/operator" });
    expect(text).not.toContain("access-token");
    expect(cognitoCalls).toEqual([{ target: "InitiateAuth", body: { ClientId: "client-123", AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: "harpal@example.org", PASSWORD: "Secret-123" } } }]);
    expect(session.setSession).toHaveBeenCalledWith("access-token", 3600, "pending", "refresh-token");
    expect(session.setRoleCookie).toHaveBeenCalledWith("operator");
    expect(jar.values.get("vaari_role_pick")).toBe("operator");
  });

  it("a new account: sign up, then the emailed code confirms it and signs in, on to /welcome", async () => {
    expect(await (await post({ step: "signUp", name: "Gurpreet Kaur", email: "g@example.org", password: "Secret-123", pick: "helper" })).json()).toEqual({ confirm: true });
    expect(cognitoCalls[0]).toEqual({
      target: "SignUp",
      body: { ClientId: "client-123", Username: "g@example.org", Password: "Secret-123", UserAttributes: [{ Name: "email", Value: "g@example.org" }, { Name: "name", Value: "Gurpreet Kaur" }] },
    });
    cognitoAnswers.InitiateAuth = { status: 200, body: TOKENS };
    me = { status: 200, body: { userId: "u2", name: "g@example.org", role: null, chcId: null, language: "en", demo: false, needsOnboarding: true } };
    expect(await (await post({ step: "confirm", email: "g@example.org", code: "123456", password: "Secret-123", name: "Gurpreet Kaur", pick: "helper" })).json()).toEqual({ next: "/welcome" });
    expect(cognitoCalls.map((call) => call.target)).toEqual(["SignUp", "ConfirmSignUp", "InitiateAuth"]);
    expect(cognitoCalls[1]!.body).toMatchObject({ Username: "g@example.org", ConfirmationCode: "123456" });
    // /welcome greets them by name and knows they picked "village helper".
    expect(jar.values.get("vaari_name")).toBe("Gurpreet Kaur");
    expect(jar.values.get("vaari_role_pick")).toBe("helper");
  });

  it("turns Cognito's refusals into codes, with fitting statuses", async () => {
    const cases: [string, string, number][] = [
      ["NotAuthorizedException", "WRONG_LOGIN", 401],
      ["UserNotConfirmedException", "NOT_CONFIRMED", 400],
      ["UsernameExistsException", "EMAIL_TAKEN", 409],
      ["InvalidPasswordException", "WEAK_PASSWORD", 400],
      ["CodeMismatchException", "CODE_WRONG", 400],
      ["LimitExceededException", "TOO_MANY", 429],
      ["InternalErrorException", "UNAVAILABLE", 502],
    ];
    for (const [type, code, status] of cases) {
      cognitoAnswers.InitiateAuth = { status: 400, body: { __type: `com.amazonaws#${type}`, message: "no" } };
      const response = await post({ step: "signIn", email: "a@example.org", password: "x" });
      expect([type, response.status, await response.json()]).toEqual([type, status, { error: code }]);
    }
    expect(session.setSession).not.toHaveBeenCalled();
  });

  it("forgot password: the same answer for an unknown email; then the code and new password reset it", async () => {
    cognitoAnswers.ForgotPassword = { status: 400, body: { __type: "UserNotFoundException", message: "no" } };
    expect(await (await post({ step: "forgot", email: "nobody@example.org" })).json()).toEqual({ sent: true });
    delete cognitoAnswers.ForgotPassword;
    expect(await (await post({ step: "forgot", email: "harpal@example.org" })).json()).toEqual({ sent: true });
    expect(await (await post({ step: "reset", email: "harpal@example.org", code: "654321", password: "New-Pass1" })).json()).toEqual({ reset: true });
    expect(cognitoCalls.at(-1)).toEqual({ target: "ConfirmForgotPassword", body: { ClientId: "client-123", Username: "harpal@example.org", ConfirmationCode: "654321", Password: "New-Pass1" } });
    cognitoAnswers.ForgotPassword = { status: 400, body: { __type: "LimitExceededException", message: "slow down" } };
    expect((await post({ step: "forgot", email: "harpal@example.org" })).status).toBe(429);
  });

  it("refuses another site, bad input, and a role nobody can pick", async () => {
    expect((await post({ step: "signIn", email: "a@example.org", password: "x" }, "https://evil.example")).status).toBe(403);
    expect((await post({ step: "signIn", email: "not-an-email", password: "x" })).status).toBe(400);
    expect((await post({ step: "confirm", email: "a@example.org", code: "12ab", password: "x" })).status).toBe(400);
    expect((await post({ step: "signIn", email: "a@example.org", password: "x", pick: "farmer" })).status).toBe(400);
    expect(cognitoCalls).toHaveLength(0);
  });
});
