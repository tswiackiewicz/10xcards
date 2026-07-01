<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Spaced-Repetition Study (S-04)

- **Plan**: context/changes/spaced-repetition-study/plan.md
- **Scope**: All phases (1–3 of 3), full plan review
- **Date**: 2026-07-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated success criteria all verified green this session: `astro sync` ✓, `lint` ✓, `build` ✓ (ts-fsrs bundles with no `nodejs_compat` error), and `scripts/verify-rls.mjs` ✓ — 14/14 assertions pass, including the new SRS-column isolation (user B cannot read or overwrite user A's `due`/`state`). Plan drift audit: 12/12 planned items MATCH, no MISSING, no genuine scope creep. One unplanned file, `src/lib/flashcards/study.ts`, is a benign shared `getNextCard` query helper imported by both the endpoint and the page — it removes the duplication the plan's "same query shape" language would otherwise have created (an improvement, not creep). Response bodies carry extra fields vs the literal plan (`next.ts` returns `{card, previews}`, `review.ts` returns `{due}`) — both serve planned requirements (interval labels; returning the new due date). Not drift.

## Findings

### F1 — Grade buttons lack an in-flight guard (double-grade race)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/flashcards/StudyView.tsx:67-89, 143-159
- **Detail**: `grade()` guards only `if (!card) return` (line 68); there is no `status === "loading"` guard, and the four grade buttons carry a `disabled:opacity-50` class (line 153) but are never passed a `disabled` prop — dead styling that signals the intended guard was dropped. The loading spinner unmounts the buttons on re-render, which absorbs most double-clicks, but two click events in the same tick before commit both fire `PATCH .../review` on the same card. FSRS grading is not idempotent (`applyGrade` advances reps/state from the freshly-read row), so a second grade would re-advance already-advanced state.
- **Fix**: Add `if (status === "loading") return;` at the top of `grade()`, or pass `disabled={status === "loading"}` to the buttons (matches the `disabled` idiom in SavedCardsView).
- **Decision**: FIXED — added `status === "loading"` guard to `grade()` (StudyView.tsx:68). The disabled-prop alternative was tried but is unreachable: TS narrows `status` to `"ready"` in that branch since the earlier `status === "loading"` check already swaps the whole view to a spinner, unmounting the buttons. Lint confirmed (`no-unnecessary-condition`). The function guard alone closes the race.

### F2 — StudyView inlines fetch instead of reusing the `requestJson` helper

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/flashcards/StudyView.tsx:44-45, 72-79
- **Detail**: The sibling island `SavedCardsView.tsx:28-32` centralizes fetch+parse in a `requestJson` helper returning `{ ok, error }`. `StudyView` instead inlines `fetch` + `res.json().catch(() => ({}))` twice. It reuses the `data.error ?? "save_failed"` shape but not the helper. `loadNext` needs the parsed payload (so the helper's current signature wouldn't fit it), which partly explains the divergence — but `grade`'s PATCH only needs `{ ok, error }` and could route through the helper.
- **Fix**: Route `grade()`'s PATCH through the `requestJson` helper to match the sibling island; leave `loadNext` inline (or generalize the helper to return the parsed body).
- **Decision**: FIXED — added a local `requestJson` helper to StudyView.tsx (identical shape to SavedCardsView's), routed `grade()`'s PATCH through it. Also switched the "card deleted elsewhere" check from raw `res.status !== 404` to `error !== "not_found"`, matching `SavedCardsView.handleSave`'s exact convention. `loadNext` left inline as the finding anticipated (needs the full parsed payload). Lint + build clean.

### F3 — Non-atomic read-then-write in the review endpoint

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/[id]/review.ts:53-69
- **Detail**: The grade is a non-atomic read (`maybeSingle`) then update. Two concurrent PATCHes on the same card can both read the same pre-grade state and both write (last-writer-wins), losing one grade's progression. Low-risk for a single-user study loop and mitigated by fixing F1; a full fix needs an atomic RPC / optimistic-concurrency check — overkill for MVP.
- **Fix**: Accept for the single-user MVP; note as follow-up if concurrent grading ever becomes possible.
- **Decision**: SKIPPED — accepted risk for the single-user MVP; already partially mitigated by F1's guard.

### F4 — PostgREST `.or()` filter built via string interpolation

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/flashcards/study.ts:17
- **Detail**: The filter string `` `due.is.null,due.lte.${now.toISOString()}` `` is the one place PostgREST filter-string interpolation happens. Not a vulnerability today: `now` is a server-side `new Date()` (never user-controlled) and `toISOString()` emits a fixed format with no PostgREST metacharacters. It would become an injection vector only if a caller ever passes a client-supplied timestamp into `getNextCard`.
- **Fix**: Add a comment that `now` must stay server-generated; never pass a client-supplied timestamp into `getNextCard`.
- **Decision**: FIXED — added a comment above the `.or()` call in `getNextCard` (study.ts:17) noting `now` must stay server-generated. Lint clean.

### F5 — Read-path error surfaced as `save_failed`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/flashcards/study/next.ts:32-33
- **Detail**: A DB error on the next-card read is surfaced as `fail(500, "save_failed")`. `save_failed` is a slightly odd code for a read path, but it is an existing `ApiErrorCode` member and is mapped in the island's error copy, so the UX is correct. Purely a semantic mismatch.
- **Fix**: Acceptable as-is; optionally add a read-specific error code if the enum grows.
- **Decision**: SKIPPED — acceptable as-is, no functional issue.
