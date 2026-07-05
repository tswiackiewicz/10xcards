# Node 20 Deprecation & Lint Warning CI Fix — Plan Brief

> Full plan: `context/changes/node20-depracation-ci-fix/plan.md`

## What & Why

The latest CI run passed but carried two warning annotations: a GitHub Actions Node 20 deprecation notice on `supabase/setup-cli@v1`, and an ESLint `no-console` warning on an intentional diagnostic log in a test helper. Neither fails the build today, but both are noise on every run and the Node 20 warning will eventually become a hard failure once GitHub fully retires the runtime.

## Starting Point

`.github/workflows/ci.yml` pins `supabase/setup-cli@v1` at two call sites (`ci` job line 22, `deploy` job line 52); v1 ships as a Node 20 action, forcing GitHub's runner to upgrade it to Node 24 and warn about it. Separately, `tests/helpers/auth.ts:57` has a `console.warn` (added deliberately in a prior commit to surface `cleanupUser` cleanup failures) that isn't suppressed the way the repo's other intentional console calls (`src/pages/api/cron/purge.ts:59,76`) are.

## Desired End State

A PR's CI run shows zero warning annotations for these two issues — the `ci` job's Checks tab is clean, and the `deploy` job (which shares the same action bump) completes successfully post-merge. No functional behavior changes.

## Key Decisions Made

| Decision               | Choice                                                      | Why (1 sentence)                                                                                 | Source |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Verification method    | Open a PR and inspect the live CI run's annotations         | The Node 20 warning only surfaces in a real GitHub Actions run, not locally                      | Plan   |
| Lint suppression style | `eslint-disable-next-line no-console` with a reason comment | Matches the existing convention already used in `purge.ts`                                       | Plan   |
| Scope                  | Strictly these two warnings                                 | Matches the surgical-changes rule — no unrelated action bumps                                    | Plan   |
| Deploy job timing      | Bump both `ci` and `deploy` job call sites together         | They use the identical action/version/inputs; the `ci` job's PR run is a faithful proof for both | Plan   |

## Scope

**In scope:**

- Bump `supabase/setup-cli@v1` → `@v2` at both call sites in `.github/workflows/ci.yml`
- Add a reason-bearing `eslint-disable-next-line no-console` above `tests/helpers/auth.ts:57`
- Verify via a real PR + CI run

**Out of scope:**

- `src/pages/api/cron/purge.ts` (already correctly suppressed)
- Other workflow actions (`actions/checkout`, `actions/setup-node`, `cloudflare/wrangler-action`) — not flagged
- Changing the `no-console` ESLint rule itself

## Architecture / Approach

Two independent, mechanical fixes in the same commit: a version-pin bump (v1→v2, confirmed input-compatible — `version: latest` still resolves the same way) and a one-line lint suppression following an existing repo pattern. Verification happens against a real GitHub Actions run since the deprecation warning is runner-generated, not locally reproducible.

## Phases at a Glance

| Phase                       | What it delivers                                     | Key risk                                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Fix the two warnings     | Action version bump + lint suppression comment       | Very low — confirmed input compatibility and suppression pattern already in the codebase                                                                                                                                   |
| 2. Verify via a real CI run | Confirmed-clean PR run, successful post-merge deploy | `supabase/setup-cli@v2`'s Bun-based install could behave differently in the runner than v1's Node-based one — mitigated by the `ci` job's dry-run migration check and `npm test` step catching any regression before merge |

**Prerequisites:** None — no new secrets, dependencies, or access required.
**Estimated effort:** ~15 minutes: one commit, one PR, one CI run to inspect.

## Open Risks & Assumptions

- Assumes `supabase/setup-cli@v2`'s Bun-based composite action installs correctly on the `ubuntu-latest` runner without additional dependencies (v1 was Node-based; confirmed v2's action.yml has Linux/musl handling but standard Ubuntu runners aren't musl-based, so this is a non-issue in practice).
- Assumes no other unsuppressed console statements exist elsewhere that lint might newly surface — confirmed via local `npm run lint`, which reported only the one warning.

## Success Criteria (Summary)

- A PR's CI run shows no Node 20 deprecation annotation and no `no-console` annotation on `tests/helpers/auth.ts:57`
- All existing CI checks (lint, tests, build, migration dry-run) still pass unchanged
- Post-merge `deploy` job completes successfully with the bumped action
