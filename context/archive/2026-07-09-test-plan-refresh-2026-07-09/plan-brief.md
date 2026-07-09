# Lifecycle & Route-Protection Hardening (Phase 5) — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-07-09/plan.md`
> Research: `context/changes/test-plan-refresh-2026-07-09/research.md`

## What & Why

Close three gaps the 2026-07-09 test-plan refresh surfaced: route-protection drift (Risk #8), a real account-reactivation/purge race (Risk #9), and untested SRS repeat-review scheduling (Risk #10). Unlike Phases 1–4, this phase isn't pure test-addition — research found two genuine, currently-live bugs, not just missing coverage.

## Starting Point

- `middleware.ts`'s `PROTECTED_ROUTES` is a raw substring-prefix matcher — correct for all 6 current pages, but would silently mis-gate a future near-miss route (e.g. `/studying` matching `/study`).
- `purge.ts` selects eligible `account_deletions` rows into memory, then loops erasures without re-checking — a cancellation landing after that snapshot but before its row's turn in the loop is still erased. No test touches this path today.
- `srs.ts`'s scheduling function is pure and correct as written, but zero test grades a card twice — the exact fragility Phase 1's mutation testing already flagged once (a `SRS_COLUMNS` truncation survived undetected).

## Desired End State

Every real page's protection status is provable against an independently-authored, filesystem-cross-checked list; a cancelled account deletion always survives a concurrent purge; a card studied twice schedules its next review from the prior outcome, proven at both the pure-function and real-endpoint layers.

## Key Decisions Made

| Decision                     | Choice                                               | Why (1 sentence)                                                                                                                                  | Source                     |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Risk #9 fix scope            | Fix the race (atomic claim), not just document it    | The response guidance's own claim ("cancellation always survives") is only true if the code is fixed, and the fix costs zero extra subrequests    | Plan (confirmed with user) |
| Risk #8 fix scope            | Also harden the matcher to segment-boundary matching | Adversarial near-miss testing surfaced a second latent bug; leaving it undocumented-but-known felt worse than a one-line fix                      | Plan (confirmed with user) |
| Risk #8 oracle scope         | Page routes only, via middleware                     | Matches the risk's own framing and the existing Response Guidance's literal cheapest-layer text; API-route auth is a separate mechanism           | Plan (confirmed with user) |
| Risk #8 adversarial coverage | Include fabricated near-miss paths                   | Directly proves/disproves the prefix-collision matcher weakness research found                                                                    | Plan (confirmed with user) |
| Risk #10 test layers         | Unit + thin integration                              | Integration test specifically re-kills the exact `SRS_COLUMNS` mutant that seeded this risk; unit alone can't catch that regression class         | Plan (confirmed with user) |
| Phase sequencing             | 3 separate phases/commits, one per risk              | Matches "one logical change per commit" — isolates the two behavior-changing diffs (Risk #8, #9) from each other and from pure test-only Risk #10 | Plan (confirmed with user) |

## Scope

**In scope:**

- Segment-aware matcher fix + independent route-protection oracle test (Risk #8)
- Atomic claim-and-consume fix in `purge.ts` + real two-ordering test + hermetic regression guard (Risk #9)
- Unit + integration tests proving repeat-review scheduling correctness (Risk #10)

**Out of scope:**

- Auditing or testing `/api/**` route auth (structurally separate from `PROTECTED_ROUTES`)
- Any `account_deletions` schema change (no status column, no version field)
- Artificially interleaving a real HTTP call mid-purge-batch (the hermetic test covers this causal path instead)

## Architecture / Approach

Each risk gets its own phase and commit. Risk #8 and #9 pair a small, surgical production fix with the tests proving it; Risk #10 is pure test-addition since no bug was found in the current scheduling code. All new tests reuse the existing harness (`buildContext`, `seedUser`, `adminClient`, `getAuthCookieHeader`) established in Phases 1–4 — no new test infrastructure, only one extension (`buildContext` gains a `url` field for middleware tests).

## Phases at a Glance

| Phase                           | What it delivers                                                    | Key risk                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Route-protection oracle      | Segment-aware matcher + filesystem-cross-checked oracle test        | Adversarial test design must genuinely fail on a forgotten route, not just today's known six                             |
| 2. Reactivation/purge race fix  | Atomic claim in `purge.ts` + real ordering tests + regression guard | PostgREST delete+order+limit chaining must be verified against the pinned library version; has a documented RPC fallback |
| 3. SRS repeat-review scheduling | Unit + integration tests proving correct state carry-forward        | None — pure test-addition against already-correct code                                                                   |

**Prerequisites:** Local Supabase running (`supabase start`) for integration tests; no new dependencies.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- The atomic-claim fix assumes supabase-js's `.delete().order().limit()` chaining is honored by the pinned PostgREST version — unverified until Phase 2's first test run; a Postgres-function fallback is documented in the plan if it isn't.
- The segment-aware matcher fix and the atomic-claim fix are both small, well-understood one-area changes, but each touches a GDPR/auth-relevant path — both warrant careful review beyond the new tests alone.

## Success Criteria (Summary)

- A signed-out request to any real protected page redirects to sign-in; a fabricated near-miss path does not.
- A cancelled account deletion survives any purge run, regardless of ordering; the reverse ordering is a deterministic, documented no-op.
- A card studied twice schedules its next review from the prior outcome, proven at both the pure-function and real-endpoint layers.
