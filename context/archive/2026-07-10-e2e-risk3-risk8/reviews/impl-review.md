<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: E2E Coverage for Risk #3 (IDOR) and Risk #8 (Route-Protection Drift)

- **Plan**: context/changes/e2e-risk3-risk8/plan.md
- **Scope**: Phase 1-2 of 2 (full plan)
- **Date**: 2026-07-10
- **Verdict**: APPROVED (all findings triaged and fixed)
- **Findings**: 0 critical, 1 warning, 1 observation — both FIXED

## Triage summary

- F1 (WARNING, TS strict-mode `baseURL` type error) — FIXED
- F2 (OBSERVATION, userA cleanup-on-failure gap) — FIXED
- Post-fix verification: `tsc --noEmit` clean, `npm run lint` clean, `npm test` 54/54 pass, `npm run test:e2e` 5/5 pass.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — TypeScript strict-mode type error on `baseURL`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/risk3-idor-cross-user-delete.spec.ts:47
- **Detail**: `extraHTTPHeaders: { Cookie: cookieB, Origin: baseURL }` assigns the Playwright fixture `baseURL` (typed `string | undefined`) into a field requiring `Record<string, string>`. Confirmed via `npx tsc --noEmit -p tsconfig.json`: `TS2322: Type 'string | undefined' is not assignable to type 'string'` — the only type error in the repo, so it's introduced by this diff. `npm run lint` (ESLint) doesn't catch it since there's no type-aware assignability rule for object literals, and neither `npm run lint` nor `npm run build` (Astro build doesn't full-typecheck `tests/`) run a dedicated `tsc`/`astro check` step, so it currently passes CI silently. Harmless at runtime today because `playwright.config.ts` always sets `baseURL`, but it's a real hole in the "TypeScript 5.9 (strict)" convention this repo otherwise upholds.
- **Fix**: Guard with an explicit check before building the request context, e.g. `if (!baseURL) throw new Error("baseURL is required");` right after the fixture is destructured, then reuse the narrowed `baseURL` in `extraHTTPHeaders`.
- **Decision**: FIXED — guard added at tests/e2e/risk3-idor-cross-user-delete.spec.ts:22; `tsc --noEmit` clean, lint clean, spec re-verified passing.

### F2 — userA's seeded flashcard isn't cleaned up if the cross-user assertion fails

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/risk3-idor-cross-user-delete.spec.ts:26-69
- **Detail**: `userB`'s cleanup is correctly wrapped in `try/finally` (lines 39-58), but userA's card is only deleted at the very end (lines 60-69) with no enclosing `try/finally`. If the assertions on lines 51-52 throw — exactly the failure mode this test exists to catch — userA's card is left in the DB. This mirrors the existing `risk1-flashcard-persists-after-reload.spec.ts`'s identical structural gap (delete-at-the-end, no outer try/finally), so it's consistent with established local convention rather than a new problem introduced here — recorded as an observation, not a blocking finding.
- **Fix**: Optional — wrap the setup+action+cleanup body in an outer `try/finally` if stray rows become a nuisance. Not required to merge; matches existing pattern.
- **Decision**: FIXED — action+cleanup wrapped in an outer try/finally so userA's card deletion runs even if the cross-user assertions throw; `tsc --noEmit` clean, lint clean, spec re-verified passing.

## Supporting verification (this review)

- `npm run lint` — pass, 0 errors/warnings.
- `npm test` (Vitest) — 16 files / 54 tests pass, unaffected by this change.
- `npm run test:e2e` (Playwright, against local Supabase) — 5/5 pass, including both new specs (`risk3-idor-cross-user-delete.spec.ts`, `risk8-route-protection-smoke.spec.ts`).
- `npx tsc --noEmit` — 1 error (see F1); confirms F1 is real and reproducible.
- Plan-drift sub-agent: both new spec files verdict **MATCH** against plan.md's stated intent — no drift, no missing items, no unauthorized scope additions. The `Origin: baseURL` header in Risk #3's spec (not in the plan's literal Contract wording) is a necessary, documented fix for Astro's `security.checkOrigin` CSRF guard, not scope creep.
- Safety/pattern sub-agent: both tests verified as sound security oracles — a real IDOR or route-protection regression would make them fail, not silently pass (confirmed by reading `src/pages/api/flashcards/[id].ts` and `src/middleware.ts`'s actual matching logic against each assertion). No CSS/XPath locators, no `waitForTimeout`, no raw `page.goto()`/`page.reload()`, `apiContext.dispose()` present, `adminClient()` used narrowly for ID lookup only.
- Manual verification checkboxes (Progress section, both phases) are marked `[x]` with commit SHAs and are corroborated by each commit's message describing a deliberate-break check (temporarily broke the guarded logic, confirmed the new test went red, reverted).
