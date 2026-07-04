/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Not using Astro's `getViteConfig` (astro/config): it pulls in the @astrojs/cloudflare
// adapter's Vite plugin, which sets `resolve.external` on its own `ssr` Vite Environment
// and hard-rejects Vitest's own use of that environment slot. Tests here never touch
// .astro files or JSX, so a plain Vitest config with the same `@/*` alias is sufficient.
export default defineConfig({
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
  },
});
