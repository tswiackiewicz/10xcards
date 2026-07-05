# Authorization & Input-Boundary Hardening — Plan Brief

> Full plan: `context/changes/testing-authorization-input-boundary-hardening/plan.md`
> Research: `context/changes/testing-authorization-input-boundary-hardening/research.md`

## What & Why

Rollout Phase 2 of the test plan: prove Risk #3 (IDOR — a user reaches
another user's flashcard by guessing/reusing a resource ID) and Risk #7
(empty/whitespace/over-cap input to AI generation) are actually protected,
not merely assumed. Both risks come from the project's frozen Risk Map
(`test-plan.md` §2).

## Starting Point

Research found Risk #3 is already mostly covered: Phase 1's
`risk1-api-route-ownership.test.ts` already proves user B's request against
user A's card 404s on all three by-id routes. The real gap is narrower —
nothing proves that outcome is _identical_ to the genuinely-nonexistent-ID
case, not just coincidentally the same shape. Risk #7 has zero test
coverage, but the validation code itself (`generateRequestSchema`) is
already correct per the PRD.

## Desired End State

A never-created UUID and another user's real card ID produce provably
identical 404 responses on all three by-id routes. Empty, whitespace-only,
and over-cap generation input are unit-tested against the real schema and
error-mapping function, with no HTTP/DB/provider involved. A Stryker pass
confirms no meaningful gap survives in either area.

## Key Decisions Made

| Decision                         | Choice                                                       | Why (1 sentence)                                                                                                                              | Source                |
| -------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| IDOR equivalence scope           | All three by-id routes, shared expected-response constant    | Closes the exact gap uniformly; a shared constant makes the equivalence explicit rather than implied                                          | Plan (user-confirmed) |
| `mapInputError` testability      | Export it, unit test directly                                | Matches the test-plan's own "cheapest layer: unit" call; avoids both an unnecessary integration test and a mirror-implementation anti-pattern | Plan (user-confirmed) |
| Defense-in-depth client check    | Deferred, not this phase                                     | No route currently has this bypass; keeps scope to the risks as written                                                                       | Plan (user-confirmed) |
| Risk #7 boundary values          | Standard four: empty, whitespace-only, exactly-at-cap, cap+1 | Covers every boundary named in the PRD and risk map                                                                                           | Plan (user-confirmed) |
| Client-side `ERROR_COPY` testing | Out of scope this phase                                      | API-level typed error code is the cheapest layer with real signal; no component-test layer exists yet                                         | Plan (user-confirmed) |
| Mutation-testing pass            | Yes, same cookbook pattern as Phase 1                        | Phase 1 found 2 real gaps this way; consistent precedent                                                                                      | Plan (user-confirmed) |

## Scope

**In scope:**

- New integration test: IDOR not-found-vs-not-owned equivalence (3 routes)
- New unit test: input-boundary validation + error mapping
- Exporting `mapInputError` from `generate.ts`
- Scoped Stryker pass on `generate.ts` + `schemas.ts`
- `test-plan.md` cookbook + status sync

**Out of scope:**

- A `GET`-by-id route (doesn't exist)
- App-level ownership filters (RLS-only pattern stays as-is)
- Session-bound-client architecture test (deferred)
- `GenerateView.tsx` `ERROR_COPY` testing
- Any change to `manualCardSchema`, `saveRequestSchema`, `reviewSchema`

## Architecture / Approach

Two independent, additive test files reusing the existing two-user harness
(`tests/helpers/auth.ts`, `api-context.ts`) and the hermetic/hermetic-unit
split already established in Phase 1. One minimal production change (adding
`export` to `mapInputError`) makes Risk #7's mapping directly unit-testable.
A scoped Stryker run follows, then a cookbook sync closes the phase.

## Phases at a Glance

| Phase                        | What it delivers                                                   | Key risk                                                       |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. IDOR equivalence          | New integration test proving not-found ≡ not-owned across 3 routes | Local Supabase must be running; test-only, no app change       |
| 2. Input-boundary unit tests | New unit test + exported `mapInputError`                           | Minor production diff (one `export` keyword)                   |
| 3. Mutation-testing pass     | Stryker score + triaged survivors for `generate.ts`/`schemas.ts`   | May surface out-of-scope survivors needing individual judgment |
| 4. Cookbook & test-plan sync | `test-plan.md` §3/§6 updated, `change.md` closed                   | None                                                           |

**Prerequisites:** Local Supabase running (`supabase start`) for Phase 1 and full-suite runs; no other setup — all harness code already exists from Rollout Phase 1.
**Estimated effort:** ~1 session across 4 phases — mostly test-writing, one one-line production change, no new infrastructure.

## Open Risks & Assumptions

- Session-bound-client defense-in-depth is deferred — flagged for a future `/10x-test-plan --refresh` or `/10x-lesson` entry, not a gap in this phase's own scope.
- Stryker's full-suite run may surface survivors outside `generate.ts`/`schemas.ts`'s two risks (e.g. `rate_limited`/`ai_unavailable` branches) — each must still be individually judged per the project's existing rubric, not blanket-ignored.

## Success Criteria (Summary)

- A never-created card ID and another user's real card ID are provably indistinguishable to the caller, on all three by-id routes.
- Submitting empty, whitespace-only, or over-cap generation input is proven to fail with the correct typed error code — and exactly-at-cap input is proven to pass — via a fast, infra-free unit test.
- `test-plan.md` marks Rollout Phase 2 complete with its cookbook patterns filled in for future contributors.
