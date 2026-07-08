---
date: 2026-07-08T19:15:08+02:00
researcher: tswiackiewicz
git_commit: 5260f840a587cfcfd060155e77fe0ca3924697f3
branch: master
repository: 10xcards
topic: "Rollout Phase 4 (Quality-gates wiring) — migration-live CI gate + AI review flow e2e smoke"
tags: [research, codebase, ci-cd, github-actions, playwright, e2e, flashcards, generate-view, migrations]
status: complete
last_updated: 2026-07-08
last_updated_by: tswiackiewicz
---

# Research: Rollout Phase 4 (Quality-gates wiring)

**Date**: 2026-07-08T19:15:08+02:00
**Researcher**: tswiackiewicz
**Git Commit**: 5260f840a587cfcfd060155e77fe0ca3924697f3
**Branch**: master
**Repository**: 10xcards

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md` ("Quality-gates wiring", Risk #5 — schema migration lands in the repo but never reaches production). Two deliverables: (a) a CI gate that closes the "dry-run ≠ real push" gap so a DB-dependent feature is never treated as shipped until the migration is provably live, and (b) a Playwright e2e smoke test on the AI flashcard review flow (generate → accept/edit/reject → save). Find the exact CI deploy-job structure, the AI review flow's UI surface (routes, accessible locators, auth requirement), what quality-gate wiring already exists, and what test-harness/e2e conventions from Phases 1–3 and the `/10x-e2e` skill must be reused or respected.

## Summary

- **Risk #5's exact gap is confirmed and narrow.** `.github/workflows/ci.yml`'s `deploy` job runs `supabase db push` (real push, line 58) immediately before `wrangler deploy` (lines 64–68), but nothing verifies the push actually succeeded or that zero migrations remain pending — there is no independent post-push check. The `ci` job's `supabase db push --dry-run` (line 33) only proves migrations _would_ apply; it never runs in `deploy` and is not a live-schema check. This is precisely the "CI ran a dry-run ≠ CI pushed the migration" conflation the test-plan's Risk Response Guidance names — confirmed, not corrected.
- **No pending-migration count check exists anywhere.** The gate to add is a hard assertion (`pending migrations == 0`) that runs either as a new step between the real `db push` (ci.yml:55–62) and `wrangler deploy` (ci.yml:64–68), or as a precondition on the `deploy` job itself.
- **No e2e/Playwright infrastructure exists at all** — not a config, not a dependency, not a `tests/e2e/` directory, not a placeholder step in CI. Phase 4's plan must include **bootstrapping Playwright from scratch** (config, `webServer`/dev-server wiring, an auth `storageState` pattern, a CI job) before `/10x-e2e` can be invoked — that skill discovers infra, it does not scaffold it, and will hard-stop with a "run `npm init playwright@latest`" message if invoked first.
- **The AI review flow is fully built and already integration-tested at the route-handler level** (`tests/integration/risk2-review-save-contract.test.ts`), but the accept/reject/pending filtering is enforced **entirely client-side** in `GenerateView.tsx` — the save endpoint has no concept of accepted/rejected/pending and will persist whatever it's given. This is exactly the kind of gap only a real-browser e2e test can catch; it's the concrete justification for why Phase 4's e2e smoke adds signal beyond the existing integration coverage (not a Phase 4 risk to fix — Risk #2 is already Phase 1's scope — but it sharpens what the e2e test must actually assert).
- Existing quality gates (lint + type-aware ESLint, unit+integration via Vitest against a live local Supabase) are confirmed wired and required in the single `ci` job; nothing there needs to change for Phase 4.

## Detailed Findings

### CI/CD deploy pipeline (Risk #5 target)

`.github/workflows/ci.yml` (69 lines, read in full) defines two jobs:

- **`ci`** (`.github/workflows/ci.yml:10-37`, `runs-on: ubuntu-latest`) — runs on every push/PR to `master` (`ci.yml:3-7`). Step order:
  1. checkout (`:13`)
  2. setup-node, Node 24 (`:14-17`)
  3. `npm ci` (`:18`)
  4. `npx astro sync` (`:19`)
  5. `npm run lint` (`:20`) — type-aware ESLint (`eslint.config.js:14-21`, `tseslint.configs.strictTypeChecked` + `parserOptions.projectService: true`); there is **no separate `tsc`/`astro check` step** anywhere — "typecheck" happens only as part of lint.
  6. `supabase/setup-cli@v2` (`:22-24`)
  7. `supabase start` (`:25`)
  8. `npm test` → `vitest run` (`:26`) — depends on the live local Supabase from the previous step (confirmed: no intervening steps, matches test-plan §6.2's globalSetup requirement).
  9. `npm run build` (`:28`)
  10. "Check Supabase migrations apply cleanly" (`:30-37`) — `supabase link` + `supabase db push --dry-run`. **Dry-run only**, runs on both push and PR.
- **`deploy`** (`.github/workflows/ci.yml:39-69`, `needs: ci`, `if: github.ref == 'refs/heads/master'` at `:41`) — only fires on push to `master`, after `ci` succeeds. Step order:
  1. checkout (`:44`)
  2. setup-node (`:45-48`)
  3. `npm ci` (`:49`)
  4. `npm run build` (`:50`)
  5. `supabase/setup-cli@v2` (`:52-54`)
  6. **"Push Supabase migrations"** (`:55-62`) — `supabase link` + `supabase db push` (real, no `--dry-run`).
  7. **`cloudflare/wrangler-action@v4`, `command: deploy`** (`:64-68`).

Confirmed gaps:

- No `continue-on-error`, `|| true`, or ignore-errors flag anywhere in the file — a failing `db push` step does fail the job (steps after a failed step are skipped by GitHub Actions' default behavior), so a hard CLI failure is _not_ silently swallowed today.
- What's missing is narrower and worse: there's no check that the push **actually resulted in zero pending migrations** — e.g. a partial success, an unexpected no-op, or a CLI exit-code that doesn't reflect a genuine partial failure would sail through undetected, since nothing re-queries migration state after the push and before `wrangler deploy`.
- Secrets used identically in both the dry-run (`:35-37`) and real-push (`:60-62`) steps: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`. Deploy also uses `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (`:66-67`).
- `supabase/migrations/` currently holds 4 files, timestamp-prefixed (`20260624185919_create_flashcards.sql`, `20260701213238_add_srs_state.sql`, `20260702145938_create_account_deletions.sql`, `20260702154817_optimize_pending_deletion_rls.sql`) — useful as fixture/count reference if the gate's design ends up comparing a pending-count before/after.
- No `CODEOWNERS`, no branch-protection-as-code in the repo — a new required-status-check name would need to be configured in GitHub's branch-protection UI (out of repo scope); the only naming signals available are the existing job ids (`ci`, `deploy`) and `purge` (`.github/workflows/purge.yml`).

### Existing quality-gate wiring vs. test-plan §5 claims

Cross-checked against `context/foundation/test-plan.md` §5 (lines 122–131):

- "lint + typecheck: required, already wired" — **confirmed**, with the caveat that "typecheck" is type-aware ESLint (`eslint.config.js`), not a standalone `tsc`/`astro check` step.
- "unit + integration: required, wired in CI since Phase 1" — **confirmed**, `npm test` (`ci.yml:26`) runs immediately after `supabase start` (`ci.yml:25`).
- "migration-live gate: required after Phase 4" — **confirmed not yet built**; closest existing analog is the dry-run check in `ci` (`ci.yml:30-37`), which is a different, weaker check than the planned gate.
- "e2e on AI review flow: required after Phase 4" — **confirmed not yet built**: zero Playwright references in `ci.yml` or `package.json` (only an unrelated transitive `@vitest/browser-playwright` entry in `package-lock.json`).
- **Insertion points**: an e2e job needs a built+served app — `npm run build` already exists (`ci.yml:28`/`:50`, → `astro build`), but nothing in CI currently serves it; `package.json` has `"preview": "astro preview"` unused in CI today. The natural insertion point for an e2e step is in `ci`, after the build step (`:28`) and independent of the migration dry-run check. The migration-live gate's natural insertion point is inside `deploy`, between the real push (`:55-62`) and `wrangler deploy` (`:64-68`).

### AI review flow — UI surface for the e2e smoke

- **Route**: `src/pages/generate.astro`, hydrates `GenerateView` with `client:load` (`generate.astro:16`) — no scroll/idle deferral, so a test can interact as soon as the page loads.
- **Auth**: `/generate` is in `PROTECTED_ROUTES` (`src/middleware.ts:4`); unauthenticated requests are redirected to `/auth/signin` (`src/middleware.ts:18-22`). No test-only auth bypass exists — sign in via the real form. `src/components/auth/SignInForm.tsx` posts to `/api/auth/signin`; `Email`/`Password` fields are properly `htmlFor`-wired (`src/components/auth/FormField.tsx:37-45`), so `getByLabel("Email")`/`getByLabel("Password")` work; submit button text is `"Sign in"`.
- **Review UI locators** (`src/components/flashcards/GenerateView.tsx`, `CandidateCard.tsx`):
  - Source-text input: no `<label>`, textarea only — use `getByPlaceholder` (placeholder text at `GenerateView.tsx:134`).
  - `getByRole("button", { name: "Generate" })` (`:147-154`, becomes "Generating cards…" while pending).
  - `getByRole("button", { name: "Accept all" })` / `"Reject all"` (`:199-212`), `"Reset"` (`:216-219`, confirm dialog reuses `"Reset"`/`"Cancel"`), `"Save accepted"` / `"Saving…"` (`:234-237`).
  - Per-candidate `getByRole("button", { name: "Accept" })` / `"Reject"` in `CandidateCard.tsx:33-54` — **accessible name is identical across all cards**, so tests must scope by list-item index/locator, not name alone.
  - Question/Answer `<label>`s in `CandidateCard.tsx:58,69` are **not** `htmlFor`-paired to their textareas (`:59-67`, `:70-78`) — `getByLabel` will not work there; use `getByText` + sibling traversal or `getByRole("listitem").nth(i).getByRole("textbox")`.
  - No `aria-pressed`/`aria-label` exposes accepted/rejected state — only CSS `tone` classes and button `variant`. The reliable accessible signal for "how many are accepted" is the plain-text `"{n} accepted"` counter (`GenerateView.tsx:194`) and the post-save banner `"{n} card(s) saved to your deck."` (`:164-168`).
- **API boundary**: `POST /api/flashcards/generate` (`src/pages/api/flashcards/generate.ts:27-70`) calls OpenRouter (external, needs `OPENROUTER_API_KEY`) — this is the boundary an e2e test should mock at the network layer per the `/10x-e2e` skill's real-vs-mocked rule, exactly like Phase 3's MSW pattern for the same provider (`tests/integration/risk6-generation-error-hygiene.test.ts`). `POST /api/flashcards` (`src/pages/api/flashcards/index.ts:16-55`) is the save endpoint, real DB write.
- **Important gap for e2e scope**: accept/reject/pending filtering happens **entirely client-side** in `GenerateView.tsx` (the accept-filter before the save call, `:87,92-94`) — the save endpoint itself has no accepted/rejected concept and will persist whatever subset it receives (documented explicitly in `tests/integration/risk2-review-save-contract.test.ts:1-7`). A route-handler-level integration test (already written in Phase 1) cannot catch a UI regression that fails to filter correctly before calling save; only a real-browser e2e test exercising the actual Accept/Reject buttons can. This is the concrete "why e2e adds signal here, cost×signal-wise" answer for Phase 4's plan.
- No UI list of saved cards on `/generate` itself — verifying persisted results requires either a direct DB read (reusing `tests/helpers/auth.ts`'s `signInDirect`/admin client pattern) or navigating to `/cards`.

### Existing test harness (Phases 1–3) — reuse, don't duplicate

- `tests/helpers/auth.ts` — `seedUser()`, `signInDirect()`, `cleanupUser()`, `getAuthCookieHeader()` (route-handler-level cookie encoding via a throwaway `@supabase/ssr` server client).
- `tests/helpers/api-context.ts` — `buildContext()` fake `APIContext` for direct handler invocation (not applicable to Playwright, which drives a real browser/HTTP — a Playwright test would sign in through the real `/auth/signin` form instead, or via a `storageState` fixture computed once).
- `tests/setup/env.ts` — Vitest `globalSetup`, shells to `supabase status -o env`; runs for the _entire_ Vitest process regardless of which test file is targeted.
- `tests/setup/msw.ts` — bare `setupServer()`, deliberately scoped per-test-file, never in global `setupFiles`.
- `vitest.config.ts` — plain config (not `getViteConfig`, which conflicts with the Cloudflare adapter's Vite plugin), `@/*` alias, `astro:env/server` stub.
- None of this is Playwright-related — Phase 4's e2e layer is greenfield and orthogonal; nothing here needs to change.

### `/10x-e2e` skill expectations (for `/10x-plan`, not this research)

- Hard-stops if no `playwright.config.*`/`*.spec.ts` exists anywhere — confirmed neither exists, so **Phase 4's plan must include one-time Playwright bootstrap** (config, `webServer`/served-app wiring — `astro build` + `astro preview` is the most direct fit given existing `package.json` scripts, since no Cloudflare-preview-deploy pattern exists yet either) **before** `/10x-e2e` can be invoked for the actual test-generation step.
- Expects an auth `storageState` pattern (sign in once, reuse across tests) rather than a UI login per test.
- Its own worked example in `references/e2e-prompt-template.md` is already scoped to this project's generate→review→save flow with OpenRouter mocked — near-directly reusable once the review-flow UI grounding above is fed into it.
- Five anti-patterns it screens generated tests against (hallucinated assertion, brittle selector, shared state, `waitForTimeout`, no cleanup) align with root `CLAUDE.md`'s existing E2E hard rules — no new rules needed, just confirmation they're already in force project-wide.

## Code References

- [`.github/workflows/ci.yml:30-37`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/.github/workflows/ci.yml#L30-L37) — dry-run migration check (`ci` job)
- [`.github/workflows/ci.yml:55-62`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/.github/workflows/ci.yml#L55-L62) — real migration push (`deploy` job), no post-push verification
- [`.github/workflows/ci.yml:64-68`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/.github/workflows/ci.yml#L64-L68) — `wrangler deploy`, runs immediately after the push with nothing in between
- [`.github/workflows/ci.yml:39-41`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/.github/workflows/ci.yml#L39-L41) — `deploy` job's `needs: ci` + `master`-only gate
- [`package.json`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/package.json) — `"build": "astro build"`, `"preview": "astro preview"`, `"test": "vitest run"`; no `test:e2e` script yet
- [`src/pages/generate.astro:16`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/src/pages/generate.astro#L16) — `<GenerateView client:load />`
- [`src/middleware.ts:4,18-22`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/src/middleware.ts#L4) — `PROTECTED_ROUTES` including `/generate`, redirect-to-signin guard
- [`src/components/flashcards/GenerateView.tsx:66-237`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/src/components/flashcards/GenerateView.tsx#L66-L237) — generate/accept/reject/save wiring and all button locators
- [`src/components/flashcards/CandidateCard.tsx:29-78`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/src/components/flashcards/CandidateCard.tsx#L29-L78) — per-candidate Accept/Reject buttons, unpaired Question/Answer labels
- [`src/pages/api/flashcards/generate.ts:27-70`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/src/pages/api/flashcards/generate.ts#L27-L70) — generation endpoint, OpenRouter boundary
- [`src/pages/api/flashcards/index.ts:16-55`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/src/pages/api/flashcards/index.ts#L16-L55) — save endpoint, no accept/reject filtering server-side
- [`tests/integration/risk2-review-save-contract.test.ts:1-64`](https://github.com/tswiackiewicz/10xcards/blob/5260f840a587cfcfd060155e77fe0ca3924697f3/tests/integration/risk2-review-save-contract.test.ts#L1-L64) — existing route-level proof of the save contract; explicitly documents the client-side-only filtering gap
- [`supabase/migrations/`](https://github.com/tswiackiewicz/10xcards/tree/5260f840a587cfcfd060155e77fe0ca3924697f3/supabase/migrations) — 4 existing migration files, timestamp-prefixed convention

## Architecture Insights

- The project's CI already treats "prove it before you trust it" as a working norm (dry-run before real push, lint's type-aware pass before tests) — the missing migration-live gate is a gap in that norm's _coverage_, not a departure from an established pattern. The fix should feel additive: one more `supabase migration list`-style check (or equivalent) between existing steps, not a redesign.
- The codebase's client-side/server-side split for the review flow (accept/reject is pure React state; only the _save_ step touches the network) means integration tests and e2e tests are answering genuinely different questions here — integration proves "the save endpoint persists what it's told," e2e proves "the UI tells it the right thing." Both are needed; this is why the test-plan scoped Phase 4's e2e narrowly to this one flow instead of expanding an existing integration test.
- No Cloudflare-preview-deploy machinery exists yet, so the natural, lowest-friction way to serve the app for CI e2e is `astro build` + `astro preview` (already-defined scripts), not a synthetic Workers preview environment.

## Historical Context (from prior changes)

- `context/foundation/lessons.md:5-10` — "Migrations aren't shipped until CI pushes them to production": the exact incident this Phase 4 gate is meant to prevent a recurrence of (three migrations sat unapplied in prod for days until a cron hit a missing table). Confirms the CI gap found above is the same shape of problem, not yet closed.
- `context/foundation/test-plan.md` §6 (Phases 1–3 cookbook) — established the two-layer integration pattern (RLS-policy layer + route-wiring layer), the MSW-per-file convention, and the hermetic-vs-integration split for un-seedable branches. Phase 4 doesn't need any of these patterns for its own two deliverables (a CI gate and a browser e2e test are both outside that harness's scope), but should not contradict them.
- Prior rollout phases (1–3, all `complete` per test-plan §3) never touched CI workflow structure or introduced e2e — Phase 4 is the first phase to modify `.github/workflows/ci.yml` and the first to introduce a new test runner (Playwright) to the project.

## Related Research

- `context/changes/testing-critical-path-coverage/` (archived) — Phase 1 research/plan, source of the `tests/helpers/` harness.
- `context/changes/testing-compliance-critical-flows/` (archived) — Phase 3, most recent prior rollout phase; establishes the retention-boundary seeding pattern referenced in test-plan §6.5.

## Open Questions

- **Gate mechanics**: should the migration-live gate compare a pending-migration count computed via the Supabase CLI (e.g., re-running a dry-run-style check _after_ the real push and asserting it reports zero pending) or use a different verification primitive? The CLI's exact post-push introspection capability should be confirmed during `/10x-plan`/implementation, not assumed here.
- **e2e app-serving choice**: `astro build` + `astro preview` is the lowest-friction fit given existing scripts, but whether the app's server-only env secrets (`SUPABASE_URL`/`SUPABASE_KEY`) can be safely supplied to a CI-local `astro preview` process (vs. requiring a running local Supabase, same as the Vitest suite) needs confirmation during planning.
- **Required-check naming**: since branch-protection rules live outside the repo, whoever configures the new CI job names should coordinate with whatever GitHub branch-protection settings currently name `ci`/`deploy` as required checks, so the new gate is actually enforced and not just present.
