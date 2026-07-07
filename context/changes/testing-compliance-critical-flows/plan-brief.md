# Compliance-Critical Flows — Plan Brief

> Full plan: `context/changes/testing-compliance-critical-flows/plan.md`
> Research: `context/changes/testing-compliance-critical-flows/research.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md` closes the last two untested High-impact risks: the account-deletion retention/purge boundary (Risk #4, GDPR erasure promise) and AI-generation error responses leaking source text or provider internals (Risk #6). Both are currently zero-coverage.

## Starting Point

`account_deletions` + an `is_pending_deletion()` RLS helper already lock a pending account's flashcards immediately; a daily GitHub Actions cron hits a bearer-secret-gated route (`src/pages/api/cron/purge.ts`) that erases eligible accounts after 30 days. The generation endpoint (`src/pages/api/flashcards/generate.ts`) already returns only a fixed `{error: <code>}` shape on every failure branch — no leak exists today, but `rate_limited` and the generic `ai_unavailable` catch-all have zero test coverage (flagged by Phase 2's mutation-testing pass).

## Desired End State

Three new test files (plus one hermetic unit test) prove: a pending account is locked out of its own data immediately (not at day 30) while sign-in itself still succeeds-but-redirects; the purge route erases exactly the accounts past the 30-day boundary, rejects unauthenticated calls, and reports partial failures instead of masking them; and every reachable generation-endpoint error branch returns only the allowed-fields shape.

## Key Decisions Made

| Decision                               | Choice                                                      | Why (1 sentence)                                                                         | Source                                        |
| -------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| Sign-in vs. RLS for Risk #4 protection | Corrected test-plan.md §2 wording                           | Research found sign-in succeeds-and-redirects; RLS is the real gate, not auth            | Research                                      |
| Provider mock for Risk #6              | Install MSW (per stack §4)                                  | Honors the already-documented tool choice; reusable for future provider mocks            | Plan (user-confirmed)                         |
| Purge route's own auth gate            | In scope for Risk #4                                        | It's the literal guard in front of the erasure step                                      | Plan (user-confirmed)                         |
| Partial-batch-failure coverage         | Hermetic unit test, mocked admin client                     | FK cascade makes a real "row present, deleteUser fails" state unseedable via integration | Plan (user-confirmed, revised after research) |
| Timeout-specific test                  | Folded into the generic-network-failure test                | Code has one bare `catch` — timeout and network failure are literally indistinguishable  | Plan (research-derived)                       |
| Risk #6 branch coverage width          | Gap-focused (2 branches) + one cross-branch shape assertion | Matches cost × signal — 5 of 7 branches already have indirect coverage                   | Plan (user-confirmed)                         |

## Scope

**In scope:** retention/purge boundary tests, purge auth gate, partial-batch-failure reporting, generation endpoint `rate_limited` + network-failure branches, cross-branch allowed-fields schema check, MSW infra (scoped to one file), `account_deletions` age-seeding helper, `test-plan.md` §6.5 cookbook update.

**Out of scope:** account reactivation, missing-API-key 503 branch in the schema check, generation retry/fallback logic, rollout Phase 4's migration-drift gate and e2e smoke.

## Architecture / Approach

Two-layer split per risk, mirroring Phases 1-2's established pattern: an RLS/DB-layer test and a route-wiring test for Risk #4; a single route-wiring test file for Risk #6. MSW's server lifecycle is driven locally inside the one file that needs it (not wired into `vitest.config.ts` globally) so it can't intercept other integration tests' real Supabase calls.

## Phases at a Glance

| Phase                  | What it delivers                                                                          | Key risk                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Test infrastructure | Fixed test secrets, `buildContext` headers option, age-seeding helper, MSW server factory | Getting the MSW blast-radius scoping wrong would break every other integration test            |
| 2. Risk #4             | Immediate RLS lockout test, purge boundary/auth-gate test, hermetic partial-failure test  | Boundary-seeding timing race if exact-30-day values are used instead of wider margins          |
| 3. Risk #6             | `rate_limited` + network-failure tests, cross-branch schema check, cookbook update        | None significant — the hard design questions (MSW, timeout collapse) were resolved in planning |

**Prerequisites:** local `supabase start` running; `SUPABASE_SERVICE_ROLE_KEY` already available via existing `globalSetup`.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumes `msw` v2's Node `setupServer` API (matches current `msw` major version as of this plan) — verify the installed version's API shape when running `npm install -D msw`.
- Assumes no other test file will need OpenRouter mocking before this ships; if one does, `tests/setup/msw.ts`'s factory is reusable but its lifecycle wiring is not yet centralized.

## Success Criteria (Summary)

- A soft-deleted account's data becomes inaccessible immediately, and the purge only ever erases accounts past 30 days — verified by tests, not just by reading the code.
- No AI-generation error response can ever include more than the fixed `{error: <code>}` shape — verified across every reachable branch, not just the ones happy-path testing already touched.
