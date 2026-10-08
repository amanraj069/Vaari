import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Runs as a container on ECS Fargate (not Amplify), so build a standalone server.
  output: "standalone",
  // The Playwright suite runs its own dev server next to yours, in a separate build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Landing photos are served at quality 80; Next 16 requires every quality used to be listed.
  images: { qualities: [75, 80] },
};

export default withNextIntl(nextConfig);
