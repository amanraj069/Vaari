import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Runs as a container on ECS Fargate (not Amplify), so build a standalone server.
  output: "standalone",
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
