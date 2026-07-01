<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manual Card Authoring

- **Plan**: context/changes/manual-card-authoring/plan.md
- **Scope**: Full plan (Phases 1–2 of 2)
- **Date**: 2026-07-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

Automated success criteria re-verified during review: `npx astro sync` ✅ (exit 0), `npm run lint` ✅ (exit 0), `npm run build` ✅ (exit 0). All 13 Progress checkboxes complete (Phase 1 verified via curl + RLS-scoped DB read; Phase 2 verified via HTTP + Playwright browser).

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Client sends untrimmed text; relies on server-side trim

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/flashcards/ManualCardForm.tsx:51
- **Detail**: `canSave` and the char counters use `trim().length` (correctly following the S-01 impl-review F4 lesson), but the POST body sends the raw untrimmed `{ question, answer }`. The server's `candidateSchema` uses `z.string().trim().min(1).max(...)`, so Zod trims before validating and the stored value is the trimmed output — no data issue. Identical to how `GenerateView` sends edited candidate text.
- **Fix**: None needed. Optional: send `{ question: question.trim(), answer: answer.trim() }` to make client/server identical, but the server transform already guarantees trimmed storage.
- **Decision**: ACCEPTED — consistent with sibling; no defect.

### F2 — ERROR_COPY is a Partial map (3 codes) vs sibling's full map

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/flashcards/ManualCardForm.tsx:7
- **Detail**: Uses `Partial<Record<ApiErrorCode, string>>` with only the 3 codes this endpoint emits (`invalid_input`, `unauthorized`, `save_failed`) vs `GenerateView`'s full `Record`. This is correct scoping — the endpoint never returns AI-specific codes. Theoretical edge: an unmapped code would render a blank error box, but `manual.ts` only emits those 3 (plus 401 `unauthorized`).
- **Fix**: None needed. The Partial type is the correct, honest scoping for this endpoint's error surface.
- **Decision**: ACCEPTED — correct scoping; no defect.

## Notes

Two independent review agents (plan-drift + safety/quality/pattern) both returned clean. Drift: 6/6 planned files MATCH, no MISSING/EXTRA, no scope creep — the AI generate/save path (`index.ts`, `GenerateView.tsx`, `generate.astro`, AI schemas) is untouched, single-card insert only, no migration. Safety: three defense-in-depth layers on `user_id` (session-derived, Zod strips body, RLS `with check auth.uid() = user_id`), no injection/XSS surface (React text nodes), all external boundaries error-handled, single round-trip insert; `source:'manual'` and length caps (1000/2000) align with the F-01 DB CHECK constraints. Two aligned-with-intent judgment calls: the plan's "over-length hint" ERROR_COPY entry was implemented as guard behavior (disabled button + red counter) rather than a distinct string; the two dashboard links were wrapped in a `flex flex-wrap justify-center gap-3` container to seat the second link.
