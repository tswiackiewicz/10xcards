# CI Pipeline Warnings Cleanup — Plan Brief

> Full plan: `context/changes/ci-pipeline-warnings-cleanup/plan.md`

## What & Why

The last passed CI run (`ci.yml`, run `28970632068` on `master`) is fully green, but
its logs carry five warnings worth clearing: one is a real functional gap (no
sitemap is ever generated in production), the rest are noise that will make future
real regressions harder to spot in the logs.

## Starting Point

`astro.config.mjs` registers `@astrojs/sitemap` with no `site` option (so it
silently skips), `supabase/config.toml` uses a deprecated section name and points
at a seed file that doesn't exist, `eslint.config.js`'s base config leaks a
TypeScript-only parser option into `.astro` files, and the `supabase` devDependency
is pinned in the lockfile to an outdated CLI version.

## Desired End State

The next `ci.yml` run on `master` shows none of these five warnings in either the
`ci` or `deploy` job logs, and `dist/` contains an actual generated sitemap.
Deployment stays dev (local) + production, unchanged from before this change.

## Key Decisions Made

| Decision                    | Choice                                                            | Why (1 sentence)                                                                                                                                              | Source |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sitemap `site` value        | Literal string `https://10x-cards.tommy-swiacek-1fb.workers.dev/` | Single fixed deployment target (no envs/routes in `wrangler.jsonc`) — nothing to derive it from                                                               | Plan   |
| Missing seed file           | Add empty `supabase/seed.sql`                                     | Matches the starter template's existing `db.seed.enabled = true` intent, minimal diff                                                                         | Plan   |
| ESLint `.astro` warning fix | Scope `baseConfig`'s `files` to exclude `.astro` only             | Preserves current lint coverage for `eslint.config.js`/`astro.config.mjs`; avoids re-fighting `eslint-plugin-astro`'s own `project: null` choice for `.astro` | Plan   |
| Supabase CLI version target | Bump to latest via `npm install supabase@latest --save-dev`       | Matches the "latest" resolution already used by `supabase/setup-cli@v2` in CI                                                                                 | Plan   |
| Deployed environments       | Keep dev (local) + production only, no staging                    | A staging pipeline was explored and partially built, then explicitly reverted — see the full plan's "Staging exploration, abandoned" section                  | Plan   |

## Scope

**In scope:**

- `astro.config.mjs` — add `site` option
- `supabase/config.toml` — rename `[inbucket]` → `[local_smtp]`
- `supabase/seed.sql` — add empty file
- `eslint.config.js` — scope `baseConfig` away from `.astro`
- `package.json` / `package-lock.json` — bump `supabase` devDependency

**Out of scope:**

- Transitive `@babel/plugin-proposal-private-methods` deprecation warning
- `npm warn allow-scripts` notice
- GitHub Actions runner's `git init` default-branch hint
- Real seed data (file stays empty)
- The `supabase/setup-cli@v2` GitHub Action pin (already resolves `latest`)
- A staging environment (explored, built, and reverted within this change)

## Architecture / Approach

Five independent, single-file config/dependency fixes with no cross-file coupling.
Grouped into one phase, verified together via the same commands CI already runs
(`lint`, `build`, `supabase start`) plus one local `supabase start` pass before
pushing.

## Phases at a Glance

| Phase                      | What it delivers                       | Key risk                                                               |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| 1. Clear pipeline warnings | All 5 warnings gone, sitemap generated | ESLint scoping regex accidentally narrows coverage below current state |

**Prerequisites:** Docker running locally (for `npx supabase start` verification).
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumed `npm install supabase@latest --save-dev` at implementation time resolved
  to `2.109.1` or newer — confirmed; "latest" was the target, not a specific pin.

## Success Criteria (Summary)

- A subsequent CI run on `master` logs none of the five warning strings identified
  in this investigation, in either the `ci` or `deploy` job.
- `dist/` contains a generated sitemap file after `npm run build`.
- `npm test`, `npm run test:e2e`, `npm run lint`, and `npm run build` all still pass.
