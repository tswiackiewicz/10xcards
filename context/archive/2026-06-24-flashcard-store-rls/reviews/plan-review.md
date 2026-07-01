<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Per-user Flashcard Store with RLS Isolation

- **Plan**: context/changes/flashcard-store-rls/plan.md
- **Mode**: Deep
- **Date**: 2026-06-24
- **Verdict**: SOUND
- **Findings**: 0 critical 1 warning 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | PASS    |

## Grounding

5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓. Progress↔Phase well-formed (4 phases, all Success Criteria mapped, no checkboxes outside Progress). No `lessons.md` / `contract-surfaces.md` present (skipped).

## Findings

### F1 — Verification omits the unauthenticated-access case

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — verify-rls.mjs steps
- **Detail**: PRD Access Control forbids unauthenticated access to flashcard data, but the script proved only user-B-vs-user-A isolation, never that a signed-out anon-role client reads zero cards. Default-deny (RLS on, policies `to authenticated` only) almost certainly holds, but the roadmap's premise is "verified, not assumed."
- **Fix**: Add a step using a fresh anon client (no sign-in) that selects flashcards and asserts zero rows.
- **Decision**: FIXED — added step 8 (anon read=0) to the script contract, an automated success criterion, and Progress item 2.3 (manual items renumbered 2.4/2.5).

### F2 — RLS ≠ table GRANTs; "permission denied" gotcha unflagged

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — migration contract
- **Detail**: The migration enabled RLS + policies but specified no table-level GRANTs. RLS governs which rows; GRANT governs whether the role can touch the table at all. Supabase usually grants new public tables to authenticated/anon via default privileges, but it's environment-dependent — if absent, owner A's INSERT fails "permission denied for table" in Phase 2, reading like an RLS failure.
- **Fix A ⭐ Recommended**: One-line remedy note in Phase 1 contract.
  - Strength: Zero added SQL if defaults already grant; gives exact remedy if Phase 2 fails.
  - Tradeoff: Relies on implementer reading the note when it fires.
  - Confidence: MED — Supabase usually grants via default privileges, but CLI versions vary.
  - Blind spot: Defaults not re-confirmed on this exact CLI version.
- **Fix B**: Add explicit GRANT statements to the migration unconditionally.
  - Strength: Deterministic — table reachable regardless of default-privilege state; safe in prod.
  - Tradeoff: Slightly redundant if defaults already cover it.
  - Confidence: HIGH — explicit grants always work.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B — added explicit `grant select, insert, update, delete on public.flashcards to authenticated;` to the Phase 1 migration contract (with note not to grant `anon`).

### F3 — Verify-script env vars unnamed; confirmation note moot

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 contract + Critical Implementation Details
- **Detail**: (1) Script "reads URL/anon/service-role from env vars" without naming them or how they come from `supabase status`. (2) The "email confirmation can block sign-in" note is moot — `supabase/config.toml:209` has `enable_confirmations = false` locally.
- **Fix**: Name the expected env vars and correct the confirmation note.
- **Decision**: FIXED — named `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status`) with an example invocation; rewrote the Critical Implementation Detail to note confirmations are off locally.
