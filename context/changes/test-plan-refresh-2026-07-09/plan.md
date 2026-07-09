# Lifecycle & Route-Protection Hardening (Phase 5) Implementation Plan

## Overview

Rollout Phase 5 closes three gaps surfaced by the 2026-07-09 test-plan refresh: route-protection drift (Risk #8), the account reactivation/purge race (Risk #9), and SRS repeat-review scheduling (Risk #10). Unlike Phases 1–4, two of the three risks require a small production-code fix, not just new tests — the underlying behavior these risks worry about is not fully guaranteed by the code as it stands today.

## Current State Analysis

- **Risk #8**: `src/middleware.ts:18` gates six `.astro` pages via `PROTECTED_ROUTES.some((route) => pathname.startsWith(route))` — a raw substring-prefix match with no segment boundary. All six current entries correctly map to real pages (6 commits, one per feature, always in lockstep). The matcher would incorrectly treat a future near-miss route (e.g. `/studying`) as protected because it starts with `/study`.
- **Risk #9**: `src/pages/api/cron/purge.ts:51-56` selects eligible `account_deletions` rows into an in-memory array, then loops `admin.auth.admin.deleteUser` serially (`purge.ts:67-73`) with no re-check. `src/pages/api/account/reactivate.ts:32` cancels by deleting the same row. A cancellation landing after purge's SELECT snapshot but before that row's turn in the loop is still erased — the two operations are never in the same transaction and can't be, since `deleteUser` is an Admin API call, not a table statement.
- **Risk #10**: `src/lib/flashcards/srs.ts:73-86`'s `applyGrade` is pure and its fetch/merge path in `src/pages/api/flashcards/[id]/review.ts:52-69` is sound as written — no bug found in the current logic. But zero test grades the same card twice, and Phase 1's mutation testing already proved the exact fragility: a mutant truncating `review.ts:20`'s `SRS_COLUMNS` literal to `""` survived undetected (`context/foundation/test-plan.md:278-284`).

## Desired End State

- `middleware.ts`'s matcher is segment-boundary-aware; an independently-authored, filesystem-cross-checked test proves every real page's protection status and rejects fabricated near-miss paths.
- `purge.ts` atomically claims eligible rows (delete-and-return) instead of selecting then looping; both cancellation-before-purge and purge-before-cancellation are proven deterministic via real sequential calls, and a hermetic test guards the causal mechanism against regression.
- `srs.ts`'s repeat-review scheduling is proven correct at the unit level, and the exact `SRS_COLUMNS` regression class is caught by a thin integration test through the real endpoint.

### Key Discoveries:

- `context.url.pathname` (used by `middleware.ts:18`) is a separate property from `context.request.url` — the existing `buildContext` test helper (`tests/helpers/api-context.ts`) only builds `request`, so middleware tests need a `url` field added.
- The atomic claim-and-consume fix for Risk #9 costs **zero extra Supabase subrequests**: today's `1 select + BATCH deleteUser` becomes `1 delete-with-return + BATCH deleteUser` — same shape, same count.
- `review.ts:77` only returns `{ due }` in its response body — a black-box integration assertion for Risk #10 needs a direct admin-client read of `reps` (or similar) to prove repeat-review state accumulated, following the existing `adminClient()`-for-verification pattern already used in `tests/integration/risk4-purge-boundary.test.ts:15-17`.

## What We're NOT Doing

- Not auditing or testing `/api/**` route auth as part of Risk #8 — that's a structurally separate, already-self-guarded mechanism; out of scope for this phase (candidate for a future risk-map row).
- Not changing `account_deletions`' schema (no status column, no optimistic-concurrency version field) — the atomic-claim fix works within the existing two-column table.
- Not adding a mid-batch "concurrent request during processing" integration test for Risk #9 beyond the hermetic regression guard — real HTTP interleaving mid-synchronous-loop isn't practically constructible without mocking, and the hermetic test already covers that exact causal path.
- Not touching `reactivate.ts` — its plain RLS-scoped delete is already correct; the race was purge's staleness, not reactivate's logic.

## Implementation Approach

Three independent phases, one per risk, each its own commit, in test-plan.md §2's stated priority order (Protect High×High first). Risk #8 and #9 each pair a small, surgical production fix with the tests that prove it; Risk #10 is pure test-addition since no bug was found in the current code.

## Critical Implementation Details

**PostgREST delete+order+limit chaining (Risk #9).** The atomic-claim fix assumes `supabase-js`'s `.delete().lt(...).order(...).limit(BATCH).select("user_id")` chain is honored by the pinned `@supabase/supabase-js@^2.99.1` / project's PostgREST version — order and limit on a DELETE aren't universally guaranteed across PostgREST versions. Verify this empirically against the local Supabase instance before relying on it (a quick manual `supabase start` + REPL check, or the first test run will fail loudly if unsupported). If unsupported, fall back to a small Postgres function (new migration) that performs the same bounded claim via a CTE (`DELETE FROM account_deletions WHERE user_id IN (SELECT user_id FROM account_deletions WHERE requested_at < cutoff ORDER BY requested_at LIMIT batch) RETURNING user_id`), invoked via `admin.rpc(...)` — still exactly 1 subrequest, same shape.

**Purge's `skipped` metric needs a separate count query (Risk #9).** Today's `count: "exact"` on the SELECT gives the total backlog size independent of `BATCH`, used to compute `skipped`. Once the eligibility query becomes a limited DELETE, that total-backlog count is no longer available from the same call. Keep a lightweight advisory-only `count: "exact", head: true` SELECT (no rows fetched) purely for the `skipped` log metric — it's never used for eligibility decisions, so it doesn't reintroduce the race. This adds exactly one subrequest (36 → 37), still well under the documented 50-subrequest cap.

## Phase 1: Route-protection oracle (Risk #8)

### Overview

Harden `middleware.ts`'s matcher to a segment-boundary match, then add an integration test whose expected-protection list is independently authored and cross-checked against a live filesystem enumeration of `src/pages/**` — so a new protected page added without a matching array entry (or vice versa) fails the test, not just today's known six.

### Changes Required:

#### 1. Segment-aware route matcher

**File**: `src/middleware.ts`

**Intent**: Close the prefix-collision gap research found — `/studying` currently matches `/study` by raw substring, which would silently and incorrectly gate a future unrelated route.

**Contract**: Change the matcher predicate at `middleware.ts:18` from `pathname.startsWith(route)` to a segment-boundary check: `pathname === route || pathname.startsWith(\`${route}/\`)`. `PROTECTED_ROUTES` itself is unchanged.

#### 2. Middleware-testable context helper

**File**: `tests/helpers/api-context.ts`

**Intent**: `buildContext` currently builds `request`/`cookies`/`params`/`locals`/`redirect` for API route handlers. Middleware reads `context.url.pathname`, a separate Astro-specific property `buildContext` doesn't populate.

**Contract**: Add a `url: new URL(url)` field to the object `buildContext` returns, derived from the same `url` parameter already used to build `request`. No new parameters; existing callers are unaffected since they never read `context.url`.

#### 3. Independent route-protection oracle test

**File**: `tests/integration/risk8-protected-routes-oracle.test.ts`

**Intent**: Prove every real page that should require a session actually gets redirected when unauthenticated, every page that shouldn't stays reachable, and fabricated near-miss paths aren't swept in by the matcher — verified against a hand-authored expected list independently derived (not copied) from `PROTECTED_ROUTES`, cross-checked against an actual filesystem walk so a forgotten route addition fails the test.

**Contract**: At module scope, use `node:fs`'s `readdirSync` (recursive) over `src/pages/` to enumerate every `.astro` file, excluding `src/pages/api/**`, and derive each one's route path (flat routing in this repo — no dynamic page segments to resolve). Hand-author two Sets: `EXPECTED_PROTECTED` (the 6 known protected page paths) and everything else discovered is implicitly expected-public — assert the enumerated file list matches exactly (no untracked page, protected or public). Then, for each real page path plus a hand-picked adversarial near-miss per protected prefix (`/dashboards`, `/generated`, `/created`, `/cardsxyz`, `/studying`, `/accountant` — none are real files), invoke the real exported `onRequest` from `src/middleware.ts` directly via `buildContext` (extended per item 2) with a stub `next` returning a 200 sentinel: once unauthenticated (no cookie) expecting a redirect to `/auth/signin` only for `EXPECTED_PROTECTED` paths and the sentinel for everything else (public + adversarial), and once authenticated (via `seedUser()` + `getAuthCookieHeader()` from `tests/helpers/auth.ts`) expecting the sentinel for every path including the six protected ones.

### Success Criteria:

#### Automated Verification:

- Type check + lint pass: `npx astro sync && npm run lint`
- Unit + integration tests pass: `npm test`
- Build passes: `npm run build`

#### Manual Verification:

- Manually visiting `/dashboard` while signed out redirects to `/auth/signin`; visiting while signed in loads normally
- Manually visiting a fabricated near-miss path (e.g. `/studying`, which has no real page) while signed out does not redirect — it 404s normally instead of bouncing to sign-in

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Reactivation/purge race fix (Risk #9)

### Overview

Replace `purge.ts`'s stale select-then-loop with an atomic claim-and-consume query, then prove both real orderings are safe (cancel-before-purge, purge-before-cancel) plus guard the fix's causal mechanism with a hermetic regression test.

### Changes Required:

#### 1. Atomic claim in the purge route

**File**: `src/pages/api/cron/purge.ts`

**Intent**: Eliminate the TOCTOU window between "select eligible rows" and "erase them" by making eligibility-check and claim a single atomic operation, so a concurrent cancellation that lands before a specific row's claim always wins for that row.

**Contract**: Replace the `.select("user_id", { count: "exact" }).lt(...).order(...).limit(BATCH)` call (`purge.ts:51-56`) with two calls: (a) an advisory-only `count: "exact", head: true` select on the same `.lt(cutoff)` filter, used solely for the `skipped` metric (see Critical Implementation Details); (b) the actual claim — `.delete().lt("requested_at", cutoff).order("requested_at", { ascending: true }).limit(BATCH).select("user_id")` — whose returned rows are exactly and only the ones this invocation is now committed to purging. The subsequent `deleteUser` loop (`purge.ts:67-73`) is unchanged, iterating over the claim's returned rows instead of the old select's `data`. `eligible`/`skipped` logging (`purge.ts:64,74`) is recomputed from the advisory count and the claim's row count, per Critical Implementation Details.

#### 2. Regression-guard hermetic unit test

**File**: `tests/unit/risk9-purge-claim-hermetic.test.ts`

**Intent**: Prove the fix's causal mechanism directly — `deleteUser` must only ever be called for rows the atomic claim actually returned, never for a stale pre-claim count — so a future refactor back toward select-then-loop would fail this test immediately.

**Contract**: Mirror `tests/unit/risk4-purge-partial-failure-hermetic.test.ts`'s mocked-admin-client pattern: mock `createAdminClient` so the advisory count reports more eligible rows than the claim's delete-and-return actually returns (simulating a row that was eligible moments ago but is no longer present when claimed — i.e. a concurrent cancellation already removed it). Assert `deleteUser` is called exactly once per row the mocked delete returned, and never for the "missing" row.

#### 3. Real two-ordering integration test

**File**: `tests/integration/risk9-reactivation-purge-race.test.ts`

**Intent**: Prove both real, sequential orderings behave correctly against a real local Supabase instance — cancellation-before-purge always survives, and purge-before-cancellation is a deterministic, documented no-op for the late reactivation, not data loss in either direction.

**Contract**: Reuse `seedUser`/`cleanupUser`/`adminClient` (`tests/helpers/auth.ts`), `seedAccountDeletion` (`tests/helpers/account-deletion.ts`), and `buildContext` (`tests/helpers/api-context.ts`), following `risk4-purge-boundary.test.ts`'s `userExists` helper pattern. Two cases: (a) seed an eligible (>30d) row for a real user, call the real `reactivate.ts` `POST` handler (authenticated via `getAuthCookieHeader`) to cancel, then call the real `purge.ts` `POST` handler — assert the user still exists and purge's `deleted` count excludes them; (b) seed an eligible row, call `purge.ts` first (erasing the user), then call `reactivate.ts` — assert `reactivate` returns `401 { error: "unauthorized" }` and the user is genuinely already gone. **Correction from plan (verified empirically):** purge deleting the auth user invalidates the session before `reactivate.ts`'s own delete-and-check-0-rows logic is ever reached — `supabase.auth.getUser()` itself fails against GoTrue once the user record is gone, so the route 401s at the auth gate rather than returning the originally-assumed `200 { ok: true }`. Still a deterministic, documented no-op: there's no window where a late cancellation could act on an already-purged account.

### Success Criteria:

#### Automated Verification:

- Type check + lint pass: `npx astro sync && npm run lint`
- Unit + integration tests pass: `npm test`
- Build passes: `npm run build`
- Existing `tests/integration/risk4-purge-boundary.test.ts` and `tests/unit/risk4-purge-partial-failure-hermetic.test.ts` still pass unmodified against the new claim query (no regression in retention-boundary or partial-failure behavior)

#### Manual Verification:

- Manually trigger `POST /api/cron/purge` against local Supabase with a mix of eligible/non-eligible seeded rows and confirm the `deleted`/`skipped` counts in the response and logs match expectations
- Confirm the local Supabase logs show the `.delete()...select()` claim query executing without a PostgREST chaining error (validates the Critical Implementation Details fallback isn't needed)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: SRS repeat-review scheduling (Risk #10)

### Overview

Prove a twice-graded card's second scheduling reflects the first review's outcome, both at the pure-function level and through the real endpoint — specifically re-killing the `SRS_COLUMNS`-truncation mutant that seeded this risk.

### Changes Required:

#### 1. Unit test on repeat-grade scheduling

**File**: `tests/unit/risk10-srs-repeat-review.test.ts`

**Intent**: Prove `applyGrade` genuinely uses prior state on a second call, not first-time defaults — the core of Risk #10's failure scenario.

**Contract**: Import `applyGrade` directly from `@/lib/flashcards/srs`. Grade a fresh `SrsColumns` row (all fields `null`) once with a fixed `now`, capturing the resulting state. Feed that resulting state into `applyGrade` again with a later `now` and a rating. Assert the second call's `reps` is `2` (ts-fsrs increments `reps` per graded review; a fresh card graded once always yields `reps: 1`, so `reps: 2` is only reachable by correctly carrying forward prior state) — the strongest, most direct discriminator between "repeat review" and "treated as first-time."

#### 2. Thin integration test through the real endpoint

**File**: `tests/integration/risk10-review-repeat-scheduling.test.ts`

**Intent**: Catch a regression in `review.ts`'s `SRS_COLUMNS` select-list specifically — the exact class of bug Phase 1's mutation testing found once already, which no existing test currently guards against.

**Contract**: Reuse `seedUser`/`cleanupUser`, `getAuthCookieHeader`, `buildContext`, and a seeded flashcard (mirroring `risk1-api-route-ownership.test.ts`'s review-PATCH setup). Call the real `PATCH /api/flashcards/[id]/review` handler twice in sequence for the same card (real Supabase, real session). After both calls, use `adminClient()` to directly select the card's `reps` column and assert it equals `2` — proving the endpoint's actual DB round-trip (not just the pure function) correctly reloads and persists prior state across two real reviews.

### Success Criteria:

#### Automated Verification:

- Type check + lint pass: `npx astro sync && npm run lint`
- Unit + integration tests pass: `npm test`
- Build passes: `npm run build`

#### Manual Verification:

- Manually study the same card twice in the running app's `/study` flow and confirm the second review's shown next-interval hint differs from the first review's

**Implementation Note**: After completing this phase and all automated verification passes, this is the final phase of the rollout — no further phase follows.

---

## Testing Strategy

### Unit Tests:

- `applyGrade` correctly carries forward prior SRS state on a repeat grade (Risk #10)
- Purge's `deleteUser` loop only ever acts on rows the atomic claim actually returned (Risk #9)

### Integration Tests:

- Every real page's protection status matches an independently-authored, filesystem-cross-checked expectation; fabricated near-miss paths are correctly excluded (Risk #8)
- Cancellation-before-purge always survives; purge-before-cancellation is a deterministic, documented no-op (Risk #9)
- Two real sequential reviews of the same card produce correctly-incrementing SRS state through the actual endpoint (Risk #10)

### Manual Testing Steps:

1. Sign out, visit `/dashboard` → redirected to `/auth/signin`; visit `/studying` (no real page) → 404, not redirected
2. Request account deletion, immediately cancel, then manually trigger the purge route → account and flashcards untouched
3. Study the same card twice in `/study` → second review's interval hint reflects the first review's grade

## Performance Considerations

The atomic-claim fix for Risk #9 adds exactly one advisory-only subrequest to the purge route (36 → 37), still well under the documented 50-subrequest Workers cap; no `BATCH` size change needed.

## Migration Notes

No schema migration is required for the primary fix. If the PostgREST delete+order+limit chain (Critical Implementation Details) proves unsupported by the pinned library version, the fallback requires one new migration adding a Postgres claim function — write that migration only if the chain check fails.

## References

- Research: `context/changes/test-plan-refresh-2026-07-09/research.md`
- Existing purge test precedent: `tests/integration/risk4-purge-boundary.test.ts`, `tests/unit/risk4-purge-partial-failure-hermetic.test.ts`
- Existing route-ownership review-PATCH precedent: `tests/integration/risk1-api-route-ownership.test.ts:99-126`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route-protection oracle (Risk #8)

#### Automated

- [x] 1.1 Type check + lint pass — 5606727
- [x] 1.2 Unit + integration tests pass — 5606727
- [x] 1.3 Build passes — 5606727
- [x] 1.4 Existing risk4 purge tests unaffected — 5606727

#### Manual

- [x] 1.5 Signed-out `/dashboard` redirects to sign-in; signed-in loads normally — 5606727
- [x] 1.6 Signed-out `/studying` (fabricated path) 404s, does not redirect — 5606727

### Phase 2: Reactivation/purge race fix (Risk #9)

#### Automated

- [x] 2.1 Type check + lint pass — babd4b2
- [x] 2.2 Unit + integration tests pass — babd4b2
- [x] 2.3 Build passes — babd4b2
- [x] 2.4 Existing risk4 purge tests still pass, behaviorally unmodified — `risk4-purge-partial-failure-hermetic.test.ts`'s mock needed a mechanical update to the new two-call query shape (count + claim), anticipated by Critical Implementation Details; its assertions/intent are unchanged. `risk4-purge-boundary.test.ts` needed no changes. — babd4b2

#### Manual

- [x] 2.5 Manual purge trigger with mixed eligible/non-eligible rows matches expected counts — babd4b2
- [x] 2.6 Local Supabase logs confirm the claim query executes without a chaining error — babd4b2

### Phase 3: SRS repeat-review scheduling (Risk #10)

#### Automated

- [x] 3.1 Type check + lint pass — 0e087ba
- [x] 3.2 Unit + integration tests pass — 0e087ba
- [x] 3.3 Build passes — 0e087ba

#### Manual

- [x] 3.4 Studying the same card twice in `/study` shows a differing second interval hint — 0e087ba
