<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Critical-Path Coverage (Risk #1 & Risk #2) Implementation Plan

- **Plan**: context/changes/testing-critical-path-coverage/plan.md
- **Scope**: Phase 4 of 4 (full plan review — all phases complete)
- **Date**: 2026-07-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Two Phase-1 files added without a "Changes Required" entry

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `tests/helpers/require-env.ts`, `tests/integration/harness-smoke.test.ts`
- **Detail**: Neither file is itemized in Phase 1's "Changes Required" bullets. Both are disclosed in the Phase 1 commit message (`ee74f0d`) and directly serve the phase's stated goal — `require-env.ts` is a small extracted `requireEnv()` used by `auth.ts` and the smoke test to avoid duplicating the "clear error if env missing" check across call sites; `harness-smoke.test.ts` proves the harness reaches a real local Supabase instance, which is exactly what Phase 1's manual verification step asked for ("confirming env-sourcing and Vitest config work end-to-end"). This is undocumented-in-the-plan-text scope, not undisclosed-in-the-commit scope — benign, but the plan text itself doesn't mention either file.
- **Fix**: No code change needed. Optionally add a one-line addendum to Phase 1's "Changes Required" in `plan.md` noting these two files, so a future reader of the plan (not just the commit log) sees the complete file list.
- **Decision**: FIXED — added an "Addendum (discovered during implementation, impl-review F1)" note under Phase 1's Changes Required in `plan.md` naming both files and their purpose.

### F2 — Silent failure swallowing in test-user cleanup

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/helpers/auth.ts:53-57`
- **Detail**: `cleanupUser(id)` swallows any `auth.admin.deleteUser` failure via `.catch(() => undefined)` with no logging. Harmless in CI (ephemeral instance per run), but on repeated local `npm test` runs against the same `supabase start` instance, a failed cleanup leaves a throwaway auth user (and cascade-deleted flashcard rows that never got created to begin with) with zero visibility — silent accumulation of test-user junk over time.
- **Fix**: Add a `console.warn` in the `.catch()` so a failed cleanup is visible during local development, e.g. `.catch((err) => console.warn(\`cleanupUser(${id}) failed: ${err}\`))`.
- **Decision**: FIXED — `tests/helpers/auth.ts:56-58` now logs `cleanupUser(${id}) failed: ${message}` via `console.warn` on `deleteUser` failure (message extracted via `err instanceof Error ? err.message : String(err)` to satisfy `@typescript-eslint/restrict-template-expressions`). Full suite (17/17) and lint (0 errors, expected `no-console` warning) both verified green.

## Supporting evidence (not findings)

- **Plan Adherence**: 10 of 13 explicit "Changes Required" items are exact matches. One item (`vitest.config.ts`) is a self-documented, justified DRIFT — the plan specified Astro's `getViteConfig`, but the shipped config uses a plain Vitest config with a manual `@/*` alias and an `astro:env/server` stub plugin, because `getViteConfig` pulls in the `@astrojs/cloudflare` adapter's Vite plugin, which conflicts with Vitest's own use of the `ssr` Vite Environment. This is explained inline in `vitest.config.ts`, cross-referenced in the synced `test-plan.md` §6.1, and stated in the Phase 1 commit message — a real technical blocker discovered during implementation, not an arbitrary deviation.
- **Success Criteria**: re-ran all automated checks at HEAD (commit `6784d4a`): `npm test` → 4 test files, 17 tests, all passing; `npm run lint` → clean; `npx astro sync && npm run build` → clean. All manual verification rows in `## Progress` (1.4, 1.5, 2.4, 3.3, 4.2) are checked with corresponding commit SHAs; row 3.3 (curl an unexpected extra card into the save endpoint) was personally re-verified live against a running dev server + local Supabase in this session, confirming the documented client-only-enforcement caveat is accurate.
- **Safety & Quality**: no hardcoded credentials, no prod endpoints reachable — `tests/setup/env.ts` sources credentials exclusively via `npx supabase status -o env`, which only ever reports the local dev stack and fails loudly if it isn't running; there is no path for these tests to run against a real/shared Supabase project. CI wiring correctly gates `build`/`deploy` on test success (a failing `npm test` step aborts the job; `deploy` `needs: ci`).
- **Pattern Consistency**: all three risk test files and the smoke test share consistent naming, `describe`/`it` structure, `afterAll`-based cleanup, and correct reuse of `tests/helpers/auth.ts`/`api-context.ts` — no reinvented sign-in or context-building logic.
- **Oracle correctness**: spot-checked both risk tests against the actual production code they exercise. Risk #2's expected `{saved: 2}` / persisted-row-count assertions are independently specified from the PRD's human-gating guardrail, not derived by re-running the save endpoint's own insert logic. Risk #1's route-ownership test asserts the exact documented `404 {error: "not_found"}` contract (traced to a historical regression noted in the archived `manage-saved-flashcards` plan), not a weaker "not 200" check.
