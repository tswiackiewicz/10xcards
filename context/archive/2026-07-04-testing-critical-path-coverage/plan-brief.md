# Critical-Path Coverage (Risk #1 & Risk #2) — Plan Brief

> Full plan: `context/changes/testing-critical-path-coverage/plan.md`
> Research: `context/changes/testing-critical-path-coverage/research.md`

## What & Why

Bootstrap a test runner from zero and prove two guardrails already hold in code: a user's flashcards never disappear or become visible/editable by a different account (Risk #1), and a rejected or un-actioned AI candidate never becomes a persisted flashcard (Risk #2). This is `test-plan.md` §3 Phase 1, scoped by explicit request to only these two risks.

## Starting Point

No test framework exists (`vitest`/`msw`/`@testing-library` all absent). Risk #1 already has a proven, hand-run oracle — `scripts/verify-rls.mjs`, exercising real two-user isolation via `supabase-js` directly — but it's never wired into CI or any test runner. Risk #2 has zero automated coverage: human-gating is enforced only by a client-side filter in `GenerateView.tsx`; the save endpoint has no server-side concept of accept/reject at all. CI currently never starts a local Supabase instance — only a dry-run push against the remote project.

## Desired End State

`npm test` runs a real Vitest suite against a real local Supabase instance and passes, both locally and as a required CI gate before deploy. A broken RLS policy or a broken save-endpoint contract now fails the build instead of relying on someone remembering to run a manual script.

## Key Decisions Made

| Decision                   | Choice                                                                                                                 | Why (1 sentence)                                                                                       | Source          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| `verify-rls.mjs` fate      | Port only the F-01 core (lines 69-129) into Vitest; leave SRS/purge sections as-is                                     | Those sections map to risks #4/#5, out of this phase's scope                                           | Plan (user Q&A) |
| Risk #2 scope              | Test-only — prove current client-only-enforced behavior, document the gap                                              | Matches this phase's "prove guardrails hold" charter, not a feature-redesign task                      | Plan (user Q&A) |
| MSW                        | Deferred to the phase that actually needs OpenRouter mocking                                                           | Neither risk in this phase needs HTTP mocking                                                          | Plan (user Q&A) |
| CI local Supabase          | `supabase/setup-cli@v1` (already present) + `supabase start` before tests                                              | Minimal new surface, reuses the existing action                                                        | Plan (user Q&A) |
| 401/middleware-gap test    | Skip                                                                                                                   | Tangential finding, not this phase's ownership/no-loss scope                                           | Plan (user Q&A) |
| Unit vs integration        | Integration-only this phase                                                                                            | Both risks are graded "integration" as cheapest real-signal layer; a mocked client would lie about RLS | Plan (user Q&A) |
| Route-level test mechanism | Direct handler invocation with a real cookie captured via a throwaway `@supabase/ssr` client, not a booted HTTP server | Cheaper and more deterministic than server boot/teardown; still exercises real handler + real Supabase | Plan            |

## Scope

**In scope:**

- Vitest bootstrap, aliased to match `tsconfig.json`'s `@/*`
- CI wiring: local Supabase start + required `npm test` step
- RLS-policy-layer test (ported from `verify-rls.mjs`)
- Route-wiring-layer test for the three by-ID flashcard mutation routes
- Save-endpoint contract test for Risk #2
- Cookbook (`test-plan.md` §6.1/§6.2) and rollout-status sync

**Out of scope:**

- Any production code change (both guardrails already work)
- SRS-column / purge-cascade tests (risks #4/#5)
- Server-side enforcement of AI-candidate accept/reject
- MSW, `@testing-library/react`, any DOM/component test
- The `/api/...` middleware-coverage gap found during research

## Architecture / Approach

Two proof layers for Risk #1: an RLS-policy layer (plain `supabase-js`, no Astro code, ported from the existing script) and a route-wiring layer (the real exported route handler functions, invoked directly with a real `Request` + a real session cookie obtained by replaying sign-in tokens through a throwaway `@supabase/ssr` client). Risk #2 reuses the same route-wiring mechanism against the save endpoint, submitting an independently-authored "mixed decision batch" payload and asserting the exact persisted set.

## Phases at a Glance

| Phase                          | What it delivers                                              | Key risk                                                                                            |
| ------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Test harness & CI bootstrap | Vitest + helpers + required CI gate, zero test assertions yet | Local Supabase never starting cleanly in CI (Docker availability)                                   |
| 2. Risk #1 tests               | RLS-policy + route-wiring isolation tests                     | Ported test losing signal vs. the original script                                                   |
| 3. Risk #2 test                | Save-endpoint contract test                                   | Test proves client-only behavior, not a server invariant — must be clearly documented, not oversold |
| 4. Cookbook & test-plan sync   | Docs reflect what shipped                                     | None — pure documentation                                                                           |

**Prerequisites:** Local Docker running (for `supabase start`); no other blockers.
**Estimated effort:** ~1-2 sessions across 4 phases — no new production code, mostly test infra + two focused test files.

## Open Risks & Assumptions

- Assumes GitHub Actions' `ubuntu-latest` runner has Docker available for `supabase start` without extra setup (standard, but not independently re-verified this session — Context7 quota was exhausted both this session and last).
- The Risk #2 test proves today's behavior only; if the save endpoint ever gains real accept/reject validation, the test's documented caveat comment should be revisited.

## Success Criteria (Summary)

- `npm test` passes locally and in CI against a real local Supabase instance
- A deliberately broken RLS policy fails a Phase 2 test; a deliberately-inflated save payload is caught as "saves everything" (documented, not silently assumed)
- `test-plan.md` no longer shows "TBD" for the cookbook sections this phase fills in
