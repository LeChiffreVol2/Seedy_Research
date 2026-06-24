import path from "node:path";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Load root-level .env so the whole project can use a single env file.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep local monorepo builds stable without overriding Vercel's project root.
  outputFileTracingRoot: process.env.VERCEL ? undefined : path.resolve(__dirname, ".."),
};

export default nextConfig;
