import path from "node:path";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
