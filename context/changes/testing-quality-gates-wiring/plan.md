# Quality-Gates Wiring (Rollout Phase 4) Implementation Plan

## Overview

Close the two deliverables `context/foundation/test-plan.md` §3 Phase 4 still owes: a CI gate that proves a schema migration actually reached production before deploy proceeds (Risk #5), and full CI enforcement of the AI-review e2e smoke — including closing a real coverage gap in the smoke test itself (the negative half of Risk #2: a rejected candidate must never be silently saved).

## Current State Analysis

A prior session (commit `694f9d2`) already bootstrapped Playwright end-to-end: `playwright.config.ts` (chromium-only, `webServer: npm run dev`, `globalSetup: tests/setup/env.ts` — the same Supabase-env sourcing Vitest uses), `tests/e2e/auth.setup.ts` + `global-teardown.ts` (storageState pattern, real seeded user via `tests/helpers/auth.ts`), and `tests/e2e/seed.spec.ts` (one passing test: mocked generate → accept → save → verify via `/cards`). That commit's own message explicitly scoped out CI wiring and the migration-drift gate — this plan picks those up.

`.github/workflows/ci.yml`'s `deploy` job (`:39-69`) already runs a real `supabase db push` (`:55-62`) immediately before `wrangler deploy` (`:64-68`), with nothing verifying the push actually resulted in zero pending migrations. The `ci` job's own dry-run check (`:30-37`) links to the same production project via the same secrets but only ever previews — it never runs post-push and is not itself a live-schema check.

`package.json` already carries `test:e2e` / `test:e2e:install` scripts; neither is invoked anywhere in `.github/workflows/ci.yml`.

### Key Discoveries:

- The Supabase CLI has no scriptable, exit-code-based "are migrations fully applied" check. `supabase migration list` (`internal/migration/list/list.go`) only ever returns an error on a connection failure, never on drift — it's display-only. `supabase db push --dry-run` never itself exits non-zero, in either state (`internal/db/push/push.go`) — but it does print a deterministic sentinel, `"<target> is up to date."`, when nothing is pending, and a different `"Would push these migrations:"` block otherwise. This is the only usable machine-checkable signal (confirmed by reading the CLI's Go source directly, not just its docs).
- `playwright.config.ts`'s `globalSetup` already reuses `tests/setup/env.ts`, so wiring e2e into the `ci` job needs zero new secret plumbing — the same `supabase start` step already in `ci` (`:25`) is sufficient.
- Placing the e2e step inside the existing `ci` job (rather than a new job) means it inherits whatever required-status-check configuration already applies to `ci` — no new required-check name needs to be registered in GitHub's branch-protection UI.
- `tests/e2e/seed.spec.ts` only proves the accept→save path of Risk #2; it never asserts a rejected candidate is absent from the saved deck — the actual "silently saved" failure mode the risk statement names.

## Desired End State

The `deploy` job fails (before `wrangler deploy` runs) if any migration remains unapplied after the real push. The `ci` job runs the full Playwright suite — including a rejected-candidate-is-never-saved assertion — on every push/PR to `master`, using the same local Supabase instance already started for Vitest.

**Verification**: a deliberately desynced scratch Supabase project makes the new `deploy` step fail; deliberately breaking `GenerateView.tsx`'s accept-filter makes the extended e2e test fail; a normal `git push` to `master` runs both gates green end-to-end.

## What We're NOT Doing

- Not building a full e2e suite — scope stays the single AI-review-flow smoke test family, per `test-plan.md` §1's cost×signal principle.
- Not adding a permanent automated regression test for the migration-gate script itself (e.g., a scratch-project test that runs on every CI run) — the scratch-project rehearsal is a one-time manual proof during implementation, not ongoing CI infrastructure. A permanent live-drift-simulation test would need its own disposable Supabase project wired into CI as a new secret-bearing dependency, which is disproportionate to a single grep check.
- Not changing `astro dev` to a build+preview or Wrangler-preview server for e2e — the existing `webServer` config already works and is reused as-is.
- Not touching the `ci` job's existing dry-run check (`:30-37`) — it's a different, complementary check (pre-merge preview vs. post-push proof) and stays as-is.
- Not configuring GitHub branch-protection required-status-checks via API/code — that's a manual, repo-external action; this plan only reminds.

## Implementation Approach

Three phases, each independently shippable: the migration gate (pure CI YAML, no app code), the e2e coverage extension (test-writing against an already-built feature — routed through `/10x-e2e` per this repo's `CLAUDE.md`, not written directly here), then the CI wiring that actually runs the extended suite on every push/PR. Coverage extension is sequenced before CI wiring so the very first CI run already protects the full risk, not just the accept-only half.

## Critical Implementation Details

**Migration-gate detection is a stdout-sentinel dependency, not an API contract.** The Supabase CLI exposes no `--json`/exit-code-based way to assert "zero pending migrations" (confirmed by reading `internal/migration/list/list.go` and `internal/db/push/push.go` directly). The gate in Phase 1 therefore greps `db push --dry-run`'s own `"is up to date"` string. Match on `"is up to date"` without the trailing period, to reduce (not eliminate) sensitivity to minor wording changes across future CLI releases — this is a real, accepted coupling to the CLI's current output, not a design flaw to engineer around.

## Phase 1: Migration-drift CI gate (Risk #5)

### Overview

Prove every migration pushed to production actually landed, independent of `db push`'s own exit code, before `wrangler deploy` runs.

### Changes Required:

#### 1. Post-push verification step

**File**: `.github/workflows/ci.yml`

**Intent**: Insert a new step in the `deploy` job, after "Push Supabase migrations" (`:55-62`) and before the `wrangler-action` deploy step (`:64-68`), that independently proves the push left zero pending migrations — closing the exact "CI ran a dry-run ≠ CI pushed the migration" gap Risk #5 names.

**Contract**: Capture `supabase db push --dry-run`'s stdout+stderr, echo it (for CI log visibility), and fail the step if the up-to-date sentinel is absent:

```yaml
- name: Verify migrations fully applied
  run: |
    output=$(supabase db push --dry-run 2>&1)
    echo "$output"
    if ! grep -q "is up to date" <<< "$output"; then
      echo "::error::Pending migrations remain after db push — aborting before deploy."
      exit 1
    fi
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
    SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
```

No re-`link` needed — the "Push Supabase migrations" step earlier in the same job already linked the project, and steps in the same job share the runner's filesystem.

### Success Criteria:

#### Automated Verification:

- GitHub Actions accepts the modified `ci.yml` (valid YAML, job parses) on push
- On the next real `master` push with fully-applied migrations, the `deploy` job's new step passes and `wrangler deploy` still runs

#### Manual Verification:

- Rehearse against a disposable/scratch Supabase project (not production): apply all current `supabase/migrations/` files, run the exact check command locally, confirm it reports the up-to-date sentinel and exits 0
- On the same scratch project, introduce deliberate drift (add an extra local migration file that was never pushed) and re-run the check command, confirming it fails (non-zero exit, no sentinel match) — this is the proof that the gate fails-closed, not just fails-never

---

## Phase 2: Extend e2e smoke to cover the reject path (Risk #2 negative space)

**Drive this phase via `/10x-e2e`** (per this repo's `CLAUDE.md`) — the feature is already built and the risk is browser-level; this section states intent for that skill's PLAN/GENERATE/REVIEW/VERIFY loop, not literal code.

### Overview

`tests/e2e/seed.spec.ts` currently only proves an accepted candidate is saved. Risk #2's full statement — "a rejected or un-actioned AI candidate is silently saved to the deck" — has an untested negative half: nothing today proves a rejected candidate is _absent_ from the saved deck.

### Changes Required:

#### 1. Extend the review-flow smoke assertion

**File**: `tests/e2e/seed.spec.ts`

**Intent**: Extend the existing test (not a new file/test — one browser session naturally exercises both outcomes) so the mocked generate response returns two distinct candidates; accept one, reject the other; save; assert the accepted candidate's question appears on `/cards` and the rejected candidate's question never does.

**Contract**: Same structure as today (mock via `page.route` on `**/api/flashcards/generate`, real save endpoint, real `/cards` SSR read) — two `Candidate` objects instead of one, an explicit reject interaction on the second card before "Save accepted", and an added `expect(page.getByText(<rejected question>)).not.toBeVisible()` assertion on `/cards` alongside the existing accepted-question assertion.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` passes locally with the extended assertion

#### Manual Verification:

- Deliberately break the client-side accept-filter in `GenerateView.tsx` (e.g., temporarily save the full candidate list instead of the accepted subset) and confirm the extended test fails — proving the assertion actually protects the risk, not merely passes by construction

---

## Phase 3: Wire the e2e suite into CI

### Overview

Run the full (now accept+reject) Playwright suite on every push/PR to `master`, inside the existing `ci` job so it inherits that job's required-status-check configuration.

### Changes Required:

#### 1. CI steps for Playwright

**File**: `.github/workflows/ci.yml`

**Intent**: After `npm test` (`:26`) and before `npm run build` (`:28`), install the chromium browser with OS dependencies (needed on a bare `ubuntu-latest` runner) and run the e2e suite, reusing the `supabase start` (`:25`) already running for Vitest.

**Contract**: Two new steps in the `ci` job:

```yaml
- run: npx playwright install --with-deps chromium
- run: npm run test:e2e
```

No new env vars: `playwright.config.ts`'s `globalSetup` already sources Supabase credentials via `tests/setup/env.ts`, the same helper Vitest uses, and the `webServer`'s `npm run dev` child process inherits them.

### Success Criteria:

#### Automated Verification:

- `npx playwright install --with-deps chromium` succeeds on a fresh `ubuntu-latest` runner
- `npm run test:e2e` passes in the `ci` job on push/PR to `master`

#### Manual Verification:

- Confirm `ci` is configured as a required status check in GitHub branch-protection settings for `master` — this is what makes the new e2e step (and every other step in `ci`) actually block a merge rather than merely report status; this is a manual GitHub UI action outside repo scope, so this plan can only remind, not verify, that it's done

---

## Testing Strategy

### Unit Tests:

- None added — both deliverables are CI-glue and browser-level, not unit-testable surfaces.

### Integration Tests:

- None added — Risk #5 and the reject-path half of Risk #2 are not reachable by the existing Vitest integration harness (one is CI-infrastructure, the other requires a real browser to prove client-side filtering).

### Manual Testing Steps:

1. Scratch-project rehearsal of the migration gate (Phase 1) — see that phase's Manual Verification.
2. Local `npm run test:e2e` run proving the extended accept+reject assertion (Phase 2).
3. Deliberate-break verification for the extended e2e test (Phase 2) and, optionally, a real PR run to observe both gates end-to-end in CI (Phase 3).

## Performance Considerations

Adding `playwright install --with-deps chromium` + one e2e spec to the `ci` job lengthens that job's wall-clock time by roughly the cost of a browser install plus one short browser session — acceptable given the job already runs a full local Supabase instance and Vitest suite in sequence.

## Migration Notes

Not applicable — no schema changes in this plan; it hardens the process that ships schema changes.

## References

- Prior research: `context/changes/testing-quality-gates-wiring/research.md`
- Playwright bootstrap: commit `694f9d2` — `playwright.config.ts`, `tests/e2e/{auth.setup.ts,global-teardown.ts,paths.ts,seed.spec.ts,wait-for-hydration.ts}`
- CI workflow: `.github/workflows/ci.yml`
- Supabase CLI source (grounding for the gate mechanism): `internal/migration/list/list.go`, `internal/db/push/push.go` (github.com/supabase/cli)
- Foundation test plan: `context/foundation/test-plan.md` §2 Risk #5, §5 Quality Gates, §6.3

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration-drift CI gate (Risk #5)

#### Automated

- [x] 1.1 GitHub Actions accepts the modified `ci.yml` (valid YAML, job parses) on push — 3a3c6dd
- [ ] 1.2 On the next real `master` push with fully-applied migrations, the `deploy` job's new step passes and `wrangler deploy` still runs

#### Manual

- [ ] 1.3 Scratch-project rehearsal: check passes when migrations are fully applied
- [ ] 1.4 Scratch-project rehearsal: check fails when drift is deliberately introduced

### Phase 2: Extend e2e smoke to cover the reject path (Risk #2 negative space)

#### Automated

- [x] 2.1 `npm run test:e2e` passes locally with the extended accept+reject assertion

#### Manual

- [x] 2.2 Deliberately breaking the accept-filter makes the extended test fail

### Phase 3: Wire the e2e suite into CI

#### Automated

- [ ] 3.1 `npx playwright install --with-deps chromium` succeeds on a fresh `ubuntu-latest` runner
- [ ] 3.2 `npm run test:e2e` passes in the `ci` job on push/PR to `master`

#### Manual

- [ ] 3.3 Confirm `ci` is a required status check in GitHub branch-protection settings for `master`
