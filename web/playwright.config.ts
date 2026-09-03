import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const fixtures = process.env.PLAYWRIGHT_FIXTURES === "1";
if (fixtures && [".env", ".env.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"].some((file) => existsSync(file))) {
  throw new Error("Fixture tests require a clean web directory without local env files. Use a fresh clone; do not remove your working credentials.");
}

const configuredPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "3210", 10);
const port = Number.isFinite(configuredPort) ? configuredPort : 3210;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: fixtures
      ? `npm run dev -- --port ${port}`
      : `sh -c 'if [ -f ../.env ]; then set -a; . ../.env; set +a; fi; npm run dev -- --port ${port}'`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !fixtures && !process.env.CI,
    env: fixtures ? {
      NEXT_PUBLIC_CIVILMCP_REQUIRE_AUTH: "false",
      CIVILMCP_REQUIRE_AUTH: "false",
      CIVILMCP_OPEN_ACCESS: "true",
      NEXT_PUBLIC_CIVILMCP_OPEN_ACCESS: "true",
      GUEST_SESSION_HMAC_KEY: "fixture-only-not-a-production-secret",
      NEXT_TELEMETRY_DISABLED: "1",
    } : undefined,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
