# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-04 (Phase 1 → complete)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
lockfiles, generated types churn noise, and build output). 27 commits in the
last 30 days — sufficient signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                    | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A user's saved flashcards silently disappear, or become visible/editable by a different account                                            | High   | High       | Interview Q1; PRD Guardrails (no-loss, no cross-user visibility); hot-spot dir `src/pages/api` (20 commits/30d), `src/lib/flashcards` (11 commits/30d)                                                                                 |
| 2   | A rejected or un-actioned AI candidate is silently saved to the deck, or an explicitly accepted one is lost, in the review flow            | High   | High       | Interview Q3 (low-confidence area); PRD FR-004 / human-gating guardrail (no silent auto-save); hot-spot dir `src/components/flashcards` (14 commits/30d)                                                                               |
| 3   | An authenticated user reads, edits, or deletes another user's flashcard by manipulating a resource ID (IDOR)                               | High   | Medium     | PRD Access Control ("every authenticated user can see and manage only their own flashcards"); hot-spot dir `src/pages/api` (20 commits/30d); archive `flashcard-store-rls` change notes ("isolation... must be verified, not assumed") |
| 4   | The account-deletion purge fires before the 30-day window (violates no-loss) or never fires (violates the GDPR erasure promise)            | High   | Medium     | PRD FR-010, GDPR NFR; roadmap S-05 risk note ("compliance-driven, destructive, and time-delayed with no background-job baseline or observability")                                                                                     |
| 5   | A schema migration lands in the repository but never reaches production, and a DB-dependent feature silently breaks there                  | High   | Medium     | `context/foundation/lessons.md` — documented migration-drift incident; recent CI change adding a production migration push needs a regression guard, not just a one-time fix                                                           |
| 6   | An AI-generation error response leaks the user's raw source text or provider internals (upstream error bodies, key material) to the client | High   | Medium     | PRD GDPR NFR (source text handling); abuse lens — secret/PII leakage (product accepts free-form user input and calls a third-party model provider)                                                                                     |
| 7   | Empty, whitespace-only, or over-cap input to AI generation returns an empty/failed result instead of an explanatory message                | Medium | Medium     | PRD US-01 acceptance criteria ("empty or unusable input produces an explanatory message, not an empty/failed result"); hot-spot dir `src/lib/flashcards` (11 commits/30d)                                                              |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row.

| Rating | Impact                                                          | Likelihood                                               |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| High   | user loses access, data, or money; failure is publicly visible  | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs          |
| Low    | cosmetic, easily reverted, no data effect                       | stable code, rarely touched                              |

Protect High × High first (#1, #2). High-impact × Medium-likelihood rows
(#3–#6) follow; #7 (Medium × Medium) is lowest priority in this rollout.

**Abuse / security lens.** The product has auth, per-user data, and accepts
free-form user input, so the map includes two abuse rows required by that
surface: #3 (authorization/access — IDOR) and #6 (secret/PII leakage).

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                               | Must challenge                                                                                                                               | Context `/10x-research` must ground                                                                                                                                                                  | Likely cheapest layer                                                                               | Anti-pattern to avoid                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | A user's flashcards persist across sessions/logins and are never visible or mutable by a different authenticated user, including under concurrent access from two accounts                                | "RLS policy exists" ≠ "RLS is hit on every query path" — a route using the wrong client could silently bypass it                             | Which Supabase client (anon/session-bound vs. any elevated client) each flashcard route uses; the exact RLS policy predicate; any route that reads flashcards without an authenticated-session check | integration (two real authenticated sessions against a local Supabase instance)                     | Testing only "my own reads work" — must include a second-user negative-access assertion; never mock away the DB/RLS layer for this risk        |
| #2   | No candidate becomes a persisted flashcard unless explicitly accepted (or edited-then-accepted); a rejected or un-actioned candidate leaves zero trace in the saved deck                                  | "the UI only shows an accept button for accepted cards" is not proof — the server must independently enforce this, not just the client       | The request/response contract between the review UI and the save endpoint; whether accept vs. edit-then-accept produce distinguishable server-side writes                                            | integration (submit a mixed accept/edit/reject batch, assert exact resulting saved set)             | Implementation mirror — asserting the saved set equals "whatever the code currently writes" instead of an independently specified expected set |
| #3   | A request to read/edit/delete a flashcard by ID belonging to a different user is rejected (403/404), not merely absent from that user's list                                                              | "logged in" ≠ "authorized" — ownership must be checked per-resource, independent of whether RLS alone is relied on                           | Whether flashcard API routes perform an explicit ownership check alongside the RLS-scoped query; the error shape returned for a cross-user ID                                                        | integration (second user's session + first user's card ID)                                          | Testing only that the list endpoint filters correctly — that proves list-scoping, not direct-ID access control                                 |
| #4   | A soft-deleted account is denied sign-in immediately; its data is unreachable but not yet erased before day 30; it is fully erased at/after day 30 — no state where data is both accessible and "deleted" | "the purge route runs" ≠ "it runs on the correct schedule in production" — the boundary condition matters more than a single successful call | How "deleted" state and its timestamp are stored; the purge route's eligibility query; how sign-in checks the deleted flag                                                                           | integration (seed rows at day 29/30/31 ages; assert purge scope; assert soft-delete blocks sign-in) | Asserting the purge "ran successfully" (200 response) without asserting which rows were and weren't erased                                     |
| #5   | Every migration file present in the repository is provably applied in the production database before a DB-dependent feature is treated as shipped                                                         | "CI ran a dry-run" ≠ "CI pushed the migration" — those are different steps that can silently drift apart again                               | The current CI deploy job's exact migration-push step, its ordering relative to the app deploy, and whether its failure blocks the deploy or fails silently                                          | CI gate / deterministic check (pending-migration count must be zero before deploy proceeds)         | Treating "migration file exists in the repo" as equivalent to "schema is live" — that conflation caused the prior incident                     |
| #6   | An error response from the AI-generation endpoint (validation failure, provider error, timeout) never includes the raw source text or provider request/response internals                                 | "the happy path returns a generic message" doesn't cover every error branch — each branch must be checked individually                       | Every distinct error-handling branch in the generation endpoint and exactly what each includes in its response body                                                                                  | unit/integration (assert an explicit allowed-fields schema per error branch)                        | A substring-blocklist test ("response doesn't contain word X") — trivially bypassed by rewording; assert an allowed-fields schema instead      |
| #7   | Submitting empty, whitespace-only, or over-the-cap source text returns a clear explanatory error, never an empty success result or an unhandled failure                                                   | "the happy path returns candidates" says nothing about the boundary — test the exact boundary values, not just "some short input"            | The exact validation rule and whether it runs before or after spending a provider request                                                                                                            | unit (validation function/schema — no live provider call needed)                                    | Happy-path-only testing that never exercises the boundary values named in the PRD acceptance criteria                                          |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                               | Goal (one line)                                                                                   | Risks covered | Test types         | Status      | Change folder                                     |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- | ------------------ | ----------- | ------------------------------------------------- |
| 1   | Critical-path coverage                   | Bootstrap the test runner and prove the no-loss/no-leak and human-gating guardrails actually hold | #1, #2        | unit + integration | complete    | `context/changes/testing-critical-path-coverage/` |
| 2   | Authorization & input-boundary hardening | Prove per-resource ownership checks and input-boundary handling are enforced, not assumed         | #3, #7        | integration + unit | not started | —                                                 |
| 3   | Compliance-critical flows                | Prove the 30-day retention boundary and AI-error-response data hygiene                            | #4, #6        | integration        | not started | —                                                 |
| 4   | Quality-gates wiring                     | Lock a migration-drift gate in CI; wire required gates; add an e2e smoke on the AI review flow    | #5            | gates + e2e        | not started | —                                                 |

**Status vocabulary** (fixed — parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. No test runner exists yet — every
row below is bootstrapped by the named rollout phase.

| Layer                          | Tool                            | Version                    | Notes                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration             | Vitest                          | none yet — see Phase 1     | Astro's own docs recommend Vitest; not independently re-verified this session (Context7 quota exceeded)                                                                                                                                     |
| API mocking                    | MSW                             | none yet — see Phase 1     | Mock the OpenRouter HTTP edge only; never mock internal modules or the Supabase RLS layer                                                                                                                                                   |
| local DB for integration tests | Supabase CLI (`supabase start`) | already used for local dev | Real RLS policies exercised in integration tests, per the no-mocking-the-DB rule under Risk #1/#3                                                                                                                                           |
| e2e                            | Playwright                      | none yet — see Phase 4     | Scoped to the AI review flow smoke only, per cost × signal — not a full-app e2e suite                                                                                                                                                       |
| accessibility                  | none planned                    | n/a                        | No accessibility risk surfaced this rollout; revisit at `--refresh` if one does                                                                                                                                                             |
| (optional) AI-native           | none planned                    | n/a                        | No visual-heavy or ambiguous-output risk surfaced that a deterministic test can't already catch; when NOT to use: this project's flashcard content is exactly the kind of non-deterministic output the interview said not to assert on (Q5) |

**Stack grounding tools (current session):**

- Docs: Context7 — attempted for Vitest/Playwright + Astro setup guidance; returned "monthly quota exceeded." Treated as unavailable; checked: 2026-07-03.
- Search: none available in current session; checked: 2026-07-03.
- Runtime/browser: Playwright MCP — available (browser automation tools present); earmarked for the Phase 4 e2e smoke, not used yet; checked: 2026-07-03.
- Provider/platform: no authenticated GitHub/Cloudflare/Supabase MCP in this session; not used; checked: 2026-07-03.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                                                | Where                | Required?                                 | Catches                               |
| ------------------------------------------------------------------- | -------------------- | ----------------------------------------- | ------------------------------------- |
| lint + typecheck                                                    | local + CI           | required (already wired)                  | syntactic / type drift                |
| unit + integration                                                  | local + CI           | required (wired in CI since §3 Phase 1)   | logic + isolation regressions         |
| migration-live gate (pending migrations = 0 before deploy proceeds) | CI (deploy job)      | required after §3 Phase 4                 | schema/production drift (see Risk #5) |
| e2e on AI review flow                                               | CI on PR             | required after §3 Phase 4                 | broken critical review/save path      |
| post-edit hook                                                      | local (agent loop)   | not this rollout — configured in Lesson 3 | —                                     |
| visual diff (deterministic)                                         | CI on PR             | optional, not planned                     | rendering regressions                 |
| multimodal visual review                                            | CI on PR             | optional, not planned                     | visual issues classic diff misses     |
| pre-prod smoke                                                      | between merge + prod | optional, not planned                     | environment-specific failures         |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- No pure unit tests were added by Phase 1 — both Risk #1 and Risk #2 were graded "integration" (a mocked Supabase client would lie about RLS or the save endpoint's real behavior by construction; see §1 principle #1 and the Risk Response Guidance's "likely cheapest layer" column). When a future risk genuinely calls for a unit test, follow the harness this rollout established: place the file at `tests/**/*.test.ts`, import `describe`/`it`/`expect` explicitly from `"vitest"` (`vitest.config.ts` sets `globals: false`, so no ESLint globals override is needed), and rely on the `@/*` alias plus the `astro:env/server` virtual-module stub already wired into `vitest.config.ts`. Note the config is a plain Vitest config, not Astro's `getViteConfig` — that helper pulls in the `@astrojs/cloudflare` adapter's Vite plugin, which conflicts with Vitest's own use of the `ssr` Vite Environment.

### 6.2 Adding an integration test

- Phase 1 established a two-layer pattern (`tests/integration/risk1-rls-isolation.test.ts`, `risk1-api-route-ownership.test.ts`, `risk2-review-save-contract.test.ts`):
  - **RLS-policy layer** — talk to the database directly with a plain `@supabase/supabase-js` client signed in as a real seeded user (`tests/helpers/auth.ts`'s `seedUser` + `signInDirect`). Never mock the client here — a mock would lie about RLS by construction.
  - **Route-wiring layer** — invoke the real exported route handler directly (e.g. `import { POST } from "@/pages/api/flashcards"`) with a real `Request`/`Headers` object and a minimal fake `APIContext` from `tests/helpers/api-context.ts`'s `buildContext`, authenticated via `tests/helpers/auth.ts`'s `getAuthCookieHeader` (signs in once with a plain client, then replays the resulting tokens through a throwaway `@supabase/ssr` server client to get the exact cookie encoding the app's own `createClient()` expects). This exercises the real handler, the real `@supabase/ssr` client, and a real local Supabase instance — only the outermost Astro HTTP transport is faked.
  - Both layers need a running `supabase start`; `tests/setup/env.ts` sources credentials via `supabase status -o env` as Vitest's `globalSetup`, so every worker process inherits them.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4 (AI review flow smoke).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2 for the ownership-check / IDOR pattern.

### 6.5 Adding a test for the account-deletion / retention boundary

- TBD — see §3 Phase 3.

### 6.6 Per-rollout-phase notes

(Filled in by `/10x-implement`'s final sub-phase as each rollout phase lands.)

**Phase 1 — mutation testing pass (ad hoc, 2026-07-04).** Ran Stryker
(`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`, config at
`stryker.conf.json`, `coverageAnalysis: "off"` because the test suite hits a
real local Supabase instance) scoped to the three routes Risk #1/#2 tests
cover: `src/pages/api/flashcards/{index.ts,[id].ts,[id]/review.ts}`.

Two config gotchas worth keeping in mind if this is re-run: Stryker's sandbox
copy chokes on the `.claude/skills/*` symlinks (added `.claude`, `.agents`,
`context` to `ignorePatterns`), and Stryker normalizes backslashes out of
`mutate` globs before matching, so `\[id\].ts`-style escaping for a literal
bracket in a filename silently fails — use a character-class escape instead:
`[[]id[]].ts`.

Initial score 65.43% (162 mutants, 8 survived) surfaced two real gaps in
`index.ts` (the POST `/api/flashcards` save endpoint): the `!supabase` /
`!user` auth guards and the DB-insert-failure branch were never independently
exercised, because the existing Risk #1/#2 tests only ever drive this route
with a valid session and a successful insert. Closed with three tests:

- `tests/integration/risk1-api-route-ownership.test.ts` — added a
  no-session-cookie request asserting 401 (real integration; kills the
  `!user` mutant).
- `tests/unit/risk1-risk2-save-endpoint-hermetic.test.ts` — new file, two
  hermetic tests (mocked `@/lib/supabase` client): missing-client 401, and
  insert-failure 500. Per §1/§4's hermetic-vs-integration split, these
  branches can't be triggered by real local Supabase on demand, so mocking
  the client factory here doesn't lie about RLS — neither branch depends on
  RLS/DB behavior.

Result: `index.ts` 44.12% → 79.41% (7 → 3 survived). Final score 72.84%
(118 killed, 4 survived, 0 errors/timeouts).

Four mutants consciously left surviving (per §6's "would this hurt a user or
the business?" rubric):

- `index.ts:8` (×2) — dropping the `Content-Type` header / response init
  object. Cosmetic; no test in this project asserts on response headers, and
  no client here depends on the header being present.
- `index.ts:36` (`!parsed.success`) — the invalid-body branch. Correctly out
  of scope: Risk #7 / input-boundary hardening is rollout Phase 2's job, not
  Phase 1's.
- `review.ts:20` (`SRS_COLUMNS` truncated to `""`) — every review test in
  this rollout grades a never-studied card, so the repeat-review path (which
  needs the _prior_ SRS state to schedule correctly) never surfaces this.
  This isn't a Risk #1/#2 scenario — it's an SRS-scheduling-correctness risk
  not currently on the §2 Risk Map — so it's flagged here rather than patched
  into this phase's test files. Candidate for a `/10x-lesson` entry or a new
  risk-map row at the next `/10x-test-plan --refresh`.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Exact wording/content of AI-generated flashcards** — the model's output is non-deterministic; asserting on specific generated text would be flaky and meaningless. Re-evaluate if the product moves to a template-based or otherwise deterministic generator. (Source: interview Q5.)
- **Live Supabase/Cloudflare integration behavior** — this rollout tests our code's use of these services (local Supabase for RLS, mocked HTTP edges), not the vendor platforms' own correctness. Re-evaluate if a vendor-specific outage repeatedly causes incidents. (Source: interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-03
- Stack versions last verified: 2026-07-03 (Context7 unavailable — quota exceeded; local manifest inspection only)
- AI-native tool references last verified: 2026-07-03 (none planned this rollout)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
