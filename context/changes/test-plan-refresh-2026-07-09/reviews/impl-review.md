<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Lifecycle & Route-Protection Hardening (Phase 5)

- **Plan**: context/changes/test-plan-refresh-2026-07-09/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-07-09
- **Verdict**: REJECTED
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success Criteria independently re-run for this review (not just taken from Progress): `npx astro sync` clean, `npm run lint` clean, `npm test` → 16 files / 53 tests passed, `npm run build` → completed without error. Local Supabase was already running, so this was a real re-run, not a rubber-stamp of the Progress log.

## Findings

### F1 — Purge's atomic claim silently drops retry-ability on `deleteUser` failure

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/cron/purge.ts:71-94
- **Detail**: Pre-fix, `account_deletions` rows were removed only as a cascade side effect of a _successful_ `deleteUser` (FK `on delete cascade` from `auth.users`, `supabase/migrations/20260702145938_create_account_deletions.sql:18`). A transient `deleteUser` failure left the row in place, so the next daily cron run retried it. Phase 2's atomic-claim fix (correctly closing Risk #9's reactivation race) now deletes the `account_deletions` row _before_ `deleteUser` is even attempted (claim at purge.ts:71-77 runs before the `deleteUser` loop at 88-94). If `deleteUser` fails (the `errors++` branch, purge.ts:92), the tracking row is already gone — there is no mechanism left to retry that user. Worse: `is_pending_deletion()` (the SECURITY DEFINER helper the flashcards RLS policies key off, same migration file) checks for the _presence_ of the `account_deletions` row — so once the row is gone, the account silently reverts to "active" and the user's flashcards become visible/editable again, even though the auth user was never actually deleted and never reactivated. This is a genuine regression introduced by the Risk #9 fix itself: the race the plan explicitly avoided (a legitimate reactivation losing to a stale purge) is now traded for a new one (a failed purge silently un-blocking a soft-deleted account and permanently dropping it from the retry backlog, past the GDPR 30-day retention promise). Neither `risk9-purge-claim-hermetic.test.ts` nor `risk4-purge-partial-failure-hermetic.test.ts` asserts anything about re-tracking a claimed row on `deleteUser` failure — both only check `deleted`/`errors` counts. Not called out in the plan, the commit message, or as a known limitation anywhere.
- **Fix A**: On `deleteUser` failure, re-insert the claimed row (same `user_id`, original `requested_at`) before returning, so the next run picks it back up.
  - Strength: Restores retry-ability without reintroducing the original select-then-loop race — the row only needs to survive a `deleteUser` failure, not a success.
  - Tradeoff: Adds a write path that must be reasoned about carefully — it must not resurrect a row if a concurrent, legitimate reactivation already (correctly) removed it in the interim between claim and re-insert.
  - Confidence: MED — mechanically sound, but needs its own regression test (a hermetic test forcing `deleteUser` to fail and asserting the row is re-tracked, not silently dropped).
  - Blind spot: Real-world `deleteUser` failure rate/causes (transient network vs. permanent GoTrue error) aren't known, which affects how urgent this is in practice.
- **Fix B**: Accept the regression as a known, documented gap — rely on the existing `errors > 0` → HTTP 500 (purge.ts:103-105) to alert on-call, and record it as a follow-up risk row rather than fixing it inline now.
  - Strength: Zero code risk today; the alerting path already exists and matches the code's existing "errors surface via non-2xx" intent.
  - Tradeoff: No automatic remediation — a human has to notice the alert and manually re-add the tracking row (or manually finish the deletion) every time this triggers, and until they do, that account's data is silently unprotected by the soft-delete gate it's supposed to have.
  - Confidence: MED — depends on how often `deleteUser` actually fails in production, which is unverified.
- **Decision**: FIXED via Fix A — `purge.ts`'s `deleteUser` failure branch now re-inserts the claimed row (`user_id`, original `requested_at`) so the next run retries it; `risk9-purge-claim-hermetic.test.ts` gained a new regression test asserting the re-insert happens with the right payload, and `risk4-purge-partial-failure-hermetic.test.ts`'s mock was extended for the new third `from()` call. A narrower residual race was surfaced and explicitly accepted before implementing: a `reactivate.ts` call landing in the split-second between claim and re-insert gets a `200 { ok: true }` (0-row delete is treated as success) and then the row reappears anyway — far narrower than the original bug (single round-trip vs. whole batch loop) but not fully closed; the more robust `claimed_at`-column alternative was offered and declined in favor of shipping the simpler fix now. Lint, full test suite (54/54, up from 53), and build all re-verified green after the change.

### F2 — Two unplanned changes not in "Changes Required"

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260709190500_grant_flashcards_select_service_role.sql; vitest.config.ts:80
- **Detail**: (1) A new migration grants table-level `select` only on `flashcards` to `service_role` — narrowly scoped, and since `service_role` bypasses RLS by Supabase design regardless of grants, it changes no practical exposure; it's a benign fix for a previously-missing ACL grant discovered when the Risk #10 integration test's admin-client verification read 42501'd. It directly contradicts plan.md's Migration Notes ("No schema migration is required for the primary fix") and isn't mentioned in "Changes Required" or "What We're NOT Doing" anywhere — the contradiction is only explained after the fact, in the 0e087ba commit message. Its own comment also states the grant is for "backend verification reads," but the only actual consumer in the repo is a test file (`tests/integration/risk10-review-repeat-scheduling.test.ts:70`), not production backend code — the stated rationale is slightly misleading about who really needs this. (2) `fileParallelism: false` (vitest.config.ts:80) was added to fix two real-Supabase integration test files racing over shared purge rows, but it serializes the _entire_ suite (single `test.include` glob, all ~16 files across `tests/unit` + `tests/integration`), not just the two racing files. A narrower fix (Vitest workspace/project scoping, or per-file `describe.sequential`) was available and would avoid slowing every future test run as the suite grows; the current fix treats the symptom (files racing over shared global Supabase state) rather than the root cause (no per-test data isolation).
- **Fix**: Add a one-line addendum to plan.md's Migration Notes documenting the grant (already justified and low-risk — no code change needed) and correct the migration's comment to say "test verification reads" rather than "backend verification reads"; separately, track "scope `fileParallelism`/serialization to just the Supabase-dependent integration tests" as a `context/foundation/lessons.md` entry or follow-up so the whole suite isn't paying the serialization cost as it grows.
- **Decision**: FIXED (partial) — plan.md's Migration Notes now has a post-implementation addendum documenting the grant migration; the migration's comment was corrected to say "test verification reads" (naming the actual consumer, `tests/integration/risk10-review-repeat-scheduling.test.ts`) instead of "backend verification reads". The `fileParallelism: false` scoping issue was deliberately NOT fixed inline — it needs a Vitest workspace/project restructuring beyond this triage's scope — and is queued at `context/changes/test-plan-refresh-2026-07-09/follow-ups/review-fixes.md` for later pickup. Lint re-verified clean after the doc-only edits.

### F3 — Purge's claimed `select("user_id, requested_at")` differs from the plan's literal `select("user_id")`

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/cron/purge.ts:77
- **Detail**: The plan's Contract text specifies `.select("user_id")` on the claim; the actual code selects `"user_id, requested_at"`. This is a documented, empirically-driven correction (code comment at purge.ts:66-70 and the babd4b2 commit message both explain PostgREST requires the `order` column in the `select` list on a DELETE, or it 42703s) — not a defect, and consistent with the plan's own "Critical Implementation Details" section anticipating empirical surprises in this exact chain.
- **Fix**: None needed — documented correction, not drift.
- **Decision**: ACCEPTED — no code change needed; already correctly documented in the code comment and commit message.
