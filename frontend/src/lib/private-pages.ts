/**
 * Pages reached with a secret in the URL (slot links, farmer login links) or that show one farmer's
 * fields (/farmer): never indexed, and never sending the URL on as a referrer. The same rule is set
 * twice on purpose: as HTTP headers (next.config.ts, for any client) and as page metadata (the
 * <meta> tags, for anything that ignores the headers).
 */
export const PRIVATE_PAGE_HEADERS = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

export const PRIVATE_PAGE_SOURCES = ["/slot/:path*", "/farmer", "/farmer/:path*"];

export const PRIVATE_PAGE_METADATA = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
} as const;

/** The headers() entry for next.config.ts. */
export async function privatePageHeaders() {
  return PRIVATE_PAGE_SOURCES.map((source) => ({ source, headers: PRIVATE_PAGE_HEADERS }));
}
