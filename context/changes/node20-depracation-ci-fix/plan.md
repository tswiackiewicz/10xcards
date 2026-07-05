# Node 20 Deprecation & Lint Warning CI Fix Implementation Plan

## Overview

The latest CI run (`a0ddaccc0e95ec131ea3a1a747b3d5aa8eaed6cc`, run 28709266812) passed but carried two warning annotations: a GitHub Actions Node 20 deprecation notice on `supabase/setup-cli@v1`, and an ESLint `no-console` warning on an intentional diagnostic log in `tests/helpers/auth.ts`. Both are fixed independently with no behavior change to the CI pipeline's actual checks.

## Current State Analysis

- `.github/workflows/ci.yml:22` (job `ci`) and `:52` (job `deploy`) both pin `supabase/setup-cli@v1`, which ships as `runs: using: node20` (confirmed via `gh api repos/supabase/setup-cli/contents/action.yml?ref=v1.7.1`). GitHub Actions force-upgrades Node 20 actions to run on Node 24 and emits: _"Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: supabase/setup-cli@v1."_
- `supabase/setup-cli@v2.1.1` (latest, released 2026-05-21) is a full rewrite to a Bun-based composite action (`runs: using: composite`) — no Node runtime declaration at all, so the deprecation warning cannot fire against it.
- The `version` input is unchanged in meaning: v2's `src/main.ts` still defines `DEFAULT_VERSION = "latest"` and accepts the literal `"latest"` the workflow already passes (`version: latest` at both call sites). No input contract change.
- `tests/helpers/auth.ts:57` has `console.warn(...)` inside `cleanupUser`'s `.catch()`, added in commit `ddbbda9` specifically to surface cleanup failures instead of swallowing them. This trips the repo's `"no-console": "warn"` ESLint rule (`eslint.config.js:23`).
- The repo already has an established convention for intentional `console.*` calls: `src/pages/api/cron/purge.ts:59,76` each carry `// eslint-disable-next-line no-console -- <reason>` directly above the call. `tests/helpers/auth.ts:57` is the only console statement in the repo missing this suppression (confirmed via local `npm run lint` — it's the only reported warning).
- `no-console` is `"warn"`, and `npm run lint` (`eslint .`) has no `--max-warnings 0`, so this warning never fails CI — it's cosmetic but noisy on every run.

## Desired End State

Pushing to a branch and opening a PR against `master` triggers CI, and the resulting `ci` job's check-run annotations contain neither the Node 20 deprecation warning nor the `no-console` warning on `tests/helpers/auth.ts:57`. The `ci` and `deploy` jobs' actual checks (lint, tests, build, migration dry-run) behave identically to before — only the two warning annotations disappear.

### Key Discoveries:

- `.github/workflows/ci.yml:22,52` — both `supabase/setup-cli@v1` call sites need the same bump; they use identical `with: { version: latest }` inputs.
- `tests/helpers/auth.ts:57` — sole unsuppressed console call in the repo; `src/pages/api/cron/purge.ts:59,76` is the pattern to mirror.
- `gh api repos/{owner}/{repo}/check-runs/{id}/annotations` is the mechanism to inspect post-fix annotations (used during original triage).

## What We're NOT Doing

- Not touching `src/pages/api/cron/purge.ts` — its console calls are already suppressed correctly; out of scope for these two warnings.
- Not auditing or bumping other actions in the workflow (`actions/checkout@v7`, `actions/setup-node@v6`, `cloudflare/wrangler-action@v4`) — none are flagged, and doing so would expand scope beyond the reported warnings (confirmed via user decision).
- Not changing the `no-console` rule's severity or scope in `eslint.config.js`.
- Not staging the `deploy` job's `supabase/setup-cli` bump separately from the `ci` job's — both bump together, verified by the `ci` job's identical action/version/inputs on the PR run (confirmed via user decision).

## Implementation Approach

Two-line action-version bump plus one suppression comment, verified end-to-end by opening a real PR and inspecting the live CI run's annotations — since GitHub Actions deprecation warnings and ESLint annotations can only be observed against an actual run, not simulated locally beyond confirming `npm run lint` is clean.

## Phase 1: Fix the two warnings

### Overview

Apply the action version bump and the lint suppression identified during triage.

### Changes Required:

#### 1. Bump supabase/setup-cli to v2

**File**: `.github/workflows/ci.yml`

**Intent**: Eliminate the Node 20 deprecation warning by moving off the Node20-runtime action version.

**Contract**: Change `uses: supabase/setup-cli@v1` to `uses: supabase/setup-cli@v2` at both line 22 (job `ci`) and line 52 (job `deploy`). The `with: { version: latest }` block under each stays unchanged — the input contract is identical between v1 and v2.

#### 2. Suppress the intentional console warning

**File**: `tests/helpers/auth.ts`

**Intent**: Silence the `no-console` warning on the deliberate `cleanupUser` diagnostic log, following the repo's existing suppression convention rather than removing the log or downgrading the rule.

**Contract**: Add a reason-bearing eslint-disable directive immediately above line 57's `console.warn(...)` call, matching the style of `src/pages/api/cron/purge.ts:59,76`:

```ts
// eslint-disable-next-line no-console -- surfaces cleanupUser failures instead of swallowing them (test hygiene)
console.warn(`cleanupUser(${id}) failed: ${err instanceof Error ? err.message : String(err)}`);
```

### Success Criteria:

#### Automated Verification:

- [ ] Local lint is clean of the `no-console` warning: `npm run lint` reports no warning for `tests/helpers/auth.ts`
- [ ] Full lint still passes with no new errors introduced: `npm run lint`
- [ ] Type checking still passes: `npx astro sync && npm run build`

#### Manual Verification:

- [ ] Diff reviewed: only the two call sites in `ci.yml` (`@v1`→`@v2`) and the one comment line in `auth.ts` changed — no other lines touched

---

## Phase 2: Verify via a real CI run

### Overview

Prove the fix against an actual GitHub Actions run rather than local simulation, since the Node 20 deprecation annotation only surfaces in a live workflow run.

### Changes Required:

No further code changes. This phase pushes the Phase 1 commit to a branch and opens a PR against `master` (the workflow's `pull_request: branches: [master]` trigger fires the same `ci` job used on push).

### Success Criteria:

#### Automated Verification:

- [ ] PR's `ci` job run completes with conclusion `success`: `gh run list --branch <branch>`
- [ ] PR's `ci` job check-run has zero annotations, or annotations no longer include the Node 20 deprecation message or the `auth.ts:57` `no-console` warning: `gh api repos/{owner}/{repo}/check-runs/<job-id>/annotations`
- [ ] `npm test` step within the run still passes (confirms `supabase/setup-cli@v2` correctly provides a working `supabase` CLI for `supabase start`)
- [ ] `Check Supabase migrations apply cleanly` step still passes (confirms `supabase link` + `supabase db push --dry-run` work under the v2 action)

#### Manual Verification:

- [ ] Open the PR's Checks tab in the GitHub UI and visually confirm no yellow warning annotations remain on the `ci` job
- [ ] Merge the PR to `master` and confirm the `deploy` job (using the same `supabase/setup-cli@v2` bump) completes successfully, since it only truly executes post-merge

**Implementation Note**: After Phase 2's automated verification passes, pause for manual confirmation that the PR's Checks tab is clean before merging to `master`.

---

## Testing Strategy

### Unit Tests:

- None added — this change touches CI configuration and a lint suppression comment, not application logic. Existing test suite (`npm test`) is the regression guard that the action bump didn't break the Supabase CLI setup.

### Integration Tests:

- The existing `Check Supabase migrations apply cleanly` CI step (dry-run) is the integration check that `supabase/setup-cli@v2` still provides a working CLI for migration operations.

### Manual Testing Steps:

1. Push the Phase 1 commit to a new branch and open a PR against `master`.
2. Wait for the `ci` job to complete; inspect its annotations via `gh api repos/{owner}/{repo}/check-runs/<job-id>/annotations`.
3. Confirm the Node 20 deprecation message and the `auth.ts:57` `no-console` warning are both absent.
4. Merge to `master`; confirm the `deploy` job (migrations push + `wrangler deploy`) completes successfully.

## Performance Considerations

None — this change does not affect application runtime behavior, only CI tooling and a code comment.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Original triage: this conversation's CI run inspection (`gh api repos/tswiackiewicz/10xcards/runs/28709266812/...`)
- Existing suppression pattern: `src/pages/api/cron/purge.ts:59,76`
- `supabase/setup-cli` v2 rewrite: `gh api repos/supabase/setup-cli/contents/action.yml?ref=v2.1.1`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix the two warnings

#### Automated

- [x] 1.1 Local lint is clean of the `no-console` warning — 7ee0471
- [x] 1.2 Full lint still passes with no new errors introduced — 7ee0471
- [x] 1.3 Type checking still passes — 7ee0471

#### Manual

- [x] 1.4 Diff reviewed: only the two call sites and the one comment line changed — 7ee0471

### Phase 2: Verify via a real CI run

#### Automated

- [x] 2.1 PR's `ci` job run completes with conclusion `success`
- [x] 2.2 PR's `ci` job check-run has zero relevant annotations
- [x] 2.3 `npm test` step within the run still passes
- [x] 2.4 `Check Supabase migrations apply cleanly` step still passes

#### Manual

- [x] 2.5 Checks tab visually confirmed clean of warning annotations
- [x] 2.6 Post-merge `deploy` job completes successfully
