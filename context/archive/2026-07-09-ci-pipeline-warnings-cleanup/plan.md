# CI Pipeline Warnings Cleanup Implementation Plan

## Overview

The last passed CI run (`ci.yml`, run `28970632068`, `master`) is green but its logs
contain five actionable warnings — a missing sitemap, a deprecated Supabase config
section, a missing seed file, a noisy ESLint parser fallback, and a stale CLI
dependency. None of these fail the build today, but each represents either a silent
functional gap (no sitemap.xml in production) or noise that will make future real
regressions harder to spot in the logs. This plan clears all five.

A staging + production deployment pipeline was explored and partially implemented
in this change (see "Staging exploration, abandoned" below) before being reverted
in favor of keeping this repo's existing dev (local) + production shape.

## Current State Analysis

- `astro.config.mjs:15` registers `sitemap()` from `@astrojs/sitemap` but the config
  has no `site` option. Every build (both the `ci` and `deploy` jobs) logs:
  `[WARN] [@astrojs/sitemap] The Sitemap integration requires the site astro.config
option. Skipping.` — the integration produces no output at all.
- `supabase/config.toml:99` has a section named `[inbucket]`. The Supabase CLI logs
  `WARN: config section [inbucket] is deprecated. Please use [local_smtp] instead.`
  on every `supabase start` and `supabase db push --dry-run` invocation (4x in the
  last run, across both jobs).
- `supabase/config.toml:65` sets `db.seed.sql_paths = ["./seed.sql"]` under
  `[db.seed]` (`enabled = true`), but `supabase/seed.sql` does not exist in the repo.
  The CLI logs `WARN: no files matched pattern: supabase/seed.sql` once per
  `supabase start`.
- `eslint.config.js:14-21` defines `baseConfig` with no `files` restriction, setting
  `languageOptions.parserOptions.projectService: true`. Because it's unscoped, this
  also applies when ESLint parses `.astro` files via `astro-eslint-parser`
  (registered by `eslintPluginAstro.configs["flat/recommended"]` later in the config
  array). `astro-eslint-parser` doesn't support `projectService` and logs a warning
  once per `.astro` file — 15 occurrences in the last lint run.
  - `eslint-plugin-astro`'s own recommended config (`node_modules/eslint-plugin-astro/lib/index.js`)
    already sets `parserOptions: { project: null }` for parts of `.astro` parsing —
    it deliberately opts `.astro` files out of full project-based type-aware
    linting. The fix should stop leaking `projectService` into `.astro` parsing,
    not fight that existing choice by forcing `project: true` back on.
  - The only two non-`.astro`, non-`.ts`/`.tsx` files `baseConfig` currently covers
    are `eslint.config.js` and `astro.config.mjs` (confirmed via
    `git ls-files | grep -E '\.(js|mjs|cjs|jsx)$'`, excluding the ignored
    `scripts/**`). Any fix must keep linting those two files.
- `package-lock.json:13904` resolves the `supabase` devDependency
  (`package.json:63`, range `^2.23.4`) to `2.106.0`. `2.109.1` is available
  upstream; the CLI logs a "new version available" warning twice per `npm test`
  run. Unrelated to the `supabase/setup-cli@v2` GitHub Action used elsewhere in
  `ci.yml`, which already resolves `latest` independently.
- Deployment is single-target, direct-to-production: `wrangler.jsonc` defines one
  Worker (`10x-cards`), no `env` blocks. One Supabase project (`10xCards`, ref
  `xrvnzaxcmphdvfqhivtr`, `eu-north-1`). This plan keeps that shape.

## Desired End State

A subsequent CI run shows no `[@astrojs/sitemap] ... Skipping` warning (a
`sitemap-index.xml` is emitted under `dist/`), no `[inbucket] is deprecated`
warning, no `no files matched pattern: supabase/seed.sql` warning, no
`astro-eslint-parser does not support the projectService option` warning, and no
`new version of Supabase CLI is available` warning older than whatever is current
at merge time.

### Key Discoveries:

- `wrangler.jsonc` defines a single deployment target with no custom route — the
  production URL is the Cloudflare-assigned `https://10x-cards.tommy-swiacek-1fb.workers.dev/`.
- `package.json:63`'s range `^2.23.4` already permits `2.109.x`; the warning is a
  lockfile pinning issue, not a `package.json` range issue — bumping needs to update
  the resolved lockfile version (a `npm install supabase@latest --save-dev` covers
  both).

## What We're NOT Doing

- Not touching the transitive `@babel/plugin-proposal-private-methods` deprecation
  warning (comes from a nested dependency, not directly upgradable here).
- Not touching the `npm warn allow-scripts` notice (informational, doesn't fail CI).
- Not touching the GitHub Actions runner's `git init` default-branch hint (runner
  artifact, unrelated to this repo).
- Not adding real seed data to `supabase/seed.sql` — just an empty file to satisfy
  the configured `sql_paths` glob.
- Not changing the `supabase/setup-cli@v2` GitHub Action pin in `ci.yml` — it
  already resolves `latest` on every run.
- **No staging environment.** Explored and partially implemented in this change,
  then explicitly reverted — see "Staging exploration, abandoned" below. Deployment
  stays dev (local) + production, matching the repo's shape before this change.

## Implementation Approach

All five fixes are independent, single-file (or single-dependency) changes with no
cross-file coupling — they're grouped into one phase and verified together via the
same commands already run in CI (`lint`, `build`, `supabase start`), plus one local
`npx supabase start` pass to confirm the config.toml fixes before pushing.

## Staging exploration, abandoned

A staging + production pipeline (separate Supabase project, separate Cloudflare
Worker, GitHub Environments with a production approval gate) was designed and
partially implemented in this change, then reverted back to dev + production only.
Kept here as a record so the same dead ends aren't re-walked if staging is
reconsidered later:

- **Provisioned and since deleted**: a staging Supabase project (`10xCards-staging`)
  and a staging Cloudflare Worker (`10x-cards-staging`, plus its auto-provisioned
  `10x-cards-staging-session` KV namespace). Both were created, verified, and then
  torn down (`supabase projects delete`, `wrangler delete`, `wrangler kv namespace
delete`) as part of abandoning the approach — no orphaned cloud resources remain.
- **Astro 6 + `@astrojs/cloudflare` resolves Wrangler environments at _build_ time,
  not deploy time.** `wrangler deploy --env staging` has no effect on this adapter's
  generated `dist/server/wrangler.json` — confirmed by direct testing, a plain
  build always produces `"definedEnvironments": []` regardless of any `--env` flag
  passed later at deploy time. The correct mechanism would have been
  `CLOUDFLARE_ENV=staging npm run build` (env var on the **build** step), which
  does correctly bake the right Worker `name` into the generated config. Anyone
  reintroducing named-environment deploys with this adapter needs this, not
  `wrangler deploy --env <name>`.
- **`wrangler secret put --env staging` requires the named Worker to already exist**
  — it fails with `Worker "<name>" (env: staging) not found` against a Worker that
  has never been deployed. A first real deploy is a prerequisite for attaching
  secrets, not just for serving traffic.
- **Fetching live secret values (e.g. via `supabase projects api-keys --reveal`) and
  writing them to any file — even a private scratchpad — gets flagged as credential
  materialization**, correctly. The safe pattern is piping a value directly from its
  source into `wrangler secret put <NAME>` (which reads from stdin) within a single
  command, never through an intermediate file or a display step.
- Splitting a single `deploy` job into `deploy-staging`/`deploy-production` would
  have needed `if: github.ref == 'refs/heads/master'` copied onto _both_ new jobs
  explicitly (GitHub Actions does not propagate `if:` through `needs:`), and the
  `ci` job's existing migration dry-run would have needed an explicit
  `environment: staging` key once secrets moved to Environment scoping — otherwise
  it breaks with an opaque auth error, not a clear "secret not found."

## Phase 1: Clear pipeline warnings

### Overview

Apply all five fixes and verify each warning is gone, without changing any
functional behavior beyond what each warning implies is currently broken (sitemap
generation).

### Changes Required:

#### 1. Astro sitemap site option

**File**: `astro.config.mjs`

**Intent**: Give `@astrojs/sitemap` the `site` it needs to generate output instead
of silently skipping, without hardcoding the URL into committed source.

**Contract**: In `astro.config.mjs`, import `loadEnv` from `vite` and call
`loadEnv("", process.cwd(), "")` at module top level (before `defineConfig`),
then set `site: SITE_URL` (destructured from that result) — no literal
fallback anywhere in the file. `astro:env` doesn't work for this: it's a Vite
virtual module resolved for app code at request time, not accessible inside
`defineConfig()`, which runs as a plain Node script before Vite exists.
`loadEnv()` reads `.env`/`.env.local` directly and is itself overridden by a
real process env var of the same name if one is set (confirmed by direct
testing) — so a real CI/shell `SITE_URL` always wins over whatever `.env`
says. Local dev/build gets the value from `.env` (`SITE_URL=https://10x-cards.tommy-swiacek-1fb.workers.dev/`,
documented as a placeholder in `.env.example`); CI gets it from the GitHub
Actions repository **variable** `SITE_URL` (not a secret — the value is
public, ends up in `sitemap.xml`), wired into both the `ci` and `deploy`
jobs' `npm run build` steps via `env: { SITE_URL: ${{ vars.SITE_URL }} }`.
With no value from either source, `site` is `undefined` and
`@astrojs/sitemap` cleanly logs its original skip warning — confirmed by
direct testing, not a crash.

#### 2. Supabase local SMTP section rename

**File**: `supabase/config.toml`

**Intent**: Clear the CLI's deprecation warning by adopting the current section
name.

**Contract**: Rename the `[inbucket]` heading (line 99) to `[local_smtp]`. Keep all
existing keys under it (`enabled`, `port`, and the commented-out `smtp_port` /
`pop3_port` / `admin_email` / `sender_name` lines) unchanged.

#### 3. Supabase seed file

**File**: `supabase/seed.sql` (new file)

**Intent**: Satisfy the `db.seed.sql_paths = ["./seed.sql"]` glob so
`supabase start` stops warning that no files matched.

**Contract**: Create an empty `supabase/seed.sql`. No seed data — `[db.seed]`
stays `enabled = true` with the existing `sql_paths` untouched.

#### 4. ESLint baseConfig scoping

**File**: `eslint.config.js`

**Intent**: Stop `projectService: true` from reaching `.astro` files (where
`astro-eslint-parser` doesn't support it and falls back with a warning), without
narrowing coverage below what's linted today.

**Contract**: Add `files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"]` to
`baseConfig` (the `tseslint.config({...})` call at line 14) — every extension it
currently applies to, except `.astro`. Do not add any `parserOptions` override to
`astroConfig` — `eslint-plugin-astro`'s own recommended config already sets the
appropriate (non-project-aware) parser options for `.astro` files.

#### 5. Supabase CLI devDependency bump

**File**: `package.json`, `package-lock.json`

**Intent**: Clear the "new version available" warning `npm test` logs when it
spins up the local Supabase stack.

**Contract**: Run `npm install supabase@latest --save-dev` to update both the
`package.json` range and the `package-lock.json` resolution (including the
platform-specific `@supabase/cli-*` optional dependency versions) to whatever is
newest at implementation time.

### Success Criteria:

#### Automated Verification:

- [ ] Lint passes with no `projectService` warning in output: `npm run lint 2>&1 | grep -c "does not support the .projectService. option"` returns `0`
- [ ] Build succeeds: `npm run build`
- [ ] Build output contains no sitemap-skip warning: `npm run build 2>&1 | grep -c "Sitemap integration requires"` returns `0`
- [ ] Build emits a sitemap file: `test -f dist/client/sitemap-index.xml`
- [ ] `npx astro sync` still succeeds (per `AGENTS.md` CI parity)
- [ ] `npm test` passes: `npm test`
- [ ] `npx supabase db push --dry-run` produces no `[inbucket]` deprecation warning

#### Manual Verification:

- [ ] Run `npx supabase start` locally (Docker running) and confirm the output contains no `WARN: config section [inbucket] is deprecated` line and no `WARN: no files matched pattern: supabase/seed.sql` line
- [ ] Run `npx supabase stop` afterward to release local containers
- [ ] Confirm `npm test` no longer logs `A new version of Supabase CLI is available`
- [ ] Push and confirm the next `ci.yml` run on `master` shows none of the five warnings in either the `ci` or `deploy` job logs

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation that the manual testing was successful
before considering the change done.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — these are config/dependency fixes, not behavior changes with
  testable business logic. Existing `npm test` suite must continue to pass
  unchanged (regression guard).

### Integration Tests:

- Existing `npm run test:e2e` suite must continue to pass unchanged.

### Manual Testing Steps:

1. Run `npx supabase start`, inspect output for the two Supabase warnings, then
   `npx supabase stop`.
2. Run `npm run build`, inspect `dist/` for a generated sitemap file.
3. Run `npm run lint`, inspect output for the ESLint parser warning.
4. Push to a branch, open a PR (or push to `master` if working directly), watch the
   `ci.yml` run's logs for all five warning strings.

## Performance Considerations

None — all changes are config values or a dependency version bump; no runtime
code paths change.

## Migration Notes

Not applicable — no data model or schema changes. The `supabase/seed.sql` addition
only affects local `supabase db reset` / `supabase start` runs, not production data
(production Supabase migrations are unaffected).

## References

- CI run investigated: `https://github.com/tswiackiewicz/10xcards/actions/runs/28970632068`
- `astro.config.mjs:5,15` — sitemap integration registration
- `supabase/config.toml:60-65,97-107` — seed and local SMTP sections
- `eslint.config.js:14-38,62-69` — baseConfig and astroConfig blocks
- `package.json:63`, `package-lock.json:13901-13904` — supabase devDependency
- `.github/workflows/ci.yml` — `ci`/`deploy` jobs' `npm run build` steps, wired with `SITE_URL: ${{ vars.SITE_URL }}`
- GitHub Actions repository variable `SITE_URL` — created via `gh variable set`, value `https://10x-cards.tommy-swiacek-1fb.workers.dev/`
- `.env.example` — documents `SITE_URL` as a required-for-sitemap local placeholder

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Clear pipeline warnings

#### Automated

- [x] 1.1 Lint passes with no projectService warning — 6cf555f
- [x] 1.2 Build succeeds — 6cf555f
- [x] 1.3 Build output contains no sitemap-skip warning — 6cf555f
- [x] 1.4 Build emits a sitemap file — 6cf555f
- [x] 1.5 `npx astro sync` still succeeds — 6cf555f
- [x] 1.6 `npm test` passes — 6cf555f
- [x] 1.7 Supabase migration dry-run gate produces no [inbucket] warning — 6cf555f

#### Manual

- [x] 1.8 `npx supabase start` shows no [inbucket] / seed.sql warnings, then `npx supabase stop` — 6cf555f
- [x] 1.9 `npm test` no longer logs a pending Supabase CLI update — 6cf555f
- [x] 1.10 Next `ci.yml` run on `master` shows none of the five warnings — 6cf555f
- [x] 1.11 `SITE_URL` externalization (loadEnv + GH Actions variable) verified end-to-end in real CI run `29030359295`: zero skip warnings, correct sitemap URL in both `ci` and `deploy` jobs — 2b9377e
