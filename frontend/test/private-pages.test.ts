/** Slot links, farmer login links and /farmer: never indexed, never sent on as a referrer (headers and page metadata). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_PAGE_HEADERS, PRIVATE_PAGE_METADATA, PRIVATE_PAGE_SOURCES, privatePageHeaders } from "@/lib/private-pages";

describe("private pages", () => {
  it("send noindex and no-referrer on slot links, login links and /farmer", async () => {
    expect(PRIVATE_PAGE_HEADERS).toEqual([
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ]);
    expect(PRIVATE_PAGE_SOURCES).toEqual(["/slot/:path*", "/farmer", "/farmer/:path*", "/dashboard", "/dashboard/:path*"]);
    expect(await privatePageHeaders()).toEqual(PRIVATE_PAGE_SOURCES.map((source) => ({ source, headers: PRIVATE_PAGE_HEADERS })));
    expect(PRIVATE_PAGE_METADATA).toEqual({ robots: { index: false, follow: false }, referrer: "no-referrer" });
  });

  it("next.config.ts wires those headers in", () => {
    const config = readFileSync(path.resolve(__dirname, "../next.config.ts"), "utf8");
    expect(config).toMatch(/headers: privatePageHeaders/);
    for (const layout of ["src/app/slot/[token]/layout.tsx", "src/app/farmer/layout.tsx"]) {
      expect(readFileSync(path.resolve(__dirname, "..", layout), "utf8")).toMatch(/metadata: Metadata = PRIVATE_PAGE_METADATA/);
    }
  });
});
