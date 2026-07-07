# Compliance-Critical Flows (Rollout Phase 3) Implementation Plan

## Overview

Close the two remaining High-impact risks in `context/foundation/test-plan.md`'s rollout: **Risk #4** (the account-deletion purge fires before the 30-day retention window, or never fires) and **Risk #6** (an AI-generation error response leaks the user's raw source text or provider internals). Both are currently untested — this plan adds integration coverage for the retention/purge boundary and the generation endpoint's error-response hygiene, plus the minimal test infrastructure both need.

## Current State Analysis

- **Risk #4**: `account_deletions` (one row per pending-deletion user, `requested_at` timestamp) drives everything. `is_pending_deletion()` gates `flashcards` RLS immediately on insert — this is the real protection, not sign-in. Sign-in itself succeeds for a pending account and redirects to `/account` (`src/pages/api/auth/signin.ts:19-32`). A daily GitHub Actions cron calls a bearer-secret-gated route (`src/pages/api/cron/purge.ts`) that erases eligible rows via `admin.auth.admin.deleteUser`, relying on `ON DELETE CASCADE` to clean up `flashcards`/`account_deletions`. None of this is tested; `tests/integration/risk1-rls-isolation.test.ts` explicitly excludes it.
- **Risk #6**: `src/pages/api/flashcards/generate.ts` has 9 response points, all going through `fail()`/`json()` helpers that only ever emit `{error: <ApiErrorCode>}` or `{candidates}` — no branch reads `err.message`, spreads a caught object, or forwards a request/response body. `src/lib/flashcards/generation.ts`'s `GenerationError` never carries the provider's raw body. The two acknowledged coverage gaps (from Phase 2's mutation-testing pass) are `rate_limited` (429) and the generic `ai_unavailable` catch-all (502) — everything else has some indirect coverage already.
- Full grounding: `context/changes/testing-compliance-critical-flows/research.md`.

## Desired End State

Two new risk-scoped integration test files (plus one narrowly-scoped hermetic unit test) exist and pass locally against `supabase start`, exercising: the day-29/30/31 retention boundary, RLS-enforced data lock-out for a pending account, the purge route's own auth gate, partial-batch-failure reporting, and the generation endpoint's `rate_limited`/network-failure branches plus a cross-branch allowed-fields schema check. `test-plan.md` §6.5 and a new §6.6-adjacent MSW cookbook entry are filled in.

**Verification**: `npm test` passes with the new files included; `npm run lint` is clean; each new test file also runs green in isolation (`npm test -- <file>`).

### Key Discoveries

- `account_deletions.user_id` has `ON DELETE CASCADE` to `auth.users` (`supabase/migrations/20260702145938_create_account_deletions.sql:17-20`) — deleting the auth user out-of-band also deletes the `account_deletions` row, so there is **no way to seed a real "row present, deleteUser will fail" state**. The partial-batch-failure case must be a hermetic unit test with a mocked admin client (mirrors the existing precedent in `tests/unit/risk1-risk2-save-endpoint-hermetic.test.ts` for branches real Supabase can't produce on demand).
- The generation endpoint's timeout path (`AbortSignal.timeout(20000)` in `generation.ts:84`) and any other network failure both fall into the same bare `catch { throw new GenerationError("OpenRouter request failed"); }` (`generation.ts:86`) — there is no distinguishing information, so **one** simulated-network-failure test covers both the "generic failure" and "timeout collapses safely" claims; no separate timeout test is needed.
- `CRON_PURGE_SECRET` and `OPENROUTER_API_KEY` are read from the `astro:env/server` stub (`vitest.config.ts:27-31`), which mirrors `process.env` — but `tests/setup/env.ts`'s `globalSetup` only populates `SUPABASE_*` vars from `supabase status -o env`. Both need a fixed test value added there.
- MSW is named in `test-plan.md` §4 but not yet installed (`package.json` has no `msw` dependency) — this phase introduces it, scoped to one file to avoid intercepting other integration tests' real Supabase calls.

## What We're NOT Doing

- Not testing account reactivation (`src/pages/api/account/reactivate.ts`) — not part of Risk #4's failure scenario.
- Not testing the missing-`OPENROUTER_API_KEY` 503 branch in the cross-branch schema check — it's a module-load-time env binding (would need `vi.resetModules()` gymnastics) and is already the lowest-risk branch (a hardcoded literal, zero interpolation).
- Not adding retry/fallback-model logic to the generation endpoint — out of scope, this is a test-only rollout phase.
- Not wiring `test-plan.md` §5's migration-drift gate or e2e smoke — that's rollout Phase 4.

## Implementation Approach

Three phases: shared test infrastructure first (both risks depend on it), then Risk #4, then Risk #6 (which also closes out the rollout phase's cookbook documentation). Each risk gets integration tests using the established route-wiring/RLS-layer split from Phases 1-2, reusing `tests/helpers/auth.ts` throughout.

## Critical Implementation Details

- **Boundary-seeding timing.** Seed the "not yet eligible" row at `29 days + 23 hours` ago (not exactly 29 days) and the "eligible" row at `30 days + 5 minutes` ago (not exactly 30 days). The purge route computes its own cutoff at call time (`Date.now() - 30d`), a few milliseconds after the test seeds its row — an exact-30-day seed would race against that gap and could flip eligibility non-deterministically. The wider margins remove the race while still proving the boundary.
- **MSW blast radius.** `tests/setup/msw.ts`'s `setupServer()` must be started/stopped from _within_ `risk6-generation-error-hygiene.test.ts`'s own `beforeAll`/`afterEach`/`afterAll` (not wired into `vitest.config.ts`'s global `setupFiles`), and `server.listen()` must pass `{ onUnhandledRequest: "bypass" }`. That file's own tests still make real Supabase auth calls (to sign in the test user) — global registration or a stricter unhandled-request mode would intercept or break those, and every other integration test file, since they'd all share the same worker-level interceptor.
- **`account_deletions` insert bypasses RLS deliberately.** `seedAccountDeletion` uses the service-role admin client (already used internally by `seedUser`/`cleanupUser` in `tests/helpers/auth.ts`) specifically to set an arbitrary `requested_at` — a normal signed-in user's insert would always get `now()` via the column default, which can't produce an aged row. This mirrors the existing "admin client is the ONLY module that bypasses RLS, used narrowly for setup" pattern already established in that file.

## Phase 1: Test infrastructure

### Overview

Add the shared pieces both risk phases need: a fixed test value for the two secrets the `astro:env/server` stub exposes, a generic-headers option on `buildContext` (the purge route needs an `Authorization` header, not a cookie), an age-seeding helper for `account_deletions`, and an MSW server factory for mocking the OpenRouter edge.

### Changes Required:

#### 1. Fixed test secrets

**File**: `tests/setup/env.ts`

**Intent**: Give the purge route's bearer check and the generation endpoint's `!OPENROUTER_API_KEY` guard a deterministic, test-only value so route-wiring tests can exercise them without real production secrets.

**Contract**: After the existing `REQUIRED` loop in `setup()`, unconditionally set `process.env.CRON_PURGE_SECRET = "test-purge-secret"` and `process.env.OPENROUTER_API_KEY = "test-openrouter-key"`. Fixed literals, not sourced from `.dev.vars` — test correctness must not depend on the developer's real secret.

#### 2. Generic headers on `buildContext`

**File**: `tests/helpers/api-context.ts`

**Intent**: The purge route reads `context.request.headers.get("authorization")` directly; `buildContext` currently only sets `Cookie`/`Content-Type`.

**Contract**: Add an optional `headers?: Record<string, string>` field to `BuildContextOptions`, applied via `headers.set(k, v)` alongside the existing `Cookie` handling (additive, backward-compatible — no existing call site passes `headers`, so no other test changes).

#### 3. Account-deletion age-seeding helper

**File**: `tests/helpers/account-deletion.ts` (new)

**Intent**: Seed an `account_deletions` row at a controlled age, for the day-29/30/31 boundary tests.

**Contract**: Export `seedAccountDeletion(userId: string, ageDays: number, ageMinutesOffset?: number): Promise<void>`, computing `requested_at = new Date(Date.now() - (ageDays * 24 * 60 + (ageMinutesOffset ?? 0)) * 60_000).toISOString()` and inserting `{ user_id: userId, requested_at }` into `account_deletions` via the service-role admin client. Requires exporting the currently-private `adminClient()` from `tests/helpers/auth.ts` (add the `export` keyword — no other change to that function).

#### 4. MSW server factory

**File**: `tests/setup/msw.ts` (new)

**Intent**: A reusable, not-globally-registered MSW Node server for mocking the OpenRouter HTTP edge.

**Contract**: `import { setupServer } from "msw/node"`, export `export const server = setupServer();` (no default handlers — each test registers its own via `server.use(...)` and resets via `server.resetHandlers()`). Do not add this file to `vitest.config.ts`'s `setupFiles` — its lifecycle is driven locally by the one test file that needs it (see Critical Implementation Details).

#### 5. Add MSW dependency

**Intent**: Install `msw` as a devDependency (`npm install -D msw`), matching the tool `test-plan.md` §4 already committed to.

**Contract**: `package.json`'s `devDependencies` gains `msw`; no other dependency changes.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm test -- tests/integration/harness-smoke.test.ts` still passes (confirms the env/setup changes didn't break the existing harness)

#### Manual Verification:

- `npm ls msw` shows the package installed at the expected version

---

## Phase 2: Risk #4 — account-deletion retention boundary

### Overview

Prove the pending-deletion → RLS-lockout guarantee fires immediately (not gated on age), and prove the purge route's day-29/30/31 boundary, its own auth gate, and its partial-batch-failure reporting.

### Changes Required:

#### 1. RLS-layer test — pending deletion locks data immediately

**File**: `tests/integration/risk4-pending-deletion-rls.test.ts` (new)

**Intent**: Prove that once an account is pending deletion (regardless of age), its own signed-in session can no longer see or mutate its flashcards, and that signing in still succeeds but redirects to `/account` — matching the corrected `test-plan.md` §2 Risk #4 guidance (RLS-enforced lockout, not a sign-in block).

**Contract**: Seed a user + one flashcard via the existing `seedUser`/`signInDirect` pattern (mirrors `risk1-rls-isolation.test.ts`). Call `seedAccountDeletion(userId, 0)` (today — deliberately not aged, to prove the lock is immediate). Assert: (a) the user's own signed-in client now selects zero flashcards and an update/delete of its own card affects zero rows (same `is_pending_deletion()`-gated pattern as Risk #1's cross-user assertions, but same-user this time); (b) `POST /api/auth/signin` (via `buildContext` + real credentials) returns a redirect response whose `Location` header is `/account`, not a 401/403.

#### 2. Route-wiring test — purge boundary, auth gate

**File**: `tests/integration/risk4-purge-boundary.test.ts` (new)

**Intent**: Prove the purge route only erases accounts at/after the 30-day boundary, rejects unauthenticated calls, and reports failures rather than masking them.

**Contract**: Import `POST` from `@/pages/api/cron/purge`. Three cases using `seedUser()` + `seedAccountDeletion()`:

1. Row seeded at `29 days + 23 hours` old → call `POST` with `Authorization: Bearer test-purge-secret` (via `buildContext`'s new `headers` option) → assert the user still exists afterward (`adminClient().auth.admin.getUserById(id)` returns no error) and the response's `deleted` count excludes it.
2. Row seeded at `30 days + 5 minutes` old → call `POST` with the correct secret → assert the response includes it in `deleted`, and `getUserById(id)` now errors (user gone).
3. Missing/incorrect `Authorization` header → assert `401 {error:"unauthorized"}` and that a still-eligible seeded row (case 2's setup, called again with a fresh seed) is untouched.

#### 3. Hermetic unit test — partial-batch-failure reporting

**File**: `tests/unit/risk4-purge-partial-failure-hermetic.test.ts` (new)

**Intent**: Prove a per-row `deleteUser` failure is counted and surfaced as a non-2xx response, not masked — the one state real Supabase can't produce on demand (see Critical Implementation Details).

**Contract**: `vi.mock("@/lib/supabase-admin")` to return a stub client whose `.from("account_deletions").select(...)` resolves with two fabricated eligible rows and whose `.auth.admin.deleteUser` rejects for one row's id and resolves for the other. Import the real `POST` from `@/pages/api/cron/purge` (only the admin-client factory is mocked, matching the `risk1-risk2-save-endpoint-hermetic.test.ts` precedent). Assert the response status is `500` and the body's `deleted`/`errors` counts match the mocked outcome (1 and 1).

### Success Criteria:

#### Automated Verification:

- `npm test -- tests/integration/risk4-pending-deletion-rls.test.ts` passes
- `npm test -- tests/integration/risk4-purge-boundary.test.ts` passes
- `npm test -- tests/unit/risk4-purge-partial-failure-hermetic.test.ts` passes
- `npm run lint` passes

#### Manual Verification:

- Running the three new files against a freshly-started `supabase start` (no stale seeded rows) produces the same pass result — confirms no ordering dependency on leftover state from other test files

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Risk #6 — AI-generation error-response data hygiene

### Overview

Close the two acknowledged coverage gaps (`rate_limited`, generic `ai_unavailable` catch-all) and lock in the allowed-fields-schema guarantee across every reachable branch. Finish the rollout phase's documentation.

### Changes Required:

#### 1. Provider-error branch tests + cross-branch schema check

**File**: `tests/integration/risk6-generation-error-hygiene.test.ts` (new)

**Intent**: Prove the two untested provider-error branches behave correctly and prove no branch's response body ever contains anything beyond the fixed `{error: <ApiErrorCode>}` (or `{candidates}` on success) shape.

**Contract**: Import `POST` from `@/pages/api/flashcards/generate`; drive `tests/setup/msw.ts`'s `server` locally (`beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }))`, `afterEach(() => server.resetHandlers())`, `afterAll(() => server.close())`). Seed one signed-in test user via the existing `seedUser`/`getAuthCookieHeader` pattern.

1. `server.use(http.post(OPENROUTER_URL, () => HttpResponse.json({}, { status: 429 })))` → assert `429 {error:"rate_limited"}` exactly.
2. `server.use(http.post(OPENROUTER_URL, () => HttpResponse.error()))` (simulated network failure — covers both the generic-failure and timeout-collapse claims per Key Discoveries) → assert `502 {error:"ai_unavailable"}` exactly, and that the body contains no `message`/`stack`/other field.
3. A parameterized (`it.each`) cross-branch check reusing already-reachable branches — `unauthorized` (no cookie), `invalid_input` (malformed JSON body), `empty_input`/`too_long` (via `generateRequestSchema`'s own boundaries), `no_cards` (MSW returns a well-formed empty `{cards: []}`), plus the two branches from cases 1-2 above — asserting each response body's `Object.keys(...)` is exactly `["error"]` with the value drawn from the fixed `ApiErrorCode` union (`src/lib/flashcards/schemas.ts:61-71`).

#### 2. Cookbook update

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.5 "TBD" placeholder and add a short MSW-provider-mocking pattern note so future phases reuse `tests/setup/msw.ts` rather than reinventing it.

**Contract**: §6.5 describes the RLS-immediate-lockout + purge-boundary-seeding pattern (referencing `seedAccountDeletion` and the two new Phase 2 test files). A new short paragraph (appended to §6.2 or as a new §6.x, whichever reads better in context) describes the MSW scoped-server pattern from Critical Implementation Details, so a future phase mocking a different provider doesn't re-derive the blast-radius constraint.

### Success Criteria:

#### Automated Verification:

- `npm test -- tests/integration/risk6-generation-error-hygiene.test.ts` passes
- `npm test` (full suite) passes — confirms MSW's scoped lifecycle doesn't affect any other integration test's real Supabase calls
- `npm run lint` passes

#### Manual Verification:

- `test-plan.md` §6.5 no longer reads "TBD"; the MSW note is present and accurately describes the scoped-server constraint

**Implementation Note**: Pause here for manual confirmation before this rollout phase is considered implementation-complete.

---

## Testing Strategy

### Integration Tests:

- RLS-layer: pending-deletion immediately locks a user's own data (Phase 2.1)
- Route-wiring: purge boundary (day 29/30/31), auth gate (Phase 2.2)
- Route-wiring: generation endpoint provider-error branches + cross-branch schema (Phase 3.1)

### Unit Tests:

- Hermetic: purge partial-batch-failure reporting, mocked admin client only (Phase 2.3)

### Manual Testing Steps:

1. Run each new file in isolation against a freshly-started `supabase start` to confirm no ordering dependency on other tests' leftover state.
2. Run the full suite once to confirm the scoped MSW server doesn't leak interception into unrelated test files.

## Migration Notes

None — no schema changes in this phase; `account_deletions` and its RLS policies already exist from the original account-deletion change.

## References

- Research: `context/changes/testing-compliance-critical-flows/research.md`
- Existing two-layer pattern (RLS vs. route-wiring): `tests/integration/risk1-rls-isolation.test.ts`, `tests/integration/risk1-api-route-ownership.test.ts`
- Existing hermetic-mock precedent: `tests/unit/risk1-risk2-save-endpoint-hermetic.test.ts`
- Purge route: `src/pages/api/cron/purge.ts`
- Generation endpoint: `src/pages/api/flashcards/generate.ts`, `src/lib/flashcards/generation.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test infrastructure

#### Automated

- [x] 1.1 `npm run lint` passes — d1de18e
- [x] 1.2 `npm test -- tests/integration/harness-smoke.test.ts` still passes — d1de18e

#### Manual

- [x] 1.3 `npm ls msw` shows the package installed — d1de18e

### Phase 2: Risk #4 — account-deletion retention boundary

#### Automated

- [x] 2.1 `npm test -- tests/integration/risk4-pending-deletion-rls.test.ts` passes
- [x] 2.2 `npm test -- tests/integration/risk4-purge-boundary.test.ts` passes
- [x] 2.3 `npm test -- tests/unit/risk4-purge-partial-failure-hermetic.test.ts` passes
- [x] 2.4 `npm run lint` passes

#### Manual

- [x] 2.5 Three new Phase 2 files pass against a freshly-started `supabase start`

### Phase 3: Risk #6 — AI-generation error-response data hygiene

#### Automated

- [ ] 3.1 `npm test -- tests/integration/risk6-generation-error-hygiene.test.ts` passes
- [ ] 3.2 `npm test` (full suite) passes
- [ ] 3.3 `npm run lint` passes

#### Manual

- [ ] 3.4 `test-plan.md` §6.5 and the MSW cookbook note are filled in and accurate
