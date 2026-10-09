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
  // Landing photos are served at quality 80; Next 16 requires every quality used to be listed.
  images: { qualities: [75, 80] },
  // Slot links, farmer login links and /farmer: noindex and no referrer (src/lib/private-pages.ts).
  headers: privatePageHeaders,
};

export default withNextIntl(nextConfig);
