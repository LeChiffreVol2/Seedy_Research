import path from "node:path";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Next loads the web directory first; force a second pass so the root-level
// environment remains the single source of truth for direct `npm run dev` too.
loadEnvConfig(path.resolve(__dirname, ".."), process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow release verification to build beside a running local preview.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Keep local monorepo builds stable without overriding Vercel's project root.
  outputFileTracingRoot: process.env.VERCEL ? undefined : path.resolve(__dirname, ".."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Permissions-Policy", value: "tools=(self)" },
          { key: "Origin-Agent-Cluster", value: "?1" },
        ],
      },
    ];
  },
};

export default nextConfig;
