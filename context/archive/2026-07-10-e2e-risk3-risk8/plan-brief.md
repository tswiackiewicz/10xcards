# E2E Coverage for Risk #3 (IDOR) and Risk #8 (Route-Protection Drift) — Plan Brief

> Full plan: `context/changes/e2e-risk3-risk8/plan.md`

## What & Why

`context/foundation/test-plan.md` ranks risks by impact × likelihood. Of the two currently without any e2e coverage, Risk #3 (IDOR — cross-user direct-ID access) and Risk #8 (route-protection drift) rank highest. Both already have solid Vitest integration tests, but those call route handlers / middleware directly rather than through a real HTTP server or browser — this plan closes that last layer.

## Starting Point

- Risk #3: `tests/integration/risk3-idor-not-found-equivalence.test.ts` proves 404-equivalence for all 3 by-id routes via a hand-built `APIContext`.
- Risk #8: `tests/integration/risk8-protected-routes-oracle.test.ts` proves the middleware's redirect logic via a fabricated context, against every real route.
- Neither goes through real HTTP transport or a real browser. The e2e harness (`tests/e2e/`) currently supports exactly one authenticated identity and no unauthenticated context — both new for this plan.

## Desired End State

Two new Playwright specs, passing under `npm run test:e2e`: one proves a real cross-user DELETE gets a real 404 from the live server; one proves a real signed-out browser gets genuinely redirected off a protected route while public/near-miss routes stay reachable.

## Key Decisions Made

| Decision                | Choice                                                              | Why (1 sentence)                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk #3 mechanism       | Playwright `request` context with real cookies, no UI               | No UI surface exposes another user's card ID; this is the thinnest real-HTTP layer that adds genuine signal beyond the integration test      |
| Risk #3 route coverage  | Single route (DELETE)                                               | The integration test already exhaustively covers all 3 routes' logic — repeating it 3x in a browser layer adds no new signal                 |
| Risk #3 second identity | Reuse storageState user as A, seed fresh userB via existing helpers | Matches test-independence convention for the one new identity; avoids inventing a second real sign-in flow the risk isn't about              |
| Risk #3 scope           | Direct-ID access only, no list-scope bonus check                    | Avoids the exact anti-pattern the risk map warns against — conflating Risk #1's list-scoping with Risk #3's direct-ID concern                |
| Risk #8 anon context    | Per-file `test.use({ storageState: empty })`                        | Playwright's supported override, no `playwright.config.ts` changes needed for a single spec's need                                           |
| Risk #8 route coverage  | 3-route smoke (1 protected, 1 public, 1 near-miss)                  | The integration test already exhaustively covers the full inventory; a smoke proves the live wiring without repeating it slowly in a browser |
| Risk #8 signed-in check | Omitted — relies on existing suite                                  | `seed.spec.ts` / Risk #1 e2e spec already navigate as signed-in to protected pages every run                                                 |
| Phasing                 | Two independent phases                                              | Different files, different new plumbing, no shared state between the two risks                                                               |

## Scope

**In scope:**

- One new e2e spec for Risk #3 (cross-user DELETE via real HTTP)
- One new e2e spec for Risk #8 (signed-out navigation smoke)

**Out of scope:**

- Full route-matrix replay for either risk (already exhaustively covered at the integration layer)
- Any `playwright.config.ts` or CI wiring changes
- List-scoping or signed-in-reachability assertions (already covered elsewhere)

## Architecture / Approach

Both specs reuse existing helpers (`tests/helpers/auth.ts`'s `seedUser`/`cleanupUser`/`getAuthCookieHeader`/`adminClient`) and existing e2e conventions (`gotoAndWaitForHydration`, timestamp-suffixed data, self-contained setup/action/assertion/cleanup). No new shared infrastructure beyond the per-file `storageState` override pattern for Risk #8.

## Phases at a Glance

| Phase          | What it delivers                              | Key risk                                                               |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Risk #3 e2e | Real cross-user DELETE returns real 404       | Orphaned throwaway auth user if cleanup isn't wrapped in `try/finally` |
| 2. Risk #8 e2e | Real signed-out redirect + reachability smoke | `storageState` override leaking into other spec files if misplaced     |

**Prerequisites:** Local `supabase start` running (same as existing e2e suite); no new dependencies.
**Estimated effort:** ~1 session, 2 small phases.

## Open Risks & Assumptions

- Assumes no future UI feature adds a share/by-id surface for flashcards — if one lands, Risk #3's e2e coverage should be revisited to test through that UI instead of the request-context shortcut.
- Assumes the middleware's `PROTECTED_ROUTES` array doesn't diverge from the page inventory during this plan's lifetime — Risk #8's integration test is the source of truth for the full inventory; this e2e spec only smoke-tests wiring.

## Success Criteria (Summary)

- `npm run test:e2e` passes with both new specs included, alongside the existing suite.
- A deliberate regression in `src/middleware.ts` (per the plan's manual testing step) causes the Risk #8 spec to fail, proving it actually catches what it targets.
