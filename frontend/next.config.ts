import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { privatePageHeaders } from "./src/lib/private-pages";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // A self-contained Node server: runs on Amplify Hosting (server rendering) or in a container.
  output: "standalone",
  // The Playwright suite runs its own dev server next to yours, in a separate build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Next's dev-only "N" button sits bottom-left by default, on top of the dashboard sidebar's account.
  devIndicators: { position: "bottom-right" },
  // Landing photos are served at quality 80; Next 16 requires every quality used to be listed.
  images: { qualities: [75, 80] },
  // Slot links, farmer login links and the dashboard: noindex and no referrer (src/lib/private-pages.ts).
  headers: privatePageHeaders,
  // Every role's pages moved into one dashboard (2026-10-10). Old addresses keep working, so links
  // already sent or bookmarked still open. /farmer and /farmer/new are routed by the middleware
  // instead (a farmer without a session goes to the farmer sign-in).
  redirects: async () => [
    { source: "/operator", destination: "/dashboard", permanent: false },
    { source: "/operator/plan", destination: "/dashboard/plan", permanent: false },
    { source: "/operator/queue", destination: "/dashboard/queue", permanent: false },
    { source: "/officer", destination: "/dashboard", permanent: false },
    { source: "/book", destination: "/dashboard/book", permanent: false },
  ],
};

export default withNextIntl(nextConfig);
