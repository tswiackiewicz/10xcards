import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE_PATH } from "./tests/e2e/paths";

const PORT = 4321; // astro dev's default; no override in astro.config.mjs or package.json
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI runners are slower and astro dev compiles each route on first hit —
  // the auth setup's first-ever POST /api/auth/signin can outrun the
  // default 30s action timeout on a cold route. Local dev stays at 30s.
  timeout: process.env.CI ? 60_000 : 30_000,
  reporter: "html",

  // Reuses the same env-population helper Vitest uses — a plain, Vitest-agnostic
  // function that shells `supabase status -o env` and sets SUPABASE_URL /
  // SUPABASE_SERVICE_ROLE_KEY on process.env before workers fork.
  globalSetup: "./tests/setup/env.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },

  webServer: {
    // Deliberately `astro dev`, not build+preview+Wrangler: scoped to local
    // development of the seed test. CI wiring (which would need a build+preview
    // or Wrangler-preview decision) is separate, out of scope here.
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE_PATH },
      dependencies: ["setup"],
    },
  ],
});
