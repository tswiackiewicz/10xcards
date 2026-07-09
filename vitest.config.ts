/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

// Not using Astro's `getViteConfig` (astro/config): it pulls in the @astrojs/cloudflare
// adapter's Vite plugin, which sets `resolve.external` on its own `ssr` Vite Environment
// and hard-rejects Vitest's own use of that environment slot. Tests here never touch
// .astro files or JSX, so a plain Vitest config with the same `@/*` alias is sufficient.

// Route handlers import `astro:env/server`, a virtual module Astro's own Vite plugin
// normally resolves — unavailable here since that plugin is intentionally skipped above.
// Stand in with a virtual module reading the same process.env vars tests/setup/env.ts
// populates, so route-handler tests can import real route modules without booting Astro.
const ASTRO_ENV_SERVER_ID = "astro:env/server";

function astroEnvServerStub(): Plugin {
  return {
    name: "astro-env-server-stub",
    resolveId(id) {
      if (id === ASTRO_ENV_SERVER_ID) {
        return `\0${ASTRO_ENV_SERVER_ID}`;
      }
    },
    load(id) {
      if (id === `\0${ASTRO_ENV_SERVER_ID}`) {
        return [
          "export const SUPABASE_URL = process.env.SUPABASE_URL;",
          "export const SUPABASE_KEY = process.env.SUPABASE_KEY;",
          "export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;",
          "export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;",
          "export const CRON_PURGE_SECRET = process.env.CRON_PURGE_SECRET;",
        ].join("\n");
      }
    },
  };
}

// src/middleware.ts imports `defineMiddleware` from `astro:middleware`, another virtual
// module the skipped Astro Vite plugin normally resolves. Astro's own implementation
// (astro/dist/core/middleware/defineMiddleware.js) is just `(fn) => fn` — stub it
// identically so middleware tests can import the real `onRequest` export directly.
const ASTRO_MIDDLEWARE_ID = "astro:middleware";

function astroMiddlewareStub(): Plugin {
  return {
    name: "astro-middleware-stub",
    resolveId(id) {
      if (id === ASTRO_MIDDLEWARE_ID) {
        return `\0${ASTRO_MIDDLEWARE_ID}`;
      }
    },
    load(id) {
      if (id === `\0${ASTRO_MIDDLEWARE_ID}`) {
        return "export const defineMiddleware = (fn) => fn;";
      }
    },
  };
}

export default defineConfig({
  plugins: [astroEnvServerStub(), astroMiddlewareStub()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    // globalSetup (not setupFiles) so the env vars it writes to process.env are
    // inherited by forked test-worker processes, not just the setup process itself.
    globalSetup: ["tests/setup/env.ts"],
    include: ["tests/**/*.test.ts"],
    // account_deletions/purge is a real, globally-batched endpoint against one shared
    // local Supabase instance — two test files calling it concurrently can each claim
    // rows the other seeded, corrupting `deleted`/`skipped` counts. File-level
    // parallelism buys nothing here (tests are fast; the DB is the bottleneck either
    // way), so serialize files to keep every real-Supabase integration test hermetic
    // relative to the others.
    fileParallelism: false,
  },
});
