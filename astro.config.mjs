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
  security: {
    checkOrigin: true,
    // Astro computes sha256 hashes for its own bundled scripts and styles, which is the
    // only way islands can hydrate under a real CSP — a hash makes the browser ignore
    // 'unsafe-inline' in the same directive. Every route here is SSR, and for
    // non-prerendered routes Astro ships the policy as a `content-security-policy` HEADER
    // (the <meta http-equiv> element is the prerendered-page path). Inert under
    // `astro dev`, so the e2e suite cannot see it — verify against `astro preview`.
    //
    // Everything Astro will merge belongs HERE, not in src/middleware.ts: CSP honours the
    // FIRST occurrence of a directive, so a directive appended to an already-emitted header
    // is silently dead if Astro ever emits its own copy. The middleware still appends the
    // two style carve-outs because `style-src*` is the one family Astro's directive
    // allowlist rejects.
    csp: {
      directives: ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"],
    },
  },
  // The toolbar's Inspect app dumps every island's props into an in-DOM <pre><code>
  // tooltip on init, regardless of whether it's opened. e2e tests run against
  // `astro dev` (playwright.config.ts) and assert on visible flashcard text with
  // getByText, which strict-mode-matches that dump too (it contains the same text).
  devToolbar: { enabled: false },
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
