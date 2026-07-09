# CI Pipeline Warnings Cleanup & Staging Pipeline — Plan Brief

> Full plan: `context/changes/ci-pipeline-warnings-cleanup/plan.md`

## What & Why

The last passed CI run (`ci.yml`, run `28970632068` on `master`) is fully green,
but its logs carry five warnings worth clearing — the most significant being that
no sitemap is ever generated in production. Fixing that requires a `site` URL,
and deciding where that URL should live led to a bigger question: this repo
deploys straight to production on every push, with no way to verify a change
against a real deployed environment first. This plan clears the five warnings and
adds a staging environment gated in front of production.

## Starting Point

`astro.config.mjs` has no `site` option, `supabase/config.toml` uses a deprecated
section name and points at a missing seed file, `eslint.config.js` leaks a
TypeScript-only parser option into `.astro` files, and the `supabase`
devDependency is pinned to an outdated CLI version. Deployment-wise: one
Cloudflare Worker, one Supabase project, one `deploy` job that runs unconditionally
on every push to `master` — no staging, no approval gate, no branch model beyond
trunk-based `master`.

## Desired End State

The next `ci.yml` run on `master` shows none of the five original warnings, and
`dist/` contains a real sitemap. Beyond that: every push to `master` auto-deploys
to a staging Worker + staging Supabase project; promoting to production requires
a manual approval instead of happening unconditionally, and both environments get
their own correctly-baked sitemap URL.

## Key Decisions Made

| Decision                      | Choice                                                                                                                          | Why (1 sentence)                                                                                                                                 | Source |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Sitemap `site` value          | `process.env.SITE_URL ?? "<production literal>"`                                                                                | Lets staging and production each get their own value once Phase 4 wires `vars.SITE_URL` in; local builds still work unattended                   | Plan   |
| Site URL storage mechanism    | GitHub Actions **variable** (`vars.SITE_URL`), not a secret                                                                     | Value is public (ends up in `sitemap.xml`) — secrets get log-redacted, which is actively unhelpful for a non-sensitive value                     | Plan   |
| Missing seed file             | Add empty `supabase/seed.sql`                                                                                                   | Matches the starter template's existing `db.seed.enabled = true` intent, minimal diff                                                            | Plan   |
| ESLint `.astro` warning fix   | Scope `baseConfig`'s `files` to exclude `.astro` only                                                                           | Preserves current lint coverage for `eslint.config.js`/`astro.config.mjs`; avoids re-fighting `eslint-plugin-astro`'s own `project: null` choice | Plan   |
| Supabase CLI version target   | Bump to latest via `npm install supabase@latest --save-dev`                                                                     | Matches the "latest" resolution already used by `supabase/setup-cli@v2` in CI                                                                    | Plan   |
| Deployed environments         | Exactly 2: staging + production ("dev" stays local-only)                                                                        | Matches how this size of project actually gets used; a 3rd deployed "dev" target adds provisioning cost for little benefit                       | Plan   |
| Promotion model               | Auto-deploy to staging on push to `master`; production gated by a GitHub Environment required-reviewers rule                    | No new branch model needed — repo is trunk-based (`master`-only) today; avoids branch-sync overhead                                              | Plan   |
| Staging Supabase provisioning | `supabase projects create` via CLI during implementation                                                                        | Scripted and repeatable, vs. a manual dashboard step between planning and implementation                                                         | Plan   |
| Secret/variable scoping       | `SUPABASE_PROJECT_ID`/`SUPABASE_DB_PASSWORD`/`SITE_URL` per-Environment; `SUPABASE_ACCESS_TOKEN`/`CLOUDFLARE_*` stay repo-level | Only the project-specific credentials need to differ; account-level tokens are shared either way                                                 | Plan   |

## Scope

**In scope:**

- Original 5 warning fixes: `astro.config.mjs`, `supabase/config.toml`,
  `supabase/seed.sql`, `eslint.config.js`, `package.json`/`package-lock.json`
- New staging Supabase project + staging Cloudflare Worker (`wrangler.jsonc` env
  block)
- GitHub Environments ("staging", "production") with scoped secrets/variables and
  a production approval gate
- `.github/workflows/ci.yml` restructuring: `ci` job environment scoping, `deploy`
  split into `deploy-staging` + `deploy-production`

**Out of scope:**

- Transitive dependency warnings, `npm warn allow-scripts`, GitHub Actions runner
  hints (all noise, non-actionable)
- Real seed data (file stays empty)
- A 3rd deployed "dev" environment
- A staging variant of `purge.yml`'s scheduled cron
- Any branch-based promotion model (`develop` branch, etc.)
- Re-scoping `SUPABASE_ACCESS_TOKEN`/`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`

## Architecture / Approach

Four phases, each safe to land independently: (1) the five original config fixes,
independent of everything else; (2) provision staging infrastructure (Supabase
project, Worker config, secrets) with zero CI behavior change yet; (3) configure
GitHub Environments (repo settings, still no workflow change); (4) restructure
`ci.yml` to actually use both — only once phases 2-3 exist. This ordering means
each phase's manual verification only depends on what's already landed, not on
anything still ahead of it.

## Phases at a Glance

| Phase                               | What it delivers                                              | Key risk                                                                    |
| ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Clear pipeline warnings          | All 5 original warnings gone, sitemap generated               | ESLint scoping regex accidentally narrows lint coverage below current state |
| 2. Provision staging infrastructure | Staging Supabase project + Worker config + runtime secrets    | Forgetting the Auth redirect URL config — auth silently breaks on staging   |
| 3. Configure GitHub Environments    | Scoped secrets/vars, production approval gate                 | Precedence ambiguity if repo-level secrets aren't removed after migrating   |
| 4. Restructure CI workflow          | Auto-staging, approval-gated production, both correctly wired | `if:` condition or migration-verify guard silently dropped on job split     |

**Prerequisites:** Docker running locally (Phase 1 verification); Cloudflare + Supabase account access for provisioning (Phase 2); repo admin access for GitHub Environment settings (Phase 3).
**Estimated effort:** ~1 session for Phase 1; ~1-2 sessions for Phases 2-4 given real infra provisioning and manual verification steps.

## Open Risks & Assumptions

- Wrangler's `name` key is technically "inheritable" in `env` blocks — if
  `env.staging.name` is ever dropped, staging deploys silently overwrite
  production instead of erroring. Flagged explicitly in the plan's Critical
  Implementation Details.
- Shared account-level tokens (`CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`)
  mean the two GitHub Environments gate _when_ a job runs, not _what_ it's
  credentialed to touch — mitigated with a defense-in-depth assertion step in
  Phase 4, but not eliminated.
- Nothing in CI enforces that the staging Worker's 5 runtime secrets stay in sync
  if the staging Supabase project is ever recreated or its ref rotated — a manual
  runbook item, not automated.
- Assumes `npm install supabase@latest --save-dev` resolves to `2.109.1` or newer
  at implementation time — "latest" is the target, not a specific pin.

## Success Criteria (Summary)

- A subsequent CI run on `master` logs none of the five original warnings.
- `dist/` contains a generated sitemap after `npm run build`.
- Every push to `master` auto-deploys to staging with a correct staging sitemap
  URL and working auth; production requires manual approval and then deploys
  correctly with its own sitemap URL.
- A PR against `master` triggers neither deploy job.
