---
date: 2026-07-04T00:00:00+02:00
researcher: Claude
git_commit: e5aa72f0f06441c95e27175762cead418af2aee6
branch: master
repository: tswiackiewicz/10xcards
topic: "Critical-path coverage: grounding Risk #1 (flashcard ownership/no-loss) and Risk #2 (AI review human-gating) for test bootstrap"
tags: [research, codebase, testing, rls, flashcards, ai-review, vitest]
status: complete
last_updated: 2026-07-04
last_updated_by: Claude
---

# Research: Critical-path coverage — Risk #1 & Risk #2 grounding

**Date**: 2026-07-04T00:00:00+02:00
**Researcher**: Claude
**Git Commit**: e5aa72f0f06441c95e27175762cead418af2aee6
**Branch**: master
**Repository**: tswiackiewicz/10xcards

## Research Question

For rollout Phase 1 ("Critical-path coverage") of `context/foundation/test-plan.md`, ground only **Risk #1** ("A user's saved flashcards silently disappear, or become visible/editable by a different account") and **Risk #2** ("A rejected or un-actioned AI candidate is silently saved to the deck, or an explicitly accepted one is lost, in the review flow"). Per §1 principle #3 of the test plan, this research is the ground truth for _where_ these risks actually live in the code — the plan only asserted _why_ they're likely.

## Summary

- **Risk #1 has an existing, un-automated oracle**: [`scripts/verify-rls.mjs`](https://github.com/tswiackiewicz/10xcards/blob/e5aa72f/scripts/verify-rls.mjs) is a 277-line hand-run Node script (no test framework) that already proves cross-user isolation, anon-read denial, SRS-column isolation, pending-deletion blocking, and purge-cascade correctness, using two real anon-key+JWT sessions and a service-role client for seed/cleanup only. This script **is** the F-01 launch-gate oracle from the archived `flashcard-store-rls` change and is the correct backbone to port into a Vitest integration test — not a script to write from scratch.
- Every flashcard-mutating route relies **purely on RLS** for ownership scoping (no `.eq("user_id", ...)` anywhere in application code) — see [Detailed Findings §1](#1-risk-1--flashcard-ownershipaccess-control). This makes the RLS policy chain the single point of truth, and is exactly what integration tests (real DB, real RLS) must exercise, per the plan's cost×signal guidance — a mocked Supabase client would lie about this by construction.
- **A live PROTECTED_ROUTES gap exists**: `src/middleware.ts:4`'s prefix list does not cover any `/api/...` path, so none of the flashcard API routes are gated by middleware — each independently calls `supabase.auth.getUser()`. This is a fact for the record, not itself Risk #1 or #2's target (both risks are about data isolation/loss, not missing 401s), but it means a test asserting "unauthenticated request → 401" must hit each route directly, since middleware provides no blanket guarantee for the API surface.
- **Risk #2 has zero automated coverage today** — human-gating (reject/pending never reaches the server) is enforced **exclusively client-side** by an array `.filter()` in `GenerateView.tsx:87` before the POST is constructed. The save endpoint (`src/pages/api/flashcards/index.ts`) has no concept of accept/reject status at all — it will happily insert whatever well-formed `{question, answer}` array it's given. This matches the Risk Response Guidance's "must challenge" column exactly: proving human-gating requires an integration test on the _server_ contract, not a client-side unit test of the button state.
- **No test runner exists** (`vitest`, `msw`, `@testing-library/react` are absent from `package.json`/`package-lock.json`). Phase 1 must bootstrap the stack from zero: Vitest config aligned to `tsconfig.json`'s `@/*` alias and `astro/tsconfigs/strict`, a CI step inserted after `npm run lint` (`.github/workflows/ci.yml:20`), and — critically — CI currently never runs `supabase start`, only `supabase db push --dry-run` against the _remote_ linked project. A local-Supabase CI step is net-new work, not a config tweak.

## Detailed Findings

### 1. Risk #1 — flashcard ownership/access-control

**Client & auth pattern**

- `src/lib/supabase.ts:6-25` — `createClient(requestHeaders, cookies)` is the cookie/session-bound SSR client (anon key, `@supabase/ssr`), used by every flashcard route.
- `src/lib/supabase-admin.ts:11-18` — `createAdminClient()` uses the service-role key, RLS-bypassing by design; its only consumer is the Bearer-secret-gated cron purge route (`src/pages/api/cron/purge.ts:3,45`), which never touches the `flashcards` table directly.
- Every flashcard route calls `supabase.auth.getUser()` itself (e.g. `src/pages/api/flashcards/index.ts:21-26`, `[id].ts:24-29`/`70-75`, `[id]/review.ts:29-34`, `manual.ts:21-26`, `study/next.ts:24-29`); **none** read `context.locals.user` set by `src/middleware.ts:13`.

**Routes and their ownership scoping**

| Route                                               | Method | Ownership filter beyond RLS                                             |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `src/pages/api/flashcards/index.ts:16-55`           | POST   | Sets `user_id: user.id` on insert (line 46); RLS pins the rest          |
| `src/pages/api/flashcards/[id].ts:19-63`            | PATCH  | `.eq("id", id.data)` only (line 53) — **no `user_id` filter**, RLS-only |
| `src/pages/api/flashcards/[id].ts:65-93`            | DELETE | `.eq("id", id.data)` only (line 84) — **no `user_id` filter**, RLS-only |
| `src/pages/api/flashcards/[id]/review.ts:24-77`     | PATCH  | Read + write both `.eq("id", id.data)` only (lines 56, 69) — RLS-only   |
| `src/pages/api/flashcards/manual.ts:16-53`          | POST   | Sets `user_id: user.id` on insert (line 46); RLS pins the rest          |
| `src/pages/api/flashcards/study/next.ts:19-36`      | GET    | Delegates to `getNextCard` (below) — RLS-only                           |
| `src/lib/flashcards/study.ts:13-27` (`getNextCard`) | —      | `select("*")` with **no `.eq("user_id", ...)`** at all — RLS-only       |

There is **no `GET /api/flashcards/[id]`** endpoint. There is no `GET` list endpoint under `/api` either — the list view is a page-level SSR read: `src/pages/cards.astro:7-14` (`select("*").order("created_at", ...)`, no explicit filter, relies on RLS + middleware page-gating).

**Middleware coverage gap**

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/generate", "/create", "/cards", "/study", "/account"]`. This covers the `.astro` pages but **not** their `/api/...` counterparts (`/api/flashcards/generate`, `/api/account/delete`, etc. don't start with any listed prefix). Every flashcard API route therefore relies solely on its own inline `getUser()` call for auth, and solely on RLS for ownership — there is no middleware-level backstop for the API surface.

**Effective RLS policy chain** (current, from migrations, newest wins):

- `supabase/migrations/20260624185919_create_flashcards.sql:52-75` — baseline: SELECT/UPDATE/DELETE `using (auth.uid() = user_id)`, INSERT `with check (auth.uid() = user_id)`; grants restricted to `authenticated` role only (line 46, no `anon` grant).
- `supabase/migrations/20260702145938_create_account_deletions.sql:83-106` — redefines all four policies to additionally require `not is_pending_deletion(auth.uid())`.
- `supabase/migrations/20260702154817_optimize_pending_deletion_rls.sql:15-38` — same predicates, wrapped in a scalar subselect for planner performance; behaviorally identical.
- **Effective predicate today**: every SELECT/INSERT/UPDATE/DELETE on `flashcards` requires `auth.uid() = user_id AND NOT is_pending_deletion(auth.uid())`.

**Existing oracle: `scripts/verify-rls.mjs`**

A 277-line manual verification script (not wired into any test runner or CI) already exercises this exact risk end-to-end using two real signed-in users (`asA`, `asB`) plus a signed-out anon client, with a service-role client reserved strictly for seed/cleanup:

- Cross-user SELECT/UPDATE/DELETE all assert **0 rows affected**, not an error (lines 91-109) — matches the archived plan's documented gotcha that RLS-hidden rows return empty results, not permission errors.
- INSERT-as-other-user is asserted to **error** (WITH CHECK, lines 112-116).
- Signed-out anon client reads **zero rows** (lines 118-124).
- SRS columns (added later) inherit the same isolation — re-verified explicitly rather than assumed (lines 131-170).
- Pending-deletion blocking — a user pending deletion can neither read nor mutate their own cards (lines 172-204), and regains access on reactivation (lines 206-214).
- Hard-delete purge cascade — after purge, the `flashcards` row is gone via `ON DELETE CASCADE` from `auth.users`, proven by absence of the auth user rather than a row-count check (lines 216-258), plus idempotency of a second purge run (lines 253-258).

This script is the direct precedent for what a Vitest integration test for Risk #1 must assert — it is grounded in the archived `flashcard-store-rls` plan's explicit rule: **"verification must use the anon key + a real user JWT, never the service-role key... a test run with it would falsely pass."**

### 2. Risk #2 — AI review flow (accept/reject/edit, save contract)

**Generation → candidate shape**

- `src/pages/api/flashcards/generate.ts:69` returns `{ candidates }`, validated by `candidateSchema` (`src/lib/flashcards/schemas.ts:18-21`) — **only** `question`/`answer`, no id, no status, no provenance.
- The client assigns a local-only id: `src/components/flashcards/GenerateView.tsx:73` (`id: crypto.randomUUID()`), mapped into `ReviewCard` (`src/components/flashcards/CandidateCard.tsx:4-9`, `status: "pending" | "accepted" | "rejected"`).

**Reject/accept/edit are pure client state**

- `rejectCard`/`rejectAll` (`GenerateView.tsx:115-123`) — local `setState` only, **no network call**. A rejected candidate is never sent to the server in any form.
- `editCard` (`GenerateView.tsx:109-111`) mutates `question`/`answer` in place; does not change `status` and does not set any "edited" flag — none exists in the `ReviewCard` type.
- `acceptCard`/`acceptAll` (`GenerateView.tsx:112-114`, `118-120`) — local `setState` only.

**Save request construction (the load-bearing line)**

- `GenerateView.tsx:86-94`:
  ```ts
  const accepted = cards.filter((c) => c.status === "accepted");
  if (accepted.length === 0) return;
  ...
  cards: accepted.map(({ question, answer }) => ({ question, answer })),
  ```
  Only `{question, answer}` is transmitted — no id, no status. **Accept-then-save and edit-then-accept-then-save produce an identical wire payload.** There is no way, server-side, to distinguish "verbatim AI output" from "user-edited AI output" — both are stored as `source: 'ai'` rows with whatever text was present at save time (`src/pages/api/flashcards/index.ts:42-49`; table columns confirmed in `supabase/migrations/20260624185919_create_flashcards.sql:11-19` — no `edited`/provenance column exists).

**Server-side enforcement — none for the accept/reject rule**

- `saveRequestSchema` (`src/lib/flashcards/schemas.ts:24-26`) validates only that `cards` is an array of 1–15 well-formed `{question, answer}` objects (`MAX_CARDS = 15`). It has **no status/decision field** and cannot reject a payload for containing something that "should have been" rejected client-side, because the server never receives the rejected/pending candidates or their prior status at all.
- The human-gating guarantee — "no candidate becomes a persisted flashcard unless explicitly accepted" — is enforced **exclusively** by the client-side filter at `GenerateView.tsx:87`. This is precisely the Risk Response Guidance's named anti-pattern: _"the UI only shows an accept button for accepted cards" is not proof — the server must independently enforce this, not just the client._ Today, it does not; the server's actual contract is "insert whatever well-formed cards you're sent."

**Design precedent (from archived `ai-card-generation` plan)**

- `plan.md:44-48` — "Rejected ones leave no trace" was the explicit intended design, verified only manually (`plan.md:360-363`, Progress item 4.8) — never automated.
- `plan.md:108-109` — pasted source text itself is request-scoped and never persisted/logged (GDPR-relevant, but confirms rejected candidates leave zero DB or log trace by design, not just by the current filter).
- `manual-card-authoring` deliberately uses a **separate** save endpoint (`/api/flashcards/manual`, `source: 'manual'`) specifically to avoid any risk of a manually-authored card being mislabeled as AI-accepted — this is a design signal that `source` is meant to be a trustworthy provenance field, even though nothing currently prevents a malformed/malicious client from POSTing arbitrary `{question, answer}` pairs to the AI-labeled save endpoint.

### 3. Test infrastructure — current state (Phase 1 bootstrap surface)

- **No test tooling installed**: `vitest`, `msw`, `@testing-library/react` absent from `package.json` and `package-lock.json` (0 matches). No `test` script exists (`package.json:5-13`).
- **Aliases/strictness to mirror**: `tsconfig.json:8-12` — `@/*` → `./src/*`; extends `astro/tsconfigs/strict` (`tsconfig.json:2`). A Vitest config needs the same alias resolution (Vite's `resolve.alias`, since `astro.config.mjs`'s `vite` block currently only registers the Tailwind plugin, `astro.config.mjs:16-18`).
- **Env vars for integration tests**: `astro.config.mjs:20-27` declares `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_PURGE_SECRET` as server-only secrets, all `optional: true`. `scripts/verify-rls.mjs:16-18` expects `SUPABASE_URL`, `SUPABASE_ANON_KEY` (note: different name than the app's `SUPABASE_KEY`), `SUPABASE_SERVICE_ROLE_KEY` — an integration-test harness will need to reconcile this naming difference or source values via `npx supabase status -o env` directly, per the script's own header comment (line 9).
- **Local Supabase**: `supabase/config.toml` — API port 54321, DB port 54322, project id `10x-astro-starter`. `supabase start` is the standard local bring-up; confirmed nowhere in current CI.
- **CI gap**: `.github/workflows/ci.yml` runs checkout → `npm ci` → `npx astro sync` → `npm run lint` → `npm run build` → `supabase link` + `supabase db push --dry-run` (remote, dry-run only). **No `supabase start` step and no test step exist.** A test step logically inserts after `npm run lint` (line 20); a local-Supabase-for-integration-tests step is net-new, not a tweak to the existing Supabase step (which only talks to the remote linked project).
- **ESLint**: no test-file glob overrides exist yet (`eslint.config.js`, full file) — a Vitest config/test files will need either `parserOptions.projectService` coverage or an explicit ignore, since `tseslint.configs.strictTypeChecked` type-checks by project service today.

## Code References

- `src/lib/supabase.ts:6-25` — session-bound SSR client factory
- `src/lib/supabase-admin.ts:11-18` — service-role client factory (RLS-bypassing, cron-only)
- `src/pages/api/flashcards/index.ts:16-55` — POST save endpoint (batch insert, human-gating boundary)
- `src/pages/api/flashcards/[id].ts:19-93` — PATCH/DELETE by id, RLS-only ownership scoping
- `src/pages/api/flashcards/[id]/review.ts:24-77` — SRS review PATCH, RLS-only
- `src/lib/flashcards/study.ts:13-27` — `getNextCard`, RLS-only, no explicit user filter
- `src/lib/flashcards/schemas.ts:13-26` — `generateRequestSchema`, `candidateSchema`, `saveRequestSchema`
- `src/middleware.ts:4,18-22` — `PROTECTED_ROUTES` (pages only, no `/api/...` coverage)
- `src/components/flashcards/GenerateView.tsx:73,86-123` — client-only accept/reject/edit state and save-payload construction
- `src/components/flashcards/CandidateCard.tsx:4-9` — `ReviewCard` type (`status`, no edited flag)
- `supabase/migrations/20260624185919_create_flashcards.sql:52-75` — baseline RLS policies
- `supabase/migrations/20260702145938_create_account_deletions.sql:83-106` — pending-deletion-aware RLS
- `supabase/migrations/20260702154817_optimize_pending_deletion_rls.sql:15-38` — current effective policies
- `scripts/verify-rls.mjs` (full file) — existing manual Risk #1 oracle, un-automated
- `.github/workflows/ci.yml:10-33` — current CI job, no test/local-Supabase step
- `package.json:5-59` — no test tooling installed
- `tsconfig.json:8-12` — `@/*` alias to mirror in Vitest config

## Architecture Insights

- **Ownership enforcement is single-layered by design**: no route anywhere duplicates an app-level `user_id` filter — the team has consistently delegated 100% of ownership scoping to RLS (confirmed across index/[id]/[id]/review/study routes and `getNextCard`). This is consistent with the archived plan's explicit stance but means an integration test is the _only_ layer that can catch an RLS regression — a unit test with a mocked client would trivially "pass" against a broken policy, since the mock doesn't know about `auth.uid()`.
- **0-row-affected is the recurring "quiet failure" shape for Risk #1**: PATCH/DELETE-by-id routes return success with an empty result when RLS hides a foreign row, rather than a 403/404 — the archived `manage-saved-flashcards` plan (`plan.md:89-93`) treats this as the critical implementation detail requiring `.select()` + explicit 404-on-empty handling. Tests for Risk #1 must assert on this shape (0 rows / 404), not merely "no error thrown."
- **Risk #2's human-gating is a single client-side filter with no server mirror** — this is the one point in the whole flow where the "don't trust the client" principle (applied everywhere for Risk #1's `user_id`) is not applied. The save endpoint's implicit contract is "trust the array you're given." This is a legitimate finding for `/10x-plan` to weigh: an integration test proving _current_ behavior (reject/pending never reach the server) is still valid and valuable, but it tests a client-only guarantee — it cannot prove server-side enforcement, because none exists to test.
- **Naming drift**: the app's own env var is `SUPABASE_KEY` (`astro.config.mjs:22`) while the existing verification script expects `SUPABASE_ANON_KEY` (`scripts/verify-rls.mjs:17`) — both are the same anon key under different names. Test-harness env wiring needs to reconcile this, not treat it as two different secrets.

## Historical Context (from prior changes)

- `context/archive/2026-06-24-flashcard-store-rls/plan.md` — RLS verification methodology: real anon+JWT sessions only, never service-role, for isolation assertions; `USING`+`WITH CHECK` both required on UPDATE; GRANT-vs-RLS are separate failure modes (a missing GRANT reads as "permission denied for table," not an RLS failure).
- `context/archive/2026-06-24-flashcard-store-rls/reviews/plan-review.md` — F1: the script initially missed the signed-out-anon case, fixed by adding it (now `verify-rls.mjs:118-124`). F2: RLS ≠ table GRANTs gotcha, fixed by adding explicit grants.
- `context/archive/2026-06-25-ai-card-generation/plan.md:44-48,108-109` — original design intent: "rejected ones leave no trace"; source text is request-scoped and never persisted. Verified only manually (Progress 4.8), never automated.
- `context/archive/2026-06-25-ai-card-generation/reviews/impl-review.md` — F1 (fixed): OpenRouter fetch had no timeout, could strand a user's in-progress accept/reject state on a hung request; F4 (fixed): trimmed-vs-untrimmed length mismatch between client counter and server cap, later became a cited pattern in downstream slices.
- `context/archive/2026-07-01-manage-saved-flashcards/plan.md:89-93` — "0-row mutations are 'not found', not success" — the recurring Risk #1 quiet-failure shape, and the fix pattern (`.select()` + 404-on-empty).
- `context/archive/2026-07-01-manual-card-authoring/plan-brief.md:33-34` — separate save endpoint for manual cards specifically to keep AI-acceptance-rate metrics accurate and avoid mislabeling — a design signal that `source` provenance matters, relevant to Risk #2's data-shape.
- `context/archive/2026-07-01-spaced-repetition-study/plan.md:134-143` — the team re-extended `verify-rls.mjs` for new SRS columns rather than assuming table-level RLS coverage carries over automatically — same "verify, don't assume" discipline this rollout should continue.
- `context/archive/2026-07-01-spaced-repetition-study/reviews/impl-review.md` F3 (accepted, not fixed) — non-atomic read-then-write race in the review endpoint (two concurrent PATCHes can lose a grade). Out of scope for Risk #1/#2 as scoped here, but worth flagging to `/10x-plan` as a known, deliberately-accepted gap in case it resurfaces as a boundary case.
- Consistent testing-posture statement across all five archived changes: "no test framework... manual/curl verification only," with `scripts/verify-rls.mjs` explicitly named as "the integration test" for Risk #1 (`flashcard-store-rls/plan.md:302-306`).

## Related Research

None yet — this is the first research artifact for this change.

## Open Questions

1. **Should Phase 1 port `scripts/verify-rls.mjs` into Vitest, or write new integration tests and retire the script?** The script already covers Risk #1 exhaustively including SRS columns and purge cascade (arguably beyond this rollout phase's scope, which is #1 and #2 only). `/10x-plan` should decide whether to migrate it wholesale (fastest, proven) or extract only the F-01 core assertions (lines 69-129) and leave the SRS/purge sections (lines 131-258) as out-of-scope for Phase 1 since those map to risks #4/#5, not #1/#2.
2. **Does Risk #2 need a server-side enforcement fix, or only a test proving current client-only behavior?** The research surfaced that the save endpoint has no way to independently verify "this card was accepted." Test-plan §1 principle #3 says research is ground truth on _where_ the risk lives, not what to fix — this is flagged for `/10x-plan` to decide whether the phase is test-only (prove current behavior, including its client-only-enforcement caveat) or whether it should recommend a follow-up hardening change.
3. **`SUPABASE_KEY` vs `SUPABASE_ANON_KEY` naming** — confirm with the team/tech-stack docs whether integration test env wiring should introduce a second env var name or alias the existing one, to avoid the test harness silently reading an unset variable.
