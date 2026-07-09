---
change_id: ci-pipeline-warnings-cleanup
title: CI pipeline warnings cleanup
status: impl_reviewed
created: 2026-07-09
updated: 2026-07-09
archived_at: null
---

## Notes

Investigated the last passed pipeline run (workflow `ci.yml`, run 28970632068,
`master`, both `ci` and `deploy` jobs green). No errors, but several warnings
surfaced. Scope for this change:

1. `astro.config.mjs` registers `@astrojs/sitemap` but sets no `site` option
   → sitemap generation is skipped on every build. Production URL to use:
   `https://10x-cards.tommy-swiacek-1fb.workers.dev/`.
2. `supabase/config.toml` still uses the deprecated `[inbucket]` section name
   → rename to `[local_smtp]`.
3. `supabase/config.toml`'s `db.seed.sql_paths` points at `./seed.sql`, which
   doesn't exist → `WARN: no files matched pattern: supabase/seed.sql`.
4. `eslint.config.js`'s `baseConfig` sets `parserOptions.projectService: true`
   with no `files` scope, so it also applies to `.astro` files; `astro-eslint-parser`
   doesn't support `projectService` and falls back to `project: true` with a
   warning logged once per `.astro` file linted (~15x in the last run).
5. The `supabase` npm devDependency is pinned via lockfile resolution to
   `2.106.0` while `2.109.1` is available upstream → bump it.

Not in scope (noise, not actionable): transitive `@babel/plugin-proposal-private-methods`
deprecation warning, `npm warn allow-scripts` notice, GitHub Actions runner's
`git init` default-branch hint.

A staging + production deployment pipeline was explored and partially built
during implementation (staging Supabase project, staging Cloudflare Worker,
GitHub Environments), then explicitly reverted back to dev (local) + production
only. All provisioned cloud resources were torn down. See `plan.md`'s "Staging
exploration, abandoned" section for what was learned along the way.

Post-review follow-up: the `site` URL was moved out of source entirely — no
literal anywhere in `astro.config.mjs`. It now reads `SITE_URL` via Vite's
`loadEnv()` (from `.env` locally) and via a new GitHub Actions repository
**variable** `SITE_URL` in CI, wired into both jobs' build steps. Verdict from
the earlier impl-review (APPROVED) still holds — this is a refinement of
already-reviewed work, not new scope.
