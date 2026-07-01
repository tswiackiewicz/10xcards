<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manage Saved Flashcards (S-03)

- **Plan**: context/changes/manage-saved-flashcards/plan.md
- **Scope**: All 3 phases (of 3)
- **Date**: 2026-07-01
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Load-bearing points — confirmed correct

- **Auth**: PATCH + DELETE both return 401 without a verified session (`[id].ts:20-29,66-75`); ownership is RLS-only (`auth.uid()=user_id`); `user_id` never read from body/params.
- **0-row → 404** (the plan's key correctness point): both handlers `.select("id")` the affected rows and return `404 not_found` on `length === 0` (`[id].ts:50-60,84-90`). No phantom-success path.
- **Injection**: `id` validated with `z.uuid()` before `.eq()` (`[id].ts:17,31,77`); Supabase parameterizes `.eq()`.
- **SSR list**: `cards.astro` relies on `flashcards_select_own` RLS — no cross-user leak.
- **Delete gated**: `handleDelete` only fires from the `AlertDialogAction` onClick (`SavedCardsView.tsx:192-209`).
- **Client guard**: `canSave` mirrors ManualCardForm's `trim().length` comparison (S-01 impl-review lesson) (`SavedCardsView.tsx:60-64`).
- **Scope**: exactly the 7 planned files changed; `index.ts`/`manual.ts`/`generate.ts`/`GenerateView.tsx`/`ManualCardForm.tsx` untouched; no migration, pagination, soft-delete, batch, SRS, toast, or client GET list endpoint added.
- **React**: `key={card.id}` stable; one-row-at-a-time edit invariant holds (`editingId` ternary → row is editor XOR view, no concurrent edit+delete race); `CardEditor` re-seeds per edit; no dead imports.

## Findings

### F1 — Inlined fetch vs. ManualCardForm's postJson helper

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/flashcards/SavedCardsView.tsx:76, 162
- **Detail**: ManualCardForm centralizes fetch in a typed `postJson()` helper; SavedCardsView inlines `fetch` twice (PATCH, DELETE) with an inline `{ error?: ApiErrorCode }` cast. Functionally equivalent and arguably clearer given the two calls differ in method/body.
- **Fix**: Leave as-is; extract a shared `requestJson(url, init)` only if a third caller appears.
- **Decision**: FIXED — extracted `requestJson(url, init)` helper; both PATCH + DELETE routed through it. Verified lint + build.

### F2 — Row not auto-removed on a 404 (not_found) response

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (UX)
- **Location**: src/components/flashcards/SavedCardsView.tsx:157-173
- **Detail**: If edit/delete returns 404 (card already gone / RLS-hidden), the row stays in the deck until the user manually refreshes. Matches the shown copy ("This card no longer exists. Refresh the page.") — acceptable for MVP.
- **Fix**: Optional follow-up — on a 404, drop the row from local state instead of only showing the message.
- **Decision**: FIXED — on a 404 not_found, edit (`onGone`) and delete (`onDeleted`) both remove the stale row so the list self-heals. Verified sync + lint + build.
