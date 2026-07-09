// @ts-check
import { defineConfig, envField } from "astro/config";
import { loadEnv } from "vite";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// astro.config.mjs runs as a plain Node script before Vite/astro:env exist, so `site`
// (resolved here, not at request time) can't come from astro:env — loadEnv() reads
// .env directly and is overridden by a real process env var (e.g. CI's SITE_URL) if set.
const { SITE_URL } = loadEnv("", process.cwd(), "");

// https://astro.build/config
export default defineConfig({
  output: "server",
  site: SITE_URL,
  // Destructive cookie-authed endpoints (POST /api/account/delete) depend on this —
  // pin it explicitly rather than relying on Astro's implicit default (see impl-review F5).
  security: { checkOrigin: true },
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      CRON_PURGE_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
