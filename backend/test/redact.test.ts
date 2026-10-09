/** Never log tokens: slot and farmer-login tokens are cut out of every logged URL. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { devLines } from "../src/app";
import { redactUrl, requestSerializer } from "../src/http/redact";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJzbG90In0.c2lnbmF0dXJl";

describe("token redaction", () => {
  it("cuts the token out of slot and farmer-login paths, and keeps the rest readable", () => {
    expect(redactUrl(`/slot/${TOKEN}`)).toBe("/slot/[redacted]");
    expect(redactUrl(`/slot/${TOKEN}/why?lang=pa`)).toBe("/slot/[redacted]/why?lang=pa");
    expect(redactUrl(`/slot/${TOKEN}/waiting-limit`)).toBe("/slot/[redacted]/waiting-limit");
    expect(redactUrl(`/farmer/login/${TOKEN}`)).toBe("/farmer/login/[redacted]");
    expect(redactUrl(`/api/proxy/slot/${TOKEN}?lang=en`)).toBe("/api/proxy/slot/[redacted]?lang=en");
    expect(redactUrl("/operator/board")).toBe("/operator/board");
    expect(redactUrl("/farmer/home?lang=hi")).toBe("/farmer/home?lang=hi");
  });

  it("the request serializer the API logger uses keeps only method and a redacted URL", () => {
    expect(requestSerializer({ method: "GET", url: `/slot/${TOKEN}/why` })).toEqual({ method: "GET", url: "/slot/[redacted]/why" });
  });

  describe("the development log line", () => {
    afterEach(() => vi.restoreAllMocks());

    it("never prints a token, even from a raw request URL", () => {
      const printed: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        printed.push(String(chunk));
        return true;
      });
      devLines.write(JSON.stringify({ level: 50, time: Date.now(), msg: "unhandled error", req: { method: "GET", url: `/slot/${TOKEN}` }, res: { statusCode: 500 } }));
      expect(printed.join("")).toContain("GET /slot/[redacted] -> 500");
      expect(printed.join("")).not.toContain(TOKEN);
    });
  });
});
