import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen here is per-user and per-workspace, so pages render on request.
  cacheComponents: false,
  serverExternalPackages: ["mongoose"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
