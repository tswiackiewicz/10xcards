# CI Pipeline Warnings Cleanup & Staging Pipeline Implementation Plan

## Overview

The last passed CI run (`ci.yml`, run `28970632068`, `master`) is green but its logs
contain five actionable warnings — a missing sitemap, a deprecated Supabase config
section, a missing seed file, a noisy ESLint parser fallback, and a stale CLI
dependency. Fixing the sitemap warning requires a `site` URL, and while
investigating where that URL should live, this plan grew to also stand up a real
staging environment: today this repo deploys directly to production on every push
to `master`, with no way to verify a change against a deployed Worker + a real
Supabase project before it's live. This plan clears the five original warnings
_and_ introduces a staging environment gated in front of production.

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
- **Deployment today is single-target, direct-to-production.** `wrangler.jsonc`
  defines one Worker (`10x-cards`), no `env` blocks. `.github/workflows/ci.yml` has
  one `ci` job (lint/test/build/migration-dry-run) and one `deploy` job
  (`if: github.ref == 'refs/heads/master'`) that pushes migrations for real and
  runs `wrangler deploy` straight to production. Only one Supabase project exists
  (`10xCards`, ref `xrvnzaxcmphdvfqhivtr`, `eu-north-1`). The repo is trunk-based —
  only `master` exists as a live branch (`git ls-remote --heads origin`).
- Secrets today are all repo-level: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
  `SUPABASE_PROJECT_ID` (used by both the `ci` job's dry-run step and the `deploy`
  job), plus `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (used only by `deploy`'s
  `wrangler-action` step). No GitHub Actions "variables" (`vars.*`) are used
  anywhere in this repo today.

## Desired End State

A subsequent CI run shows none of the five original warnings, and `dist/` contains
a generated sitemap. Beyond that: every push to `master` auto-deploys to a staging
Worker + staging Supabase project first; promoting to production requires a manual
approval (GitHub Environment protection rule) rather than happening unconditionally.
Both environments get their own correctly-baked sitemap `site` URL.

### Key Discoveries:

- `package.json:63`'s range `^2.23.4` already permits `2.109.x`; the CLI-version
  warning is a lockfile pinning issue, not a `package.json` range issue — bumping
  needs to update the resolved lockfile version (`npm install supabase@latest
--save-dev` covers both).
- **Wrangler `env.<name>` inheritance** (verified against Cloudflare's docs, not
  assumed): `name`, `compatibility_date`, `compatibility_flags`, `assets`,
  `observability`, and `main` are all "inheritable" from the top-level config. The
  dangerous case is `name` — if `env.staging` doesn't explicitly override it, a
  `--env staging` deploy silently reuses the production Worker's name (i.e.
  deploys _over_ production). `env.staging` therefore needs exactly one key.
- **GitHub Actions `if:` does not propagate through `needs:`.** The existing
  `deploy` job's `if: github.ref == 'refs/heads/master'` must be copied onto
  _both_ of its replacement jobs explicitly — `ci.yml` also triggers on
  `pull_request: branches: [master]`, so without this a PR run would attempt to
  execute the deploy jobs.
- **A job can only read secrets/variables scoped to a GitHub Environment it
  declares via its own `environment:` key.** The existing `ci` job's migration
  dry-run step has no `environment:` key today. Once `SUPABASE_PROJECT_ID` /
  `SUPABASE_DB_PASSWORD` move to being Environment-scoped, that step needs
  `environment: staging` added or it fails with an opaque auth error (the secrets
  resolve empty, not with a clear "not found").
- Shared account-level tokens (`CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`)
  don't give the two environments real blast-radius isolation on their own — the
  "required reviewers" rule gates job _execution_, not credential _scope_. A
  defense-in-depth assertion step is worth adding to each deploy job.

## What We're NOT Doing

- Not touching the transitive `@babel/plugin-proposal-private-methods` deprecation
  warning, the `npm warn allow-scripts` notice, or the GitHub Actions runner's
  `git init` default-branch hint — all noise, none actionable here.
- Not adding real seed data to `supabase/seed.sql` — just an empty file.
- Not changing the `supabase/setup-cli@v2` GitHub Action pin — already resolves
  `latest`.
- No 3rd "dev" deployed environment — "dev" stays local-only (`astro dev` +
  `supabase start`), matching today.
- No staging variant of `.github/workflows/purge.yml`'s scheduled cron —
  production-only feature, out of scope.
- Not changing `SUPABASE_ACCESS_TOKEN` / `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` scoping — they stay repo-level, shared across both
  environments (same Cloudflare/Supabase account either way).
- Not introducing a `develop` branch or any branch-based promotion model — the
  promotion gate is a GitHub Environment protection rule on the existing
  trunk-based (`master`-only) workflow.

## Implementation Approach

Phase 1 clears the five original warnings (independent, low-risk config/dependency
fixes). Phases 2-4 build the staging pipeline incrementally so each is safe to land
and verify on its own before the next depends on it: provision the staging
infrastructure first (no CI behavior changes yet), then configure GitHub's
repo-level Environment settings (still no CI behavior change), then — only once
both exist — restructure `ci.yml` to actually use them.

## Critical Implementation Details

**Wrangler `name` inheritance is a live footgun, not just a style nit.** If
`env.staging.name` is ever removed or misspelled, `wrangler deploy --env staging`
will not error — it will silently deploy to the production Worker under its own
name, because `name` inherits from the top level. Any change to `wrangler.jsonc`'s
`env` block must be verified by checking the _deployed Worker name_ in the
`wrangler-action` step's log output, not just that the deploy step succeeded.

**Job restructuring must preserve two independently-easy-to-drop guards.** The
`if: github.ref == 'refs/heads/master'` condition and the "Verify migrations fully
applied" guard step both currently exist exactly once, on the single `deploy` job.
Splitting into `deploy-staging` / `deploy-production` means both must be copied
into _each_ new job, not carried once and assumed inherited — GitHub Actions does
not inherit `if:` through `needs:`, and there is no shared-step mechanism across
jobs in this workflow.

**Build-then-deploy must happen twice, not once.** `SITE_URL` is baked into
`dist/`'s `sitemap-index.xml` at build time. `deploy-staging` and
`deploy-production` must each run their own full `npm run build` with their own
`SITE_URL` — reusing one job's `dist/` artifact for the other's deploy would ship
the wrong sitemap URL to one of the two environments.

## Phase 1: Clear pipeline warnings

### Overview

Apply the five original fixes and verify each warning is gone, without changing
any functional behavior beyond what each warning implies is currently broken
(sitemap generation).

### Changes Required:

#### 1. Astro sitemap site option

**File**: `astro.config.mjs`

**Intent**: Give `@astrojs/sitemap` the `site` it needs to generate output instead
of silently skipping, sourced so staging and production can each get their own
correct value (see Phase 4) while local/default builds still work unattended.

**Contract**: Add a top-level `site: process.env.SITE_URL ?? "https://10x-cards.tommy-swiacek-1fb.workers.dev/"`
to the `defineConfig({...})` object (alongside `output`, `security`,
`integrations`, etc.). The literal fallback is today's production URL, so a local
`npm run build` with no `SITE_URL` set behaves exactly as if this were still a
plain literal.

#### 2. Supabase local SMTP section rename

**File**: `supabase/config.toml`

**Intent**: Clear the CLI's deprecation warning by adopting the current section
name.

**Contract**: Rename the `[inbucket]` heading (line 99) to `[local_smtp]`. Keep all
existing keys under it unchanged.

#### 3. Supabase seed file

**File**: `supabase/seed.sql` (new file)

**Intent**: Satisfy the `db.seed.sql_paths = ["./seed.sql"]` glob so
`supabase start` stops warning that no files matched.

**Contract**: Create an empty `supabase/seed.sql`. No seed data — `[db.seed]`
stays `enabled = true` with the existing `sql_paths` untouched.

#### 4. ESLint baseConfig scoping

**File**: `eslint.config.js`

**Intent**: Stop `projectService: true` from reaching `.astro` files, without
narrowing coverage below what's linted today.

**Contract**: Add `files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"]` to
`baseConfig` (the `tseslint.config({...})` call at line 14) — every extension it
currently applies to, except `.astro`. Do not add any `parserOptions` override to
`astroConfig` — `eslint-plugin-astro`'s own recommended config already sets the
appropriate parser options for `.astro` files.

#### 5. Supabase CLI devDependency bump

**File**: `package.json`, `package-lock.json`

**Intent**: Clear the "new version available" warning `npm test` logs.

**Contract**: Run `npm install supabase@latest --save-dev` to update both the
`package.json` range and the `package-lock.json` resolution (including the
platform-specific `@supabase/cli-*` optional dependency) to whatever is newest at
implementation time.

### Success Criteria:

#### Automated Verification:

- [ ] Lint passes with no `projectService` warning: `npm run lint 2>&1 | grep -c "does not support the .projectService. option"` returns `0`
- [ ] Build succeeds: `npm run build`
- [ ] Build output contains no sitemap-skip warning: `npm run build 2>&1 | grep -c "Sitemap integration requires"` returns `0`
- [ ] Build emits a sitemap file under `dist/` (confirm exact output path during implementation)
- [ ] `npx astro sync` still succeeds
- [ ] `npm test` passes
- [ ] `npx supabase db push --dry-run` produces no `[inbucket]` deprecation warning

#### Manual Verification:

- [ ] `npx supabase start` locally shows no `[inbucket]` / `seed.sql` warnings, then `npx supabase stop`
- [ ] `npm test` no longer logs a pending Supabase CLI update
- [ ] Next `ci.yml` run on `master` shows none of the five warnings

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Provision staging infrastructure

### Overview

Stand up the staging Supabase project and staging Cloudflare Worker target. No
CI behavior changes yet — this phase only creates resources and the minimal
`wrangler.jsonc` config needed to address them later.

### Changes Required:

#### 1. Wrangler staging environment

**File**: `wrangler.jsonc`

**Intent**: Define a second deploy target distinct from production.

**Contract**: Add `"env": { "staging": { "name": "10x-cards-staging" } }`.
`compatibility_date`, `compatibility_flags`, `assets`, `observability`, and `main`
all inherit automatically from the top level — do not redeclare them.

#### 2. Staging Supabase project

**Action**: `supabase projects create` — same org (`rnyvpvzfizuirvpyfliu`) and
region (`eu-north-1`) as the existing production project, name it distinctly
(e.g. `10xCards-staging`).

**Intent**: An isolated database for staging so it never touches production data.

**Contract**: Resulting project ref and DB password are needed as inputs to
Phase 3's GitHub Environment secrets — record them there, not in the repo.

#### 3. Staging Supabase Auth redirect configuration

**Action**: In the new staging project's Auth settings, add the staging Worker's
URL (`https://10x-cards-staging.tommy-swiacek-1fb.workers.dev/**`) to the redirect
URL allowlist.

**Intent**: Without this, login/auth flows silently fail on staging even though
every other part of the deploy pipeline reports success.

#### 4. Staging Worker runtime secrets

**Action**: `wrangler secret put <NAME> --env staging` for each of the 5 secrets
`astro.config.mjs`'s `env.schema` expects (`SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `CRON_PURGE_SECRET`), using the
new staging Supabase project's own URL/keys — a fully separate secret set from
production's.

**Intent**: The staging Worker needs its own runtime credentials; it must never
share production's.

### Success Criteria:

#### Automated Verification:

- [ ] `wrangler.jsonc` validates: `npx wrangler deploy --dry-run --env staging`

#### Manual Verification:

- [ ] `supabase projects list` shows the new staging project as `ACTIVE_HEALTHY`
- [ ] Staging project's Auth redirect allowlist includes the staging Worker URL
- [ ] `wrangler secret list --env staging` shows all 5 expected secret names
- [ ] Note recorded (in this plan or an ops note) that if the staging project is
      ever recreated or its ref/keys rotated, all 5 secrets must be re-set —
      nothing in CI enforces this staying in sync

**Implementation Note**: Pause here for manual confirmation that the staging
project and Worker secrets are correctly provisioned before proceeding — Phase 3
and 4 both depend on this existing.

---

## Phase 3: Configure GitHub Environments

### Overview

Create the "staging" and "production" GitHub Environments and move the
per-project secrets into them, so `ci.yml` (restructured in Phase 4) can scope
credentials and gate production behind manual approval. No workflow file changes
in this phase.

### Changes Required:

#### 1. "staging" GitHub Environment

**Action**: Create Environment "staging" (no protection rules). Add secrets
`SUPABASE_PROJECT_ID` and `SUPABASE_DB_PASSWORD` (the new staging project's
values from Phase 2). Add variable `SITE_URL` = `https://10x-cards-staging.tommy-swiacek-1fb.workers.dev/`.

#### 2. "production" GitHub Environment

**Action**: Create Environment "production" with a required-reviewers protection
rule (at minimum the repo owner). Add secrets `SUPABASE_PROJECT_ID` and
`SUPABASE_DB_PASSWORD` with today's existing production values. Add variable
`SITE_URL` = `https://10x-cards.tommy-swiacek-1fb.workers.dev/`.

#### 3. Remove the now-redundant repo-level secrets

**Action**: Delete the repo-level `SUPABASE_PROJECT_ID` and
`SUPABASE_DB_PASSWORD` secrets once both Environments have their own copies —
avoids any ambiguity about which value a job without an `environment:` key would
otherwise resolve.

**Intent**: `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, and
`CLOUDFLARE_ACCOUNT_ID` stay as repo-level secrets, unchanged — they're
account-level credentials shared across both environments, not project-specific.

### Success Criteria:

#### Manual Verification:

- [ ] Repo Settings → Environments shows "staging" (no rules) and "production"
      (required reviewers) each with their own `SUPABASE_PROJECT_ID` /
      `SUPABASE_DB_PASSWORD` secrets and `SITE_URL` variable
- [ ] Repo-level `SUPABASE_PROJECT_ID` / `SUPABASE_DB_PASSWORD` secrets no longer
      exist (superseded by the Environment-scoped ones)
- [ ] `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
      remain as repo-level secrets, unchanged

**Implementation Note**: Pause here for manual confirmation — Phase 4's workflow
changes assume these Environments and secrets already exist exactly as described.

---

## Phase 4: Restructure CI workflow for staged rollout

### Overview

Wire `ci.yml` to actually use the staging/production split: the `ci` job's
migration dry-run needs a target environment, and the single `deploy` job becomes
two jobs with the promotion gate.

### Changes Required:

#### 1. `ci` job environment scoping

**File**: `.github/workflows/ci.yml`

**Intent**: Fix the migration dry-run step, which breaks once
`SUPABASE_PROJECT_ID`/`SUPABASE_DB_PASSWORD` stop existing as repo-level secrets
(per Phase 3).

**Contract**: Add `environment: staging` to the `ci` job. This is a job-level key,
not a step-level one — it makes the whole job's `secrets.*`/`vars.*` context
resolve against the "staging" Environment.

#### 2. Split `deploy` into `deploy-staging` and `deploy-production`

**File**: `.github/workflows/ci.yml`

**Intent**: Auto-deploy every `master` push to staging; gate production behind
manual approval via the Environment protection rule.

**Contract**: Replace the `deploy` job with two jobs sharing this shape (fill in
the existing steps — checkout, setup-node, npm ci, supabase setup-cli, wrangler-action
— per environment as noted):

```yaml
deploy-staging:
  needs: ci
  if: github.ref == 'refs/heads/master'
  environment: staging
  # ...steps: npm ci → npm run build (env: SITE_URL: ${{ vars.SITE_URL }}) →
  #   assert resolved SUPABASE_PROJECT_ID != production's ref (defense in depth) →
  #   supabase link + db push + "Verify migrations fully applied" guard →
  #   wrangler-action with command: "deploy --env staging"

deploy-production:
  needs: deploy-staging
  if: github.ref == 'refs/heads/master'
  environment: production
  # ...identical shape, command: "deploy" (default env)
```

Both jobs must carry `if: github.ref == 'refs/heads/master'` explicitly — it does
not propagate through `needs:`. Both must run their own full `npm run build` (see
Critical Implementation Details) and their own complete migration
link/push/verify sequence — neither is shared or optional to skip.

#### 3. Defense-in-depth environment assertion

**File**: `.github/workflows/ci.yml`

**Intent**: Cheap insurance against the shared-account-token blast-radius gap —
`CLOUDFLARE_API_TOKEN`/`SUPABASE_ACCESS_TOKEN` have no per-project boundary of
their own.

**Contract**: Near the top of each deploy job, add a step that asserts the
resolved `SUPABASE_PROJECT_ID` matches what that job expects (e.g.
`deploy-staging` asserts its ref is NOT the production ref `xrvnzaxcmphdvfqhivtr`,
failing loudly if it is).

### Success Criteria:

#### Automated Verification:

- [ ] `ci` job succeeds using staging-scoped secrets (migration dry-run passes)
- [ ] YAML is valid: `gh workflow view ci.yml` or a `--dry-run` lint if available

#### Manual Verification:

- [ ] Push to `master`: `deploy-staging` auto-runs; staging Worker is reachable
      and its sitemap reflects the staging `SITE_URL`
- [ ] Login/auth against the staging Supabase project works end-to-end (validates
      Phase 2's redirect-URL config)
- [ ] `deploy-production` pauses for manual approval; after approving, production
      deploys exactly as it does today (regression check) with its own correct
      sitemap URL
- [ ] Open a PR against `master` (don't push directly) and confirm neither
      `deploy-staging` nor `deploy-production` runs — validates the `if:` fix

**Implementation Note**: After this phase's automated verification passes, pause
for the full manual push-to-master-and-approve walkthrough before considering the
change done.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — config, infra, and workflow changes, not testable business
  logic. Existing `npm test` suite must continue to pass unchanged.

### Integration Tests:

- Existing `npm run test:e2e` suite must continue to pass unchanged.

### Manual Testing Steps:

1. Run `npx supabase start`, inspect output for the two Supabase warnings, then
   `npx supabase stop`.
2. Run `npm run build`, inspect `dist/` for a generated sitemap file.
3. Run `npm run lint`, inspect output for the ESLint parser warning.
4. Provision the staging Supabase project and Worker secrets (Phase 2); configure
   GitHub Environments (Phase 3).
5. Push to `master`; watch `deploy-staging` run automatically, verify the staging
   site and its auth flow; approve `deploy-production`; verify production is
   unaffected in behavior (only its sitemap-generation gap is now fixed).
6. Open a PR against `master` and confirm no deploy job runs.

## Performance Considerations

None — all changes are config values, a dependency bump, new cloud resources, and
CI workflow restructuring; no runtime code paths in the application itself change.

## Migration Notes

Phase 1's `supabase/seed.sql` addition only affects local `supabase db reset` /
`supabase start` runs. Phase 2's staging project starts empty — its first
`supabase db push` (via `deploy-staging`) applies all 4 existing migrations from
scratch, exactly as any fresh Supabase project would. Production is unaffected by
any change in this plan beyond the sitemap `site` fix.

## References

- CI run investigated: `https://github.com/tswiackiewicz/10xcards/actions/runs/28970632068`
- `astro.config.mjs:5,15` — sitemap integration registration
- `supabase/config.toml:60-65,97-107` — seed and local SMTP sections
- `eslint.config.js:14-38,62-69` — baseConfig and astroConfig blocks
- `package.json:63`, `package-lock.json:13901-13904` — supabase devDependency
- `wrangler.jsonc` — single-target Worker config, to gain an `env.staging` block
- `.github/workflows/ci.yml` — `ci` + `deploy` jobs, to become `ci` + `deploy-staging` + `deploy-production`
- `.github/workflows/purge.yml` — existing precedent for a full-URL secret (`PURGE_URL`), not reused here since `SITE_URL` is non-sensitive

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

### Phase 2: Provision staging infrastructure

#### Automated

- [ ] 2.1 `wrangler.jsonc` validates via `wrangler deploy --dry-run --env staging`

#### Manual

- [ ] 2.2 Staging Supabase project is `ACTIVE_HEALTHY`
- [ ] 2.3 Staging Auth redirect allowlist includes the staging Worker URL
- [ ] 2.4 `wrangler secret list --env staging` shows all 5 expected secrets
- [ ] 2.5 Secret-resync note recorded for future project/ref rotation

### Phase 3: Configure GitHub Environments

#### Manual

- [ ] 3.1 "staging" Environment exists with its own secrets + SITE_URL variable, no protection rules
- [ ] 3.2 "production" Environment exists with its own secrets + SITE_URL variable, required-reviewers rule
- [ ] 3.3 Repo-level SUPABASE_PROJECT_ID/SUPABASE_DB_PASSWORD secrets removed
- [ ] 3.4 SUPABASE_ACCESS_TOKEN/CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID remain repo-level, unchanged

### Phase 4: Restructure CI workflow for staged rollout

#### Automated

- [ ] 4.1 `ci` job succeeds using staging-scoped secrets
- [ ] 4.2 Workflow YAML is valid

#### Manual

- [ ] 4.3 Push to master auto-deploys staging with correct sitemap URL
- [ ] 4.4 Auth works end-to-end against staging
- [ ] 4.5 Production deploy pauses for approval, then deploys correctly after approving
- [ ] 4.6 A PR against master does not trigger either deploy job
