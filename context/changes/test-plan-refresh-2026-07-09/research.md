---
date: 2026-07-09T16:30:27+0000
researcher: Claude Code
git_commit: ca49403ed237261b3ea819682d029c5d3684b5b9
branch: master
repository: tswiackiewicz/10xcards
topic: "Phase 5 refresh — Risks #8 (route-protection drift), #9 (reactivation/purge race), #10 (SRS repeat-review scheduling)"
tags: [research, codebase, middleware, account-deletion, srs, test-plan-phase-5]
status: complete
last_updated: 2026-07-09
last_updated_by: Claude Code
---

# Research: Lifecycle & route-protection hardening (Phase 5 refresh)

**Date**: 2026-07-09T16:30:27+0000
**Researcher**: Claude Code
**Git Commit**: ca49403ed237261b3ea819682d029c5d3684b5b9
**Branch**: master
**Repository**: tswiackiewicz/10xcards

## Research Question

Ground the three risks opened by `/10x-test-plan --refresh` on 2026-07-09 as rollout Phase 5 ("Lifecycle & route-protection hardening"), per the "Context `/10x-research` must ground" column of the refresh brief:

- **Risk #8** — the exact matching rule `src/middleware.ts` uses (prefix vs. exact), and the full current route inventory (pages + API) needed to build an independently authored expected-protection list.
- **Risk #9** — whether the purge query and the reactivation delete are ever in the same transaction, and what determines execution order when both touch the same row.
- **Risk #10** — how repeat-review state (recall grade, prior interval) is loaded and merged into the next scheduling calculation, and whether the scheduling function is pure (unit-testable) or needs DB-persisted state (integration).

## Summary

All three risks are confirmed real, reachable failure modes — not hypothetical:

- **#8**: `middleware.ts`'s `PROTECTED_ROUTES` array is a hand-maintained **prefix match** (`startsWith`), correctly covering all six `.astro` pages today, but the array covers **only page routes** — every `/api/**` route enforces auth independently, inline, via its own `fail(401, ...)` guard, with zero relationship to `PROTECTED_ROUTES`. An oracle built only around the array would give false confidence about API auth coverage. Git history shows the array has been hand-edited 6 times (once per feature), always in lockstep so far — but with no test tying page files to the array.
- **#9**: The race is real and **asymmetric**, not a coin flip. Cancellation and purge are never in the same transaction (can't be — purge deletes via the Supabase Auth Admin API, not a table statement). Purge snapshots eligible rows in one SELECT, then serially calls `deleteUser` per row without re-checking. A cancellation landing after the SELECT but before that row's turn in the loop still gets erased. Zero existing test invokes either `delete.ts` or `reactivate.ts`.
- **#10**: `applyGrade`/`previewGrades` in `srs.ts` are pure functions — no bug found in the current fetch/merge path. But test coverage is genuinely zero for the repeat-review branch: no test grades the same card twice. The exact fragility the Phase 1 mutation-testing note flagged (`review.ts:20`'s `SRS_COLUMNS` string literal) remains undetected by any test today.

## Detailed Findings

### Risk #8 — Route-protection drift (`src/middleware.ts`)

**Matcher logic** — [src/middleware.ts:18](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/middleware.ts#L18):

```ts
const PROTECTED_ROUTES = ["/dashboard", "/generate", "/create", "/cards", "/study", "/account"];
// ...
if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
  if (!context.locals.user) return context.redirect("/auth/signin");
}
```

This is a **prefix match**, not exact/segment-aware — `/cardsxyz` or `/studying` would also match, purely by string prefix. No trailing-slash normalization, case-sensitive (`/Dashboard` would not match). `context.locals.user` ([middleware.ts:7-16](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/middleware.ts#L7-L16)) is populated for every request, protected or not; only protected+unauthenticated requests get redirected (302 to `/auth/signin`, not a 401).

**Independent route inventory** (built from `src/pages/**` file listing, not from the array):

| Page routes                           | Protected? | API routes                                | Protected by middleware?        |
| ------------------------------------- | ---------- | ----------------------------------------- | ------------------------------- |
| `/`                                   | No         | `/api/auth/{signin,signup,signout}`       | No                              |
| `/dashboard`                          | Yes        | `/api/account/{delete,reactivate}`        | No (own inline 401)             |
| `/generate`                           | Yes        | `/api/cron/purge`                         | No (bearer-secret, not session) |
| `/create`                             | Yes        | `/api/flashcards`, `/generate`, `/manual` | No (own inline 401)             |
| `/cards`                              | Yes        | `/api/flashcards/[id]`, `/[id]/review`    | No (own inline 401)             |
| `/study`                              | Yes        | `/api/flashcards/study/next`              | No (own inline 401)             |
| `/account`                            | Yes        |                                           |                                 |
| `/auth/{signin,signup,confirm-email}` | No         |                                           |                                 |

No stale entries and no missing `.astro` page — all six `PROTECTED_ROUTES` strings map to real, existing pages. **The actual gap is structural, not a drift-in-progress**: `PROTECTED_ROUTES` has zero awareness of `/api/**` by design — every flashcard/account API route calls `getUser()` and returns its own `fail(401, "unauthorized")` independently (e.g. [src/pages/api/flashcards/[id].ts:22,28,68,74](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/pages/api/flashcards/%5Bid%5D.ts)). This was already flagged as "a fact for the record" in Phase 1's research ([context/archive/2026-07-04-testing-critical-path-coverage/research.md:30,42,60,135](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/context/archive/2026-07-04-testing-critical-path-coverage/research.md)) but never turned into a test — and Phase 1's own plan explicitly scoped it out ([context/archive/2026-07-04-testing-critical-path-coverage/plan.md:40,42](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/context/archive/2026-07-04-testing-critical-path-coverage/plan.md)).

**Git churn** — 6 commits on `middleware.ts` in 30 days, every one adding exactly one `PROTECTED_ROUTES` entry in the same commit as the corresponding new `.astro` page (`7f5c053`→`/account`, `218258c`→`/study`, `14a163d`→`/cards`, `d437416`→`/create`, `31c0bfb`→`/generate`, `1da1b99`→initial `/dashboard`). Discipline has held so far, but it's manual with no compile-time or test-time enforcement.

**Implication for Phase 5 scope**: an "independently authored expected-route list" test built only from `PROTECTED_ROUTES`/`.astro` pages would say nothing about API-route auth — that's a structurally separate enforcement mechanism (inline per-handler checks) that needs its own independent oracle if it's meant to be part of Risk #8's response.

### Risk #9 — Reactivation/purge race (`account_deletions`)

**Schema** — [supabase/migrations/20260702145938_create_account_deletions.sql:17-20](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/supabase/migrations/20260702145938_create_account_deletions.sql):

```sql
create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);
```

Only two columns, no status enum, "immutable once created" (no UPDATE grant). **Presence/absence of the row is the entire state machine.**

**Mechanics**:

- Request deletion — [src/pages/api/account/delete.ts:35-37](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/pages/api/account/delete.ts#L35-L37) upserts `{user_id}` (idempotent), then signs out.
- Cancel/reactivate — [src/pages/api/account/reactivate.ts:32](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/pages/api/account/reactivate.ts#L32): a plain `.delete().eq("user_id", user.id)`, RLS-scoped.
- Purge — [src/pages/api/cron/purge.ts:50-73](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/pages/api/cron/purge.ts#L50-L73), invoked daily by [.github/workflows/purge.yml](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/.github/workflows/purge.yml) (`0 3 * * *` cron + manual dispatch): one SELECT (up to 35 rows, `requested_at < now() - 30d`, oldest first) into an in-memory array, then a serial `for` loop calling `admin.auth.admin.deleteUser(user_id)` per row — cascade FK erases `flashcards` + the `account_deletions` row.

**Is the race real?** Yes, and it's a specific, asymmetric TOCTOU gap, not a 50/50 coin flip:

- **Ordering A** (cancel's DELETE completes before purge's SELECT runs) — safe. The row is gone before purge ever sees it.
- **Ordering B** (purge's SELECT has already snapshotted the row into memory; cancel's DELETE happens afterward, before or during that row's turn in the serial `deleteUser` loop) — **not safe**. The loop never re-checks `account_deletions` before calling `deleteUser`; it acts purely on the stale in-memory snapshot. A user who successfully cancels in that window is still erased. Because the batch is up to 35 rows processed serially, this window isn't microseconds — it spans however long prior rows in the batch take to process.

No transaction can span both operations even in principle: `deleteUser` is a Supabase Auth Admin API call, not a table statement, so it can't share a DB transaction with the SELECT or with `reactivate.ts`'s DELETE.

**Existing coverage**: confirmed by grep — **no test file anywhere invokes `delete.ts` or `reactivate.ts`**. `risk4-purge-boundary.test.ts` and `risk4-purge-partial-failure-hermetic.test.ts` exercise purge in isolation (retention boundary, bearer auth, partial-batch-failure via a mocked admin client) but never interleave with cancellation. This matches the explicit Phase 3 scope-out: _"Not testing account reactivation (`src/pages/api/account/reactivate.ts`) — not part of Risk #4's failure scenario"_ ([context/archive/2026-07-07-testing-compliance-critical-flows/plan.md:28](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/context/archive/2026-07-07-testing-compliance-critical-flows/plan.md#L28)) — excluded because it was a different risk-shape not yet on the map, not because it was proven safe.

**How to test both orderings deterministically**: Ordering A is straightforward — call `reactivate.ts` for real, then `purge.ts`, assert the user is untouched and absent from the SELECT result. Ordering B requires intercepting the admin client's `deleteUser` call (mock/spy) to inject the cancellation mid-loop — the same mocking pattern `risk4-purge-partial-failure-hermetic.test.ts` already uses for the admin client.

### Risk #10 — SRS repeat-review scheduling

**Purity** — [src/lib/flashcards/srs.ts](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/lib/flashcards/srs.ts): `applyGrade(row, rating, now)` (lines 73-86) and `previewGrades(row, now)` (lines 60-67) are pure — row-in, row-out, no Supabase import, no side effects. `rowToCard` (lines 31-47) is the fork point: `row.due === null` → `createEmptyCard()`; otherwise reconstructs a `ts-fsrs` `Card` from all nine persisted columns with nullish-coalescing defaults. First-time vs. repeat review is driven entirely by `due` nullability, not an explicit flag — same function, same code path either way.

**Schema** — [supabase/migrations/20260701213238_add_srs_state.sql:14-23](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/supabase/migrations/20260701213238_add_srs_state.sql#L14-L23): nine nullable columns (`due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review`), no defaults, no backfill — lazy-init model.

**Reload path** — [src/pages/api/flashcards/[id]/review.ts:20,52-69](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/src/pages/api/flashcards/%5Bid%5D/review.ts#L20): `SRS_COLUMNS` is a hand-maintained string literal duplicating the `SrsColumns` type; fetch is RLS-scoped `.maybeSingle()` (404 if the card doesn't exist — not silently treated as fresh); `applyGrade(current, rating, new Date())` feeds the fetched row straight in; the write is a plain `.update` (the row is guaranteed to already exist — no upsert ambiguity). **No bug found in this path as it stands today.**

**The actual fragility**: `SRS_COLUMNS` at review.ts:20 is a duplicate of the type in srs.ts — nothing ties them together. The Phase 1 mutation-testing pass already proved this: a mutant that truncated `SRS_COLUMNS` to `""` **survived**, because every existing review test grades a never-studied card, so the repeat-review path (which needs the _prior_ state) never surfaces a broken select-list. Exact quote, [context/foundation/test-plan.md:278-284](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/context/foundation/test-plan.md#L278-L284):

> `review.ts:20` (`SRS_COLUMNS` truncated to `""`) — every review test in this rollout grades a never-studied card, so the repeat-review path... never surfaces this... Candidate for a `/10x-lesson` entry or a new risk-map row at the next `/10x-test-plan --refresh`.

**Existing coverage**: zero. `risk1-api-route-ownership.test.ts:113-126` and `risk3-idor-not-found-equivalence.test.ts:83-107` both grade a fresh card exactly once — nothing grades the same card twice and compares the second interval against either a fresh-card baseline or an FSRS-expected value. The original feature plan itself flagged this as a known future gap: _"None automated (no test framework in the repo by design). The `srs.ts` helper is the natural future unit-test target if a runner is later introduced"_ ([context/archive/2026-07-01-spaced-repetition-study/plan.md](https://github.com/tswiackiewicz/10xcards/blob/ca49403ed237261b3ea819682d029c5d3684b5b9/context/archive/2026-07-01-spaced-repetition-study/plan.md)) — the gap has existed since the feature was built, not introduced later.

**Layer verdict**: `applyGrade`/`previewGrades` are unit-testable directly (call `applyGrade` twice in sequence, feed the first output as the second input, assert the second `due`/`stability`/`state` differ from a fresh-card grade). Catching the `SRS_COLUMNS` regression class specifically requires a thin integration test through the real `PATCH .../review` endpoint (two sequential calls), since that fragility lives in the endpoint's select-list, not in the pure function.

## Code References

- `src/middleware.ts:4,7-16,18-22` — `PROTECTED_ROUTES` array, `locals.user` population, prefix-match redirect logic.
- `src/pages/api/account/delete.ts:35-37` — deletion-request upsert into `account_deletions`.
- `src/pages/api/account/reactivate.ts:32` — cancellation delete, no locking.
- `src/pages/api/cron/purge.ts:50-73` — SELECT-then-serial-loop purge, the structural root of the Risk #9 race.
- `supabase/migrations/20260702145938_create_account_deletions.sql:17-20` — two-column, immutable schema.
- `.github/workflows/purge.yml` — daily cron trigger, bearer-secret auth.
- `src/lib/flashcards/srs.ts:31-47,60-67,73-86` — `rowToCard` fork point, `previewGrades`, `applyGrade` (pure).
- `src/pages/api/flashcards/[id]/review.ts:20,52-69` — `SRS_COLUMNS` literal, fetch/merge/update.
- `supabase/migrations/20260701213238_add_srs_state.sql:14-23` — nine nullable SRS columns, lazy-init.
- `context/foundation/test-plan.md:278-284` — Phase 1 mutation-testing note that seeded Risk #10.
- `context/archive/2026-07-07-testing-compliance-critical-flows/plan.md:28` — Phase 3 reactivation scope-out note that seeded Risk #9.

## Architecture Insights

- **State-as-row-existence pattern**: `account_deletions` uses row presence/absence as its entire state machine (no status enum). This is simple and correct for the happy path but means any operation touching that row (cancel, purge) has no natural place to add optimistic-concurrency protection short of restructuring the schema.
- **Two independent auth-enforcement mechanisms coexist by design**: `middleware.ts`'s prefix-matched `PROTECTED_ROUTES` for `.astro` pages, and inline per-handler `fail(401, ...)` checks for every `/api/**` route. Neither is aware of the other. This split isn't a bug, but it means "route protection" as a single testable concept doesn't exist — it's two concepts that happen to share a name.
- **Lazy-init + nullish-coalescing pattern for SRS state**: rather than a first-review/repeat-review branch, `rowToCard`'s single reconstruction path handles both via `due === null` as the only fork point, with `?? default` fallbacks per field. This is a good design for correctness (one code path, less to get wrong) but paradoxically makes gaps easy to miss — a bug that silently reverts a repeat review to defaults would look identical to legitimately grading a fresh card, unless a test explicitly compares against a fresh-card baseline.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:11-32` (§1 Strategy) — three governing principles already established: cost×signal (cheapest test with real signal wins), user-stated concerns are first-class evidence, and risks describe scenarios not code locations (research grounds the "where," the plan doesn't guess).
- `context/foundation/test-plan.md:42-53,74-87` (§2 Risk Map) — rows #8/#9/#10 already carry filled-in "Risk Response Guidance" (what would prove protection, anti-pattern to avoid) from the refresh interview — this research grounds those intentions against actual code, it doesn't originate them.
- `context/archive/2026-07-04-testing-critical-path-coverage/research.md:30,42,60,135` and `plan.md:40,42` — Phase 1 already found and explicitly scoped out the `PROTECTED_ROUTES`/API-route gap underlying Risk #8.
- `context/archive/2026-07-07-testing-compliance-critical-flows/plan.md:28`, `plan-brief.md:33` — Phase 3's explicit reactivation scope-out, the direct origin of Risk #9.
- `context/archive/2026-07-01-spaced-repetition-study/plan.md` — original SRS build explicitly deferred automated testing of `srs.ts` ("no test framework in the repo by design"), the direct origin of Risk #10's coverage gap.
- Six feature plans (`2026-06-24-flashcard-store-rls`, `2026-06-25-ai-card-generation`, `2026-07-01-manual-card-authoring`, `2026-07-01-manage-saved-flashcards`, `2026-07-01-spaced-repetition-study`, `2026-07-02-account-deletion`) each show a one-line `PROTECTED_ROUTES` diff — direct evidence of the manual-edit pattern Risk #8 is worried about drifting.

## Related Research

- `context/archive/2026-07-04-testing-critical-path-coverage/research.md` — Phase 1, first flagged the middleware/API-auth split.
- `context/archive/2026-07-07-testing-compliance-critical-flows/research.md` — Phase 3, purge/RLS/reactivation mechanics.
- `context/archive/2026-07-01-spaced-repetition-study/research.md` — original ts-fsrs library selection and RLS inheritance for SRS columns.
- `context/archive/2026-07-02-account-deletion/research.md` — original purge-mechanism design (external scheduler → guarded route, chosen over pg_cron/Workers Cron Trigger).

## Open Questions

- **Risk #8 scope**: should Phase 5's response to Risk #8 include API-route auth (the inline `fail(401, ...)` checks), or stay scoped to `.astro` pages via `middleware.ts`/`PROTECTED_ROUTES` as the change.md response intent currently implies ("every route... verified against an independently authored expected list")? The two are structurally separate mechanisms; a plan that only rebuilds the `PROTECTED_ROUTES` oracle will say nothing about API auth drift.
- **Risk #9 test mechanics**: Ordering B requires mocking/intercepting the admin client's `deleteUser` call to inject a cancellation mid-batch-loop. Worth deciding at planning time whether to extend the existing `risk4-purge-partial-failure-hermetic.test.ts` mocking pattern or write a fresh harness.
- **Risk #10 test layers**: cheapest-layer principle favors a unit test on `applyGrade` alone, but that alone can't catch a future `SRS_COLUMNS` select-list regression (the exact mutation-tested survivor). Decide whether Phase 5 pairs a unit test (pure scheduling correctness) with a thin integration test (endpoint round-trip), or accepts the unit-only layer and treats the `SRS_COLUMNS` fragility as a separate follow-up.
