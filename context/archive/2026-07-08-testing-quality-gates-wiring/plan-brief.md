# Quality-Gates Wiring (Rollout Phase 4) — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`
> Research: `context/changes/testing-quality-gates-wiring/research.md`

## What & Why

Close rollout Phase 4's two remaining gaps: a CI gate that proves a schema migration is actually live in production before deploy proceeds (Risk #5 — "CI ran a dry-run" ≠ "CI pushed the migration"), and full CI enforcement of the AI-review e2e smoke — including closing a real coverage gap in the smoke test itself.

## Starting Point

A prior session (commit `694f9d2`) already bootstrapped Playwright: config, storageState auth pattern, and one passing test (`tests/e2e/seed.spec.ts`) proving an accepted AI candidate gets saved. That commit explicitly scoped out CI wiring and the migration-drift gate — this plan picks those up. `.github/workflows/ci.yml`'s `deploy` job already pushes migrations for real but never verifies the push actually succeeded before running `wrangler deploy`.

## Desired End State

The `deploy` job hard-fails before `wrangler deploy` runs if any migration is still pending after the real push. The `ci` job runs the full Playwright suite — now covering both "accepted candidates are saved" and "rejected candidates are never saved" — on every push/PR to `master`.

## Key Decisions Made

| Decision                 | Choice                                                                   | Why (1 sentence)                                                                                                                    | Source                |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Migration-gate mechanism | Grep `db push --dry-run`'s `"is up to date"` sentinel                    | Supabase CLI has no scriptable exit-code/JSON way to detect drift — confirmed by reading the CLI's Go source directly               | Research (agent)      |
| E2E coverage scope       | Extend `seed.spec.ts` to also assert rejected candidates are never saved | Closes the actual negative-space Risk #2 names, not just the happy path                                                             | Plan (user-confirmed) |
| E2E CI placement         | Inside the existing `ci` job, after `npm test`                           | Reuses the already-running local Supabase + inherits `ci`'s required-check config for free — no new branch-protection wiring needed | Plan (user-confirmed) |
| Gate-proof method        | One-time manual rehearsal against a scratch Supabase project             | Empirically proves fail-closed behavior without permanent CI infrastructure for a single grep check                                 | Plan (user-confirmed) |
| Branch protection        | Manual checklist reminder only                                           | Can't be verified/configured from the repo; the plan can only flag it                                                               | Plan (user-confirmed) |

## Scope

**In scope:**

- A post-push verification step in `deploy` (migration-drift gate)
- Extending the existing e2e smoke to cover the reject path
- Wiring the (now-complete) e2e suite into the `ci` job

**Out of scope:**

- A broader e2e suite beyond the single AI-review-flow smoke
- A permanent automated regression test for the migration-gate script itself
- Changing the e2e app-serving strategy (`astro dev` stays)
- Configuring GitHub branch-protection via API/code

## Architecture / Approach

Three independently shippable phases: pure CI-YAML (migration gate) → test-writing on an already-built feature, routed through `/10x-e2e` per this repo's `CLAUDE.md` (coverage extension) → CI-YAML again (wiring). Coverage extension is sequenced before CI wiring so the very first CI run already protects the full risk.

## Phases at a Glance

| Phase                              | What it delivers                                                               | Key risk                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1. Migration-drift CI gate         | `deploy` job fails before `wrangler deploy` if migrations aren't fully applied | Detection depends on a CLI stdout sentinel string, not a stable API — a future CLI wording change could silently break it |
| 2. Extend e2e reject-path coverage | `seed.spec.ts` proves rejected candidates never reach `/cards`                 | Driven via `/10x-e2e`, not hand-written here — needs a live loop against the running app                                  |
| 3. Wire e2e into CI                | `ci` job runs the full Playwright suite on every push/PR                       | Browser install + e2e run adds wall-clock time to the `ci` job                                                            |

**Prerequisites:** A disposable/scratch Supabase project for Phase 1's manual rehearsal (not production).
**Estimated effort:** ~1 session across 3 phases — mostly wiring, not new architecture.

## Open Risks & Assumptions

- Assumes `ci` is (or will be configured as) a required branch-protection status check for `master` — unverifiable from the repo; flagged as a manual step in Phase 3.
- The migration-gate's sentinel-string match is a real, accepted coupling to the Supabase CLI's current output wording (see plan's Critical Implementation Details).

## Success Criteria (Summary)

- A deliberately desynced scratch Supabase project makes the Phase 1 gate fail; a fully-applied one makes it pass.
- Deliberately breaking `GenerateView.tsx`'s accept-filter makes the extended e2e test fail.
- A normal push to `master` runs both gates green end-to-end, with `ci` required for merge.
