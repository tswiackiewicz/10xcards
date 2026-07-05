# Authorization & Input-Boundary Hardening Implementation Plan

## Overview

Close out Rollout Phase 2 of `context/foundation/test-plan.md`: prove Risk #3
(IDOR — an authenticated user reads/edits/deletes another user's flashcard by
manipulating a resource ID) and Risk #7 (empty, whitespace-only, or over-cap
input to AI generation) are both actually protected, not merely assumed.

## Current State Analysis

Per `context/changes/testing-authorization-input-boundary-hardening/research.md`:

- **Risk #3 is already well-covered for the "belongs to someone else"
  case.** All three by-id flashcard routes (`PATCH`/`DELETE
src/pages/api/flashcards/[id].ts`, `PATCH
src/pages/api/flashcards/[id]/review.ts`) enforce ownership RLS-only — no
  route adds an app-level `.eq("user_id", user.id)` filter — and
  `tests/integration/risk1-api-route-ownership.test.ts` already asserts that
  user B's request against user A's real card ID returns `404 {error:
"not_found"}` for all three routes. There is no `GET`-by-id route in the
  app. The gap: nothing yet exercises a **syntactically-valid but
  never-created** ID, so no test currently proves the "doesn't exist" case
  and the "exists but isn't mine" case are byte-identical from the outside —
  only that each, tested in isolation, happens to be a 404.
- **Risk #7 has zero existing test coverage.** The validation itself is
  already correct: `generateRequestSchema` in `src/lib/flashcards/schemas.ts`
  (`text: z.string().trim().min(1).max(MAX_INPUT_CHARS)`, `MAX_INPUT_CHARS =
10000`) trims before checking length, so whitespace-only input is
  correctly rejected as empty rather than passing a naive `min(1)` check.
  `src/pages/api/flashcards/generate.ts`'s `mapInputError` maps the Zod issue
  code to a typed `ApiErrorCode` (`too_small` → `empty_input`, `too_big` →
  `too_long`), and validation always runs before `generateCandidates(...)`
  (the only call site that reaches OpenRouter) — an invalid input can never
  spend a provider request. `mapInputError` is currently a private,
  unexported function.

## Desired End State

- A new integration test proves, for all three by-id routes, that a
  never-created UUID and another user's real card ID produce the identical
  `404 {error: "not_found"}` response — closing the equivalence gap research
  identified.
- A new unit test proves `generateRequestSchema` + the error-code mapping
  correctly reject empty, whitespace-only, and over-cap input, and accept
  input at exactly the cap — with no HTTP server, no Supabase, no OpenRouter
  involved.
- Stryker mutation testing has run against the touched/covered files
  (`generate.ts`, `schemas.ts`, plus the existing by-id routes already in
  scope) and every surviving mutant has an explicit "would this hurt a user
  or the business?" verdict recorded.
- `test-plan.md` §3 shows Rollout Phase 2 as `complete`, and its cookbook
  (§6.2, §6.4, §6.6) reflects the patterns this phase established.

**Verification**: `npm test` passes (full suite, local Supabase running);
`npm run lint` and `npx astro check` are clean; the Stryker HTML report for
the touched files shows every survivor annotated in `test-plan.md` §6.6.

### Key Discoveries

- `src/pages/api/flashcards/[id].ts:31` and
  `src/pages/api/flashcards/[id]/review.ts:36` both validate the URL param
  with `const idSchema = z.uuid();` — any well-formed v4 UUID that was never
  inserted passes this schema and reaches the RLS-scoped query, which is
  exactly the "genuinely nonexistent" case the equivalence test needs.
- None of the three by-id routes' negative-path tests mutate real state on
  failure — a denied `DELETE` still leaves the row in place (RLS blocks the
  delete, 0 rows affected) — so a single seeded card can safely be the
  target of all three routes' negative-path assertions in one test file
  without ordering hazards.
- `mapInputError` (`generate.ts:20-25`) takes a `ZodError` and is naturally
  exercised by calling `generateRequestSchema.safeParse(...)` first and
  passing its `.error` straight into `mapInputError` — no need to hand-build
  a `ZodError`.
- `vitest.config.ts` stubs `astro:env/server` globally, so importing
  `generate.ts` directly in a unit test (to reach the now-exported
  `mapInputError`) works without booting Astro; `generateCandidates` and
  `createClient` are imported by `generate.ts` but never called in this
  test, so no mocking is needed.
- `stryker.conf.json`'s `mutate` array already covers
  `src/pages/api/flashcards/index.ts`, `[id].ts`, `[id]/review.ts` from
  Phase 1 — only `generate.ts` and `schemas.ts` need to be added for this
  phase's scope.

## What We're NOT Doing

- Not adding a `GET /api/flashcards/[id]` route or any test for it — it
  doesn't exist in the app.
- Not adding an app-level ownership check (`.eq("user_id", ...)`) to any
  route — out of scope; the risk is about proving the RLS-only pattern
  already holds, not changing the pattern.
- Not adding a static/architectural test asserting routes use the
  session-bound Supabase client rather than an elevated one — deferred per
  user decision; no route currently has this bypass, and this project's
  test stack has no precedent for source-inspection-style tests. Logged
  below under Open Risks & Assumptions for a future rollout phase or
  `/10x-lesson` entry.
- Not testing `GenerateView.tsx`'s `ERROR_COPY` map — out of scope per user
  decision; the API-level typed `ApiErrorCode` contract is the cheapest
  layer with real signal for this Medium/Medium-priority risk, and this
  project has no component-test layer.
- Not touching the client-side character counter in `GenerateView.tsx` — it
  already compares trimmed length (fixed in the `ai-card-generation`
  archive) and isn't part of either risk.
- Not modifying `manualCardSchema`, `saveRequestSchema`, or `reviewSchema` —
  only `generateRequestSchema` and its route's error mapping are Risk #7's
  scope.

## Implementation Approach

Two independent, additive test files — one integration, one unit — following
the exact two-layer pattern and helper reuse `test-plan.md` §6.2 already
established. One minimal production change (exporting `mapInputError`) makes
the mapping directly testable without an HTTP round-trip, avoiding both the
mirror-implementation anti-pattern (re-encoding the mapping logic in the
test) and an unnecessary integration test for logic that needs no live
infra. A scoped Stryker pass follows, mirroring Phase 1's precedent exactly.
The phase closes with the same cookbook-sync step Phase 1 used.

## Phase 1: Risk #3 — IDOR not-found-vs-not-owned equivalence

### Overview

Add an integration test proving a never-created card ID and another user's
real card ID produce the identical 404 response across all three by-id
routes.

### Changes Required:

#### 1. New equivalence test file

**File**: `tests/integration/risk3-idor-not-found-equivalence.test.ts`

**Intent**: Prove, for `PATCH /api/flashcards/[id]`, `DELETE
/api/flashcards/[id]`, and `PATCH /api/flashcards/[id]/review`, that a
syntactically-valid but never-created UUID and a real card ID owned by a
different user produce the exact same response (status + body) — the
equivalence Risk #3 requires, not just "both happen to 404."

**Contract**: Follow the exact `seedUser()` → `getAuthCookieHeader()` →
`buildContext()` harness from `tests/helpers/auth.ts` and
`tests/helpers/api-context.ts`, mirroring the fixture setup in
`tests/integration/risk1-api-route-ownership.test.ts` (`beforeAll` seeds
user A and user B, A creates one real card via the real `POST` handler,
`afterAll` cleans up both users). For each of the three routes: define one
shared expected-response constant (`{ status: 404, body: { error:
"not_found" } }`), then assert both the never-created-UUID call (any
caller, e.g. A's own cookie) and the other-user's-real-ID call (B's cookie
against A's card) each equal that same constant — making the equivalence
explicit in the assertions themselves, not just implied by two separately
hard-coded expectations. Import `PATCH` (aliased) and `DELETE` from
`@/pages/api/flashcards/[id]`, `PATCH` (aliased) from
`@/pages/api/flashcards/[id]/review`, per the existing risk1 test's import
pattern. Generate the never-created UUID with the runtime global
`crypto.randomUUID()` (Node 24 exposes Web Crypto globally — no import
needed).

### Success Criteria:

#### Automated Verification:

- New test file passes: `npm test -- risk3-idor-not-found-equivalence`
- Full suite still passes: `npm test`
- Lint is clean: `npm run lint`
- Type check is clean: `npx astro check`

#### Manual Verification:

- Local Supabase is running (`supabase status`) before the run.
- Confirm in the test output that both the never-created-UUID case and the
  other-user's-ID case appear as distinct assertions within the same test
  block, not collapsed into a single ambiguous check.

---

## Phase 2: Risk #7 — input-boundary unit tests

### Overview

Export `mapInputError` and add a unit test covering the four boundary
values named in the PRD acceptance criterion, with no HTTP/DB/provider
involvement.

### Changes Required:

#### 1. Export the error-mapping helper

**File**: `src/pages/api/flashcards/generate.ts`

**Intent**: Make `mapInputError` directly importable so its
Zod-issue-code → `ApiErrorCode` mapping can be unit tested without an HTTP
round-trip.

**Contract**: Add `export` to the existing `function mapInputError(error:
ZodError): ApiErrorCode` declaration (`generate.ts:20`). No signature or
behavior change.

#### 2. New input-boundary unit test file

**File**: `tests/unit/risk7-generate-input-boundary.test.ts`

**Intent**: Prove `generateRequestSchema` and `mapInputError` together
reject empty, whitespace-only, and over-cap input with the correct typed
error code, and accept input at exactly the cap — the four boundary values
the PRD acceptance criterion and Risk #7 name.

**Contract**: Import `generateRequestSchema` and `MAX_INPUT_CHARS` from
`@/lib/flashcards/schemas`, and `mapInputError` from
`@/pages/api/flashcards/generate` (after change 1 above). For each of the
four cases — `""`, a mixed-whitespace string (spaces/tabs/newlines), a
string of exactly `MAX_INPUT_CHARS` characters, and a string of
`MAX_INPUT_CHARS + 1` characters — call `generateRequestSchema.safeParse({
text })` and assert `.success` (`true` for the exactly-at-cap case, `false`
for the other three); for the three failing cases, additionally pass
`result.error` into `mapInputError` and assert it returns `"empty_input"`
for the two empty/whitespace cases and `"too_long"` for the over-cap case.
No mocking, no `buildContext`, no Supabase — this is a pure function test.

### Success Criteria:

#### Automated Verification:

- New test file passes: `npm test -- risk7-generate-input-boundary`
- Full suite still passes: `npm test`
- Lint is clean: `npm run lint`
- Type check is clean: `npx astro check`

#### Manual Verification:

- Confirm the test file requires no `tests/setup/env.ts` globalSetup
  side-effects to pass (it should still pass if run in isolation without a
  live Supabase instance) — proving this is genuinely the cheap unit layer,
  not an integration test in disguise.

---

## Phase 3: Mutation-testing pass

### Overview

Repeat Phase 1 (rollout)'s selective Stryker gate, scoped to the files this
phase touches or that Phase 1 left partially covered for these risks.

### Changes Required:

#### 1. Widen the Stryker mutation scope

**File**: `stryker.conf.json`

**Intent**: Include the generation endpoint and its shared schema module in
the mutation-testing scope, alongside the by-id routes Phase 1 already
covers.

**Contract**: Add `"src/pages/api/flashcards/generate.ts"` and
`"src/lib/flashcards/schemas.ts"` to the existing `mutate` array (leave the
three existing entries untouched).

#### 2. Run Stryker and triage survivors

**Intent**: Run the mutation suite, open the HTML report, and for every
surviving mutant in the newly-added files (and any new survivors in the
by-id routes introduced by Phase 1's test additions) apply the project's
existing rubric: "would this change hurt a user or the business?" — kill
real gaps with a new assertion in the Phase 1/2 test files; record a
one-line rationale for any consciously-left survivor (cosmetic mutants,
mutants in branches genuinely out of this rollout's scope, e.g.
`rate_limited`/`ai_unavailable` provider-error branches if no test drives
them).

**Contract**: No new source files — this step either adds narrowly-targeted
assertions to the Phase 1/2 test files above, or produces a documented list
of accepted survivors for the cookbook (Phase 4).

### Success Criteria:

#### Automated Verification:

- Stryker run completes without errors: `npx stryker run`
- Mutation score for `generate.ts` and `schemas.ts` is reported (no target
  percentage enforced — score is input to the manual triage, not a gate).

#### Manual Verification:

- Every surviving mutant in `generate.ts` and `schemas.ts` has an explicit
  "hurts a user? yes/no" verdict, either resolved by a new assertion or
  recorded as a conscious exclusion.

---

## Phase 4: Cookbook & test-plan sync

### Overview

Update `test-plan.md` to reflect this phase's status and the patterns it
established, and close out `change.md`.

### Changes Required:

#### 1. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Rollout Phase 2 complete now that Risk #3 and #7 are
covered.

**Contract**: In §3 Phased Rollout, set row 2's Status cell to `complete`.

#### 2. Cookbook — by-id ownership pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Record the not-found-vs-not-owned equivalence pattern so a
future by-id route follows it without re-deriving it.

**Contract**: Fill in §6.4 ("Adding a test for a new API endpoint") with
the shared-expected-response equivalence pattern from Phase 1 (this plan),
replacing its current "TBD" placeholder.

#### 3. Cookbook — input-boundary unit-test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Record that boundary validation on a Zod schema is tested as a
pure unit test against the exported schema/mapping, no HTTP layer.

**Contract**: Add a short note to §6.1 ("Adding a unit test") describing
the `generateRequestSchema` + `mapInputError` pattern from Phase 2 as the
project's first genuine unit test, alongside the existing hermetic-test
note.

#### 4. Cookbook — mutation-testing results

**File**: `context/foundation/test-plan.md`

**Intent**: Record Phase 3's findings the same way Phase 1's mutation pass
was recorded.

**Contract**: Add a "Phase 2 — mutation testing pass" entry under §6.6,
listing the before/after mutation scores for `generate.ts` and
`schemas.ts` and the rationale for any consciously-left survivors —
matching the existing Phase 1 entry's format.

#### 5. Change lifecycle close-out

**File**: `context/changes/testing-authorization-input-boundary-hardening/change.md`

**Intent**: Advance the change's lifecycle status now that implementation
is complete.

**Contract**: Set `status: implemented` (or `impl_reviewed` if
`/10x-impl-review` runs first) and `updated: <today>`.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` §3 row 2 reads `complete`: manual grep confirms no
  remaining `TBD` in §6.4 for this phase's pattern.

#### Manual Verification:

- A future reader of §6.4 and §6.1 can add a new by-id route test or a new
  Zod-schema unit test without re-reading this plan or the research doc.

---

## Testing Strategy

### Unit Tests:

- `generateRequestSchema` rejects `""`, whitespace-only, and
  `MAX_INPUT_CHARS + 1`; accepts exactly `MAX_INPUT_CHARS`.
- `mapInputError` maps `too_small` → `empty_input`, `too_big` → `too_long`.

### Integration Tests:

- A never-created UUID and another user's real card ID produce the
  identical 404 response, for `PATCH [id]`, `DELETE [id]`, and `PATCH
[id]/review`.

### Manual Testing Steps:

1. Run `supabase status` to confirm local Supabase is up before running the
   integration suite.
2. Run `npm test` and confirm all existing Phase 1 tests still pass
   alongside the two new files.
3. Open the Stryker HTML report after Phase 3 and manually confirm every
   survivor in `generate.ts`/`schemas.ts` has a recorded verdict.

## Performance Considerations

None — this phase adds tests only; no production code path changes except
adding one `export` keyword.

## Migration Notes

None — no schema or data changes.

## Open Risks & Assumptions

- **Deferred defense-in-depth check**: every by-id route's ownership
  enforcement depends on always using the session-bound Supabase client.
  No route currently violates this, so it's out of scope here per user
  decision, but a future route that accidentally used an elevated client
  would silently reintroduce Risk #3 without any test catching it. Flag for
  a future `/10x-test-plan --refresh` or a `/10x-lesson` entry.
- **Stryker's full-suite mutation run may surface survivors outside this
  phase's two risks** (e.g. in `generate.ts`'s `rate_limited`/
  `ai_unavailable` branches, or in `schemas.ts`'s other schemas) — Phase 3
  scopes triage to `generate.ts` and `schemas.ts` but any survivor found
  there must still be individually judged, not blanket-ignored, per the
  project's existing rubric.

## References

- Research: `context/changes/testing-authorization-input-boundary-hardening/research.md`
- Risk definitions: `context/foundation/test-plan.md` §2 (Risk Map, Risk Response Guidance)
- Prior pattern: `tests/integration/risk1-api-route-ownership.test.ts`
- Prior pattern: `tests/unit/risk1-risk2-save-endpoint-hermetic.test.ts`
- Prior mutation-testing precedent: `context/foundation/test-plan.md` §6.6 ("Phase 1 — mutation testing pass")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #3 — IDOR not-found-vs-not-owned equivalence

#### Automated

- [x] 1.1 New test file passes: `npm test -- risk3-idor-not-found-equivalence` — 0386d15
- [x] 1.2 Full suite still passes: `npm test` — 0386d15
- [x] 1.3 Lint is clean: `npm run lint` — 0386d15
- [x] 1.4 Type check is clean: `npx astro check` — 0386d15

#### Manual

- [x] 1.5 Local Supabase running before the run — 0386d15
- [x] 1.6 Both equivalence cases appear as distinct assertions in the test output — 0386d15

### Phase 2: Risk #7 — input-boundary unit tests

#### Automated

- [x] 2.1 New test file passes: `npm test -- risk7-generate-input-boundary` — ba366aa
- [x] 2.2 Full suite still passes: `npm test` — ba366aa
- [x] 2.3 Lint is clean: `npm run lint` — ba366aa
- [x] 2.4 Type check is clean: `npx astro check` — ba366aa

#### Manual

- [x] 2.5 Test file passes without a live Supabase instance — ba366aa

### Phase 3: Mutation-testing pass

#### Automated

- [x] 3.1 Stryker run completes without errors: `npx stryker run` — ab4ba5b
- [x] 3.2 Mutation score reported for `generate.ts` and `schemas.ts` — ab4ba5b

#### Manual

- [x] 3.3 Every surviving mutant in `generate.ts`/`schemas.ts` has a recorded verdict — ab4ba5b

### Phase 4: Cookbook & test-plan sync

#### Automated

- [x] 4.1 `test-plan.md` §3 row 2 reads `complete`; no remaining `TBD` in §6.4 for this pattern

#### Manual

- [x] 4.2 §6.4 and §6.1 are usable by a future reader without re-reading this plan
