<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Deletion with 30-Day Retention

- **Plan**: context/changes/account-deletion/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-07-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Purge hides per-user deletion failures behind a 200

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/cron/purge.ts:60-72
- **Detail**: Per-row `deleteUser` failures are counted (`errors++`) and the batch continues (good — one failure doesn't abort). But the route returns `200 {deleted, skipped}` regardless of `errors`, so the GitHub Action's `curl -fsS` succeeds even when a user failed to delete. That user is retried each daily run and, if the failure persists, is silently retained past the 30-day GDPR window. The only signal is a Workers log line (`ok:false`); there is no alert or job failure.
- **Fix**: Return a non-2xx (e.g. 500) when `errors > 0`, and/or include `errors` in the response body, so the cron `curl -fsS` fails and the failure surfaces in the Actions UI.
  - Strength: Turns a silent compliance miss into a visible, actionable failure using the workflow's existing `-f` behavior.
  - Tradeoff: A partial run (some deleted, some failed) now reports failure — the operator must read the log to see partial progress.
  - Confidence: HIGH — the workflow already fails on non-2xx by design.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix now) — purge.ts returns 500 + {errors} when errors>0

### F2 — RLS helper re-evaluated per flashcards row

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260702145938_create_account_deletions.sql:87,93,100,106
- **Detail**: The predicate `auth.uid() = user_id and not public.is_pending_deletion(auth.uid())` is not wrapped in a scalar subselect, so Postgres re-evaluates the SECURITY DEFINER function (which reads `account_deletions`) once per candidate flashcards row on every SELECT/UPDATE/DELETE — the documented Supabase RLS perf pitfall. The plan's own "Performance Considerations" section assumed a single lookup.
- **Fix**: Wrap the call as `not (select public.is_pending_deletion(auth.uid()))` in all four policies so the planner folds it into one InitPlan. (New migration — the original is already committed/applied.)
  - Strength: Standard Supabase optimization; O(1) instead of O(rows) per query.
  - Tradeoff: Requires a follow-up migration; per-user card volumes are small so real-world impact today is minor.
  - Confidence: HIGH — well-established PostgREST/RLS pattern.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix now) — migration 20260702154817 wraps helper in scalar subselect

### F3 — New endpoints drop the typed `ApiErrorCode` + `fail()` pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/account/delete.ts:5-9, src/pages/api/account/reactivate.ts:5-9, src/pages/api/cron/purge.ts:5-9
- **Detail**: Siblings `flashcards/manual.ts` and `flashcards/index.ts` centralize a `fail(status, error: ApiErrorCode)` helper returning typed codes. The new endpoints keep a local `json()` helper but return ad-hoc untyped string bodies (`"unauthorized"`, `"server_error"`, `"service_unavailable"`, `"purge_failed"`) with no shared union. The plan permitted a small account-scoped error set OR reuse of `ApiErrorCode` — these are neither typed nor centralized.
- **Fix**: Define an account-scoped error-code union (or extend `ApiErrorCode`) and reintroduce a `fail()` helper across the three endpoints.
  - Strength: Restores type-checking on error codes and matches the established API shape.
  - Tradeoff: Minor churn across three small files.
  - Confidence: HIGH — mirrors an existing in-repo pattern.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix now) — added src/lib/account/schemas.ts AccountErrorCode + fail() in 3 endpoints

### F4 — 3.7 marked done without production verification

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/account-deletion/plan.md (Progress 3.7)
- **Detail**: 3.7 (GitHub Actions `workflow_dispatch` against production) is checked `[x]` but annotated "deferred: NOT production-verified". The checkbox was flipped to close the plan per user direction; the annotation preserves the true state. This is a transparent, intentional rubber-stamp — flagged here so it isn't mistaken for a real green production run.
- **Fix**: After deploying the Worker and provisioning `PURGE_URL` / `CRON_PURGE_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`, run `gh workflow run purge.yml`, confirm a green run, and update the annotation.
- **Decision**: ACCEPTED — deferred by design (human-gated production run)

### F5 — Destructive JSON+cookie endpoints rely on implicit Astro `checkOrigin`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/account/delete.ts, astro.config.mjs
- **Detail**: CSRF on the delete/reactivate endpoints is mitigated by Astro's default `checkOrigin` (rejects cross-site form/multipart POSTs) plus `application/json` forcing a CORS preflight. Neither is asserted in config, and the endpoints don't validate content-type. If the Astro default flips or session cookies aren't SameSite-strict, the destructive delete path could become CSRF-reachable. Not a regression — matches existing flashcards endpoints.
- **Fix**: Pin `security: { checkOrigin: true }` in astro.config.mjs now that a destructive endpoint depends on it.
- **Decision**: FIXED (Fix now) — pinned security.checkOrigin=true in astro.config.mjs

### F6 — Sign-in divert swallows the pending-check query error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/pages/api/auth/signin.ts:22-27
- **Detail**: The `{ data: pending }` select ignores its error; a transient failure sends a pending user to `/` instead of `/account`. Not a security issue — RLS still hides their data so the app appears empty — only a UX divert miss.
- **Fix**: Treat a query error as "assume pending" (redirect `/account`) or log it; acceptable as-is given scope.
- **Decision**: FIXED (Option A) — divert to /account when pendingError || pending

### F7 — `safeEqual` leaks secret length via early length check

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/cron/purge.ts:16
- **Detail**: `if (a.length !== b.length) return false` returns before the XOR loop, leaking the length of `"Bearer <secret>"`. Fail-safe behavior is otherwise correct (`!CRON_PURGE_SECRET` short-circuits to 401 before the compare). Low practical risk — length leak only.
- **Fix**: Acceptable as-is; if hardening, hash both sides to a fixed length before comparing.
- **Decision**: ACCEPTED — low risk (length-only leak), acceptable as-is

### F8 — Purge subrequest budget has no headroom

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/cron/purge.ts:29
- **Detail**: `BATCH=40` deletes + 1 select = 41 subrequests, under the Workers free-tier 50 cap as the comment claims, but with no slack for any incidental subrequest. Fine at current cadence.
- **Fix**: Consider `BATCH=35` for headroom, or revisit if the free-tier assumption changes.
- **Decision**: FIXED (Fix now) — BATCH 40 -> 35 for subrequest headroom

### F9 — verify-rls cleanup omits user C

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/verify-rls.mjs:263-267
- **Detail**: `cleanup()` deletes only users A and B. C is erased by the in-test purge, but if the test throws between seeding C and the purge, C leaks in the local DB. Test hygiene only.
- **Fix**: Add C to the cleanup list (hoist its declaration or track ids in an array).
- **Decision**: FIXED (Fix now) — userC hoisted to module scope + added to cleanup
