# E2E Coverage for Risk #3 (IDOR) and Risk #8 (Route-Protection Drift) Implementation Plan

## Overview

Add Playwright e2e coverage for the two highest-ranked risks in `context/foundation/test-plan.md` that currently have integration-test coverage only: Risk #3 (cross-user direct-ID access to a flashcard) and Risk #8 (route-protection drift). Both risks already have strong Vitest integration tests that call route handlers / middleware directly; this plan adds a thin real-HTTP/real-browser layer on top, proving the app's live routing and middleware wiring — not re-proving the logic those tests already cover.

## Current State Analysis

- `tests/integration/risk3-idor-not-found-equivalence.test.ts` calls `PATCH_CARD`, `PATCH_REVIEW`, `DELETE` route handlers directly via a hand-built `APIContext` (`tests/helpers/api-context.ts`'s `buildContext`), proving 404-equivalence between a never-created UUID and another user's real card ID for all three by-id routes.
- `tests/integration/risk8-protected-routes-oracle.test.ts` calls `onRequest` (`src/middleware.ts`) directly with a fabricated context, proving the middleware's redirect/pass-through logic against every real page route (6 protected, 4 public) plus 6 adversarial near-misses.
- Neither test goes through the real HTTP transport or a real browser — both stop one layer short of "does the live running app actually enforce this."
- `tests/e2e/` has exactly one authenticated identity (the global `storageState` from `auth.setup.ts`, shared via `playwright.config.ts`'s single `chromium` project) and no unauthenticated project — both are needed here and don't exist yet.
- The app has no UI surface exposing another user's flashcard ID (no share/by-id page), so Risk #3's e2e test cannot be UI-driven; it uses Playwright's `request` API with real cookies instead.

### Key Discoveries:

- `tests/helpers/auth.ts`'s `seedUser()`, `cleanupUser()`, and `getAuthCookieHeader()` are plain Node functions already used by integration tests — directly reusable inside a Playwright test body (Playwright tests run in Node, not the browser).
- Playwright supports a per-file `test.use({ storageState: { cookies: [], origins: [] } })` override that replaces the project-level `storageState` for just that file's tests — no `playwright.config.ts` changes needed for Risk #8's unauthenticated case.
- `src/pages/index.astro` (the public `/` route) has no `client:load` island, so `waitForAstroHydration` (`tests/e2e/wait-for-hydration.ts`) resolves immediately there — safe to use the mandatory `gotoAndWaitForHydration` helper on it.
- `src/pages/auth/signin.astro` (the redirect target for a protected route) does have a `client:load` island — `gotoAndWaitForHydration` correctly waits for it after Playwright follows the redirect.
- `context.request.newContext({ baseURL, extraHTTPHeaders: { Cookie } })` (Playwright's `APIRequestContext`) is the way to issue a real HTTP request carrying a specific cookie string — this is how Risk #3's cross-user request will be sent as userB while `page` stays authenticated as userA.

## Desired End State

Two new Playwright spec files exist under `tests/e2e/`, both passing under `npm run test:e2e`:

- A Risk #3 spec proves that a real HTTP DELETE, authenticated as a second real user, against a real card ID owned by the storageState user, returns a real 404 from the live dev server — not just from a directly-invoked handler.
- A Risk #8 spec proves that a real, unauthenticated browser navigating to a protected route is really redirected to `/auth/signin` by the live server, while a public route and an adversarial near-miss both stay reachable.

Verify via `npm run test:e2e` (both new spec files pass) and `npm run test` (existing integration tests remain green, untouched).

## What We're NOT Doing

- Not re-testing all 3 by-id routes' 404-equivalence in Risk #3's e2e spec — one route (DELETE) is enough to prove the real-HTTP-wiring layer; the integration test already exhaustively covers per-route logic.
- Not replaying the full 6-protected/4-public/6-near-miss matrix in Risk #8's e2e spec — a 3-route smoke (1 protected, 1 public, 1 near-miss) proves the live wiring; the integration test already exhaustively covers the logic.
- Not adding a "signed-in user can still reach protected routes" assertion to the Risk #8 spec — `seed.spec.ts` and the Risk #1 e2e spec already exercise this as part of their normal flow.
- Not adding a list-scoping ("userB's `/cards` never shows userA's card") assertion to the Risk #3 spec — that's Risk #1's concern, already covered elsewhere; conflating it here would muddy which risk a future failure belongs to.
- Not adding a new Playwright project or changing `playwright.config.ts` — the per-file `storageState` override covers Risk #8's unauthenticated need without a config change.
- Not changing CI wiring — both new files land under the existing `tests/e2e/` directory already picked up by `npm run test:e2e`, which is already a required CI gate.

## Implementation Approach

Each risk gets its own spec file and its own phase, since the two are independent (different files, different new plumbing, no shared state). Both follow the existing e2e conventions: `getByRole` locators where UI interaction happens, `gotoAndWaitForHydration`/`reloadAndWaitForHydration` for all navigation, timestamp-suffixed unique data, and self-contained setup/action/assertion/cleanup per test.

## Critical Implementation Details

**Risk #3 cleanup ordering.** Seeding `userB` via `seedUser()` creates a real Supabase Auth user that nothing else cleans up (unlike the global storageState user, which `global-teardown.ts` deletes at the end of the whole suite). Wrap the cross-user request assertion so `cleanupUser(userB.id)` still runs if an assertion throws — e.g. via `try/finally` around the request-and-assert block — otherwise a failed test run leaks a throwaway auth user.

**Risk #3 card lookup.** The already-authenticated `page` creates the flashcard via the real `/create` UI flow (same as the Risk #1 e2e spec), but the UI never surfaces the raw card ID. Fetch the ID after creation via `adminClient()` (`tests/helpers/auth.ts`), querying `flashcards` by the test's unique question text — this bypasses RLS deliberately (admin lookup, not an ownership check) purely to obtain the ID for the subsequent cross-user attempt.

## Phase 1: Risk #3 — IDOR cross-user e2e coverage

### Overview

Prove that a real HTTP DELETE against another user's flashcard, authenticated as a second real user, is rejected with a 404 by the live dev server.

### Changes Required:

#### 1. New e2e spec

**File**: `tests/e2e/risk3-idor-cross-user-delete.spec.ts`

**Intent**: As the storageState-authenticated user (userA), create a flashcard via the real `/create` UI flow with a unique timestamp-suffixed question. Look up its id via `adminClient()`. Seed a fresh throwaway user (userB) via `seedUser()`/`getAuthCookieHeader()`. Issue a real `DELETE /api/flashcards/{id}` against the live dev server using an `APIRequestContext` carrying userB's cookie header, and assert the response is a 404 with the same `{ error: "not_found" }` body shape the integration test asserts. Clean up: `cleanupUser(userB.id)` in a `finally` block; delete userA's card via the real UI delete flow (mirrors the Risk #1 e2e spec's cleanup) so the test remains self-contained.

**Contract**: Reuses `tests/helpers/auth.ts`'s `seedUser`, `cleanupUser`, `getAuthCookieHeader`, and `adminClient` directly (plain Node functions, importable in a Playwright test). Uses Playwright's `request.newContext({ baseURL, extraHTTPHeaders: { Cookie: cookieB } })` to issue the DELETE, then `apiContext.dispose()` after. Expected response: `{ status: 404, body: { error: "not_found" } }`, matching `tests/integration/risk3-idor-not-found-equivalence.test.ts`'s `NOT_FOUND` constant.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npm run test:e2e -- risk3-idor-cross-user-delete`
- Full e2e suite still passes: `npm run test:e2e`
- Lint passes: `npm run lint`
- Existing integration tests unaffected: `npm run test`

#### Manual Verification:

- Confirm in the Playwright HTML report that the DELETE request in the trace was sent with userB's session cookie, not userA's
- Confirm no orphaned Supabase Auth user remains after a full local run (spot-check via Supabase Studio or `supabase db` query)

---

## Phase 2: Risk #8 — route-protection drift e2e smoke

### Overview

Prove that a real, unauthenticated browser is genuinely redirected by the live server when navigating to a protected route, while a public route and an adversarial near-miss both stay reachable.

### Changes Required:

#### 1. New e2e spec

**File**: `tests/e2e/risk8-route-protection-smoke.spec.ts`

**Intent**: Override `storageState` to an empty cookie/origin set for this file's tests (signed-out browsing context). Navigate to `/cards` (protected) and assert the final URL is `/auth/signin`. Navigate to `/` (public) and assert it stays reachable (no redirect, expected content visible). Navigate to `/cardsxyz` (adversarial near-miss, not a real route) and assert it also stays reachable rather than being swept into the redirect by a substring match on `PROTECTED_ROUTES`.

**Contract**: `test.use({ storageState: { cookies: [], origins: [] } })` at the top of the file, scoped to its own tests only (does not affect other spec files' project-level `storageState`). All navigation via `gotoAndWaitForHydration` per the project's mandatory hydration-safe-navigation rule. Route selection mirrors `tests/integration/risk8-protected-routes-oracle.test.ts`'s `EXPECTED_PROTECTED`/`EXPECTED_PUBLIC`/`ADVERSARIAL_NEAR_MISSES` sets (one representative from each), not a full replay of that test's exhaustive matrix.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npm run test:e2e -- risk8-route-protection-smoke`
- Full e2e suite still passes: `npm run test:e2e`
- Lint passes: `npm run lint`
- Existing integration tests unaffected: `npm run test`

#### Manual Verification:

- Confirm in the Playwright HTML report that the `/cards` navigation actually followed a redirect to `/auth/signin` (not just landed there some other way)
- Confirm the empty-storageState override didn't leak into other spec files' runs in the same worker (spot-check another spec's trace still shows the authenticated cookie)

---

## Testing Strategy

### Unit Tests:

- None — both phases are e2e-only; no new pure-function logic is introduced.

### Integration Tests:

- None new — Risk #3 and Risk #8's integration-layer coverage already exists and is unchanged by this plan.

### Manual Testing Steps:

1. Run `npm run test:e2e` locally with `supabase start` running and confirm both new specs pass.
2. Open the Playwright HTML report (`npx playwright show-report`) and inspect both new specs' traces per the Manual Verification bullets above.
3. Intentionally comment out the `PROTECTED_ROUTES` guard in `src/middleware.ts` locally, re-run the Risk #8 spec, and confirm it fails (proves the test would actually catch the regression it targets) — then revert.

## Performance Considerations

None beyond the existing e2e suite's runtime — two additional specs, each with a small, fixed number of real navigations/requests.

## Migration Notes

Not applicable — no schema or data changes.

## References

- Risk map: `context/foundation/test-plan.md` (§2, rows #3 and #8)
- Existing integration coverage: `tests/integration/risk3-idor-not-found-equivalence.test.ts`, `tests/integration/risk8-protected-routes-oracle.test.ts`
- Existing e2e conventions: `tests/e2e/seed.spec.ts`, `tests/e2e/risk1-flashcard-persists-after-reload.spec.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/navigate.ts`
- Auth/DB helpers: `tests/helpers/auth.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #3 — IDOR cross-user e2e coverage

#### Automated

- [x] 1.1 New spec passes: `npm run test:e2e -- risk3-idor-cross-user-delete` — e254037
- [x] 1.2 Full e2e suite still passes: `npm run test:e2e` — e254037
- [x] 1.3 Lint passes: `npm run lint` — e254037
- [x] 1.4 Existing integration tests unaffected: `npm run test` — e254037

#### Manual

- [x] 1.5 Confirm in the Playwright HTML report that the DELETE request was sent with userB's session cookie — e254037
- [x] 1.6 Confirm no orphaned Supabase Auth user remains after a full local run — e254037

### Phase 2: Risk #8 — route-protection drift e2e smoke

#### Automated

- [x] 2.1 New spec passes: `npm run test:e2e -- risk8-route-protection-smoke`
- [x] 2.2 Full e2e suite still passes: `npm run test:e2e`
- [x] 2.3 Lint passes: `npm run lint`
- [x] 2.4 Existing integration tests unaffected: `npm run test`

#### Manual

- [x] 2.5 Confirm the `/cards` navigation actually followed a redirect to `/auth/signin`
- [x] 2.6 Confirm the empty-storageState override didn't leak into other spec files' runs
