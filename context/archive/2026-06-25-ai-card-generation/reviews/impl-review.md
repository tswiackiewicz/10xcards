<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: AI Flashcard Generation & Accept/Edit/Reject Review

- **Plan**: context/changes/ai-card-generation/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated success criteria re-verified during review: `npx astro sync` ✅, `npm run lint` ✅ (warnings only), `npm run build` ✅, `npm ls zod` ✅. All 26 manual checkboxes marked complete in the plan's Progress section.

## Findings

### F1 — OpenRouter fetch has no timeout / abort

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/flashcards/generation.ts:70
- **Detail**: The single `fetch()` to OpenRouter has no `AbortSignal`/timeout. On a hung upstream the call blocks until Cloudflare's wall-clock limit kills the Worker — the user never gets the controlled `ai_unavailable` path, just a dead request. The plan acknowledged "Workers do not meter the OpenRouter wait, so latency surfaces only as UI progress," but that assumes the call eventually returns. This is the product's core wedge, so a stuck call is the worst place to lack a bound.
- **Fix**: Add `signal: AbortSignal.timeout(20000)` (or similar) to the fetch options and treat the resulting AbortError in the existing catch as a `GenerationError` → maps to the 502 `ai_unavailable` branch already present in generate.ts:58-62. No new error code needed.
  - Strength: Reuses the existing GenerationError→ai_unavailable mapping; small, contained edit.
  - Tradeoff: Choosing the timeout value — too low cuts off slow-but-valid generations; 15–30s is the usual band.
  - Confidence: HIGH — `AbortSignal.timeout` is supported on workerd.
  - Blind spot: Exact upstream p99 latency for the chosen model not measured.
- **Decision**: FIXED — added `signal: AbortSignal.timeout(20000)` to the fetch (generation.ts:84)

### F2 — Save sets user_id explicitly; plan said to omit it

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/flashcards/index.ts:46
- **Detail**: The plan's Phase 3 contract said "OMIT user_id (RLS/auth.uid() sets it)". The implementation instead sets `user_id: user.id` from the verified session. This is the implementation being correct and the plan being wrong: `database.types.ts` types `user_id: string` as REQUIRED on Insert (no `?`), so omitting it would be a TS error, and the F-01 table has no `auth.uid()` column default. The value comes from `getUser()` (not the request body) and RLS still pins it, so the security intent ("never trust user_id from the body") holds.
- **Fix**: No code change. Note the plan's "omit user_id" instruction was incorrect for this schema — keep the explicit session-derived assignment.
- **Decision**: ACCEPTED — implementation correct, plan was wrong; no code change.

### F3 — insert().select() round-trips full rows just for a count

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/index.ts:49
- **Detail**: `.insert(rows).select()` fetches every inserted row back only to read `data.length`. Negligible at the ≤15-card cap, but it returns data the endpoint never uses.
- **Fix**: Use `.insert(rows, { count: "exact" }).select("id")` (or rely on `count`) to avoid returning full row bodies. Optional.
- **Decision**: FIXED — dropped `.select()` entirely; return `rows.length` on success (no round-trip).

### F4 — Client char counter counts untrimmed length

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/flashcards/GenerateView.tsx:42
- **Detail**: `overLimit` compares `text.length` to `MAX_INPUT_CHARS`, but the server enforces the cap on `text.trim()` (`z.string().trim().max()`). Trailing whitespace can make the UI show "over limit" while the server would accept it. Cosmetic — both still reject correctly at the true boundary.
- **Fix**: Compare `text.trim().length` to mirror the server. Optional.
- **Decision**: FIXED — `overLimit` and the visible counter now both use `text.trim().length` (GenerateView.tsx:42,120).

## Notes

Clean, disciplined implementation. The single-fetch / single-insert budget contract, server-derived `user_id`, no source-text persistence, defensive output parsing with per-card Zod validation, and React-text-node rendering (no XSS surface) are all correct. Only F1 is worth acting on before this carries real production traffic; F2–F4 are observations.

Dropped during review (verified non-issues): a concern that the schemas.ts "mirror the table CHECK constraints" comment was aspirational — the F-01 migration (`supabase/migrations/20260624185919_create_flashcards.sql:14-15`) does define `check (char_length(...) between ...)` for both columns; CHECK constraints simply never surface in supabase-generated TS types. Also dropped: `generate.astro` not reading `Astro.locals.user` — harmless, middleware already guards `/generate`.
