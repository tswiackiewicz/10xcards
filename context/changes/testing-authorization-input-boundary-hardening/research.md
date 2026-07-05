---
date: 2026-07-05T19:45:17+02:00
researcher: Claude Code
git_commit: 3be9b3bbff579dd9772932cb3682aaacfb6f4bbb
branch: master
repository: tswiackiewicz/10xcards
topic: "Rollout Phase 2 — Authorization (IDOR, Risk #3) & input-boundary hardening (Risk #7)"
tags: [research, codebase, idor, authorization, input-validation, flashcards, generate-endpoint]
status: complete
last_updated: 2026-07-05
last_updated_by: Claude Code
---

# Research: Authorization & input-boundary hardening (Rollout Phase 2)

**Date**: 2026-07-05T19:45:17+02:00
**Researcher**: Claude Code
**Git Commit**: 3be9b3bbff579dd9772932cb3682aaacfb6f4bbb
**Branch**: master
**Repository**: tswiackiewicz/10xcards

## Research Question

Ground Risk #3 (IDOR — an authenticated user reads/edits/deletes another
user's flashcard by manipulating a resource ID) and Risk #7 (empty,
whitespace-only, or over-cap input to AI generation) in the actual code:
which routes/clients enforce ownership, the exact validation rule and where
it runs, and what Phase 1 (Rollout Phase "critical-path-coverage") already
covers so Phase 2 doesn't duplicate it.

## Summary

**Risk #3 (IDOR) is unexpectedly already well-covered by Phase 1**, for the
three by-ID routes that exist. Ownership is enforced **RLS-only** — no route
handler adds an explicit `.eq("user_id", user.id)` filter — and Phase 1's
`tests/integration/risk1-api-route-ownership.test.ts` already asserts that
user B's request against user A's card ID returns 404 for `PATCH
/api/flashcards/[id]`, `DELETE /api/flashcards/[id]`, and `PATCH
/api/flashcards/[id]/review`. There is no `GET /api/flashcards/[id]` route
in the app at all — flashcards are only ever fetched as a list (out of IDOR
scope; list-scoping is a different risk). The genuine gap Phase 2 must close
is narrower than the risk-map entry implies: nothing yet proves that
"resource doesn't exist" and "resource exists but belongs to someone else"
produce the _same, indistinguishable_ response (both currently 404, but
never asserted against each other) — the Risk Response Guidance's exact
"must challenge" framing (ownership checked per-resource, not merely absent
from the list) is satisfied by existing tests; what's missing is the
explicit not-found-vs-not-owned equivalence check, which is a subtler but
real signal-gap.

**Risk #7 (input-boundary) is completely untested** — confirmed zero
existing test references validation, `generate.ts`, or
`generateRequestSchema`. The good news: the validation itself is already
correct per the PRD acceptance criterion. `src/lib/flashcards/schemas.ts`
defines `generateRequestSchema = z.object({ text: z.string().trim().min(1).max(MAX_INPUT_CHARS) })`
with `MAX_INPUT_CHARS = 10000`, and Zod applies `.trim()` before the
length checks — so whitespace-only input is correctly rejected as empty,
not accepted as length-1. Validation runs strictly before any OpenRouter
call (`generate.ts`), so no boundary input can spend a provider request.
This is exactly the "unit test the schema, no live provider call needed"
layer the test-plan predicted.

## Detailed Findings

### Risk #3 — IDOR / per-resource ownership

**Route inventory** (all in `src/pages/api/flashcards/`):

- `PATCH`/`DELETE` in `src/pages/api/flashcards/[id].ts` — **no GET-by-id
  route exists.**
- `PATCH` in `src/pages/api/flashcards/[id]/review.ts`.
- `POST` in `src/pages/api/flashcards/index.ts` — creation only, not a
  by-ID surface, not in IDOR scope (already uses `user.id` from the
  verified session to stamp `user_id`, never trusts the request body).

**Ownership enforcement pattern — RLS-only, confirmed identical across all
three by-ID handlers:**

- Every by-id query filters `.eq("id", id.data)` **and nothing else** — no
  `user_id` filter is ever added in application code. The session-bound
  Supabase client (`createClient()`, `src/lib/supabase.ts:6-25`, built from
  the request's cookies via `@supabase/ssr`) is used throughout — never a
  service-role/elevated client.
- `src/pages/api/flashcards/[id].ts:50-60` (PATCH) and `:84-90` (DELETE) —
  each contains an explicit comment: "A 0-row result means the id doesn't
  exist or isn't ours (RLS-hidden) — that's not-found, not success," then
  returns `404 { error: "not_found" }` on 0 rows.
  ([permalink PATCH](https://github.com/tswiackiewicz/10xcards/blob/3be9b3bbff579dd9772932cb3682aaacfb6f4bbb/src/pages/api/flashcards/%5Bid%5D.ts#L50-L60))
- `src/pages/api/flashcards/[id]/review.ts:53-63` (read current SRS state)
  and `:69-75` (write) — same pattern: `.eq("id", id.data)` only, `null`/0
  rows collapses "not found" and "not owned" into one `404 { error:
"not_found" }`.

**Not-found vs. not-owned distinguishability**: none anywhere in the code —
by design, both cases return the identical `404 { error: "not_found" }`.
There is no 403 in any of these handlers.

**RLS policies** — `supabase/migrations/20260624185919_create_flashcards.sql`:

- SELECT (line 52-56): `using (auth.uid() = user_id)`
- INSERT (line 58-62): `with check (auth.uid() = user_id)`
- UPDATE (line 64-69): `using (auth.uid() = user_id) with check (auth.uid() = user_id)` — both clauses present, which the `flashcard-store-rls` archive flagged as load-bearing (an UPDATE policy missing `WITH CHECK` would let a user reassign `user_id` to themselves on someone else's row).
- DELETE (line 71-75): `using (auth.uid() = user_id)`
- Line 46: `grant select, insert, update, delete on public.flashcards to authenticated;` — no grant to `anon`.

`supabase/migrations/20260701213238_add_srs_state.sql:9-12` adds the
FSRS/SRS columns to the same `flashcards` table (no new table, no new
policy — inherits the four policies above since they're table-level).

**Existing Phase 1 coverage** (already on disk, do not duplicate):

- `tests/integration/risk1-api-route-ownership.test.ts` — real route
  handlers via `buildContext`, two seeded users A and B:
  - Line 34-44: no-cookie POST → 401.
  - Line 71-83: B's PATCH of A's card → 404 `not_found`.
  - Line 99-111: B's review PATCH of A's card → 404 `not_found`.
  - Line 128-139: B's DELETE of A's card → 404 `not_found`.
  - Plus each of A's own successful operations (200) as controls.
- `tests/integration/risk1-rls-isolation.test.ts` — bypasses the route
  layer, hits Supabase directly via `signInDirect`, proving the RLS
  policies themselves (B's select/update/delete never touch A's row;
  anon reads zero rows; A's card is unchanged throughout).

**What Phase 2 must actually add** (the real, non-duplicated gap):

1. A not-found-vs-not-owned equivalence assertion — call each handler once
   with a syntactically-valid but never-created UUID (still passes the
   `z.uuid()` param check) and once with a real card ID owned by another
   user, and assert the two responses are identical (same status, same
   body) — proving the boundary genuinely hides ownership rather than
   coincidentally producing the same string.
2. Re-verification with fresh eyes per the risk map's "must challenge"
   framing, since Risk #3 is a rollout-map risk independent of Phase 1's
   Risk #1/#2 framing — even though the underlying test scenarios overlap,
   Phase 2's job is to confirm this specific risk (ownership-per-resource,
   not list-scoping) is met, which the existing tests do satisfy for the
   three routes that exist.
3. No GET-by-id route exists, so there is nothing to add there — confirmed
   by reading all exports in `src/pages/api/flashcards/[id].ts`.

**Two-user test harness (reuse, do not rebuild)** —
`tests/helpers/auth.ts`: `seedUser()` (service-role admin client),
`signInDirect(user)` (plain signed-in client for direct DB assertions),
`getAuthCookieHeader(email, password)` (signs in, replays tokens through a
throwaway `@supabase/ssr` server client to get the app's exact cookie
encoding), `anonClient()`, `cleanupUser(id)`.
`tests/helpers/api-context.ts`: `buildContext({ method, url, cookieHeader,
body, params })` — minimal fake `APIContext` sufficient to invoke exported
route functions directly. Phase 2's new test (item 1 above) should follow
the identical `seedUser` → `getAuthCookieHeader` → `buildContext` pattern
already established, just adding a never-created-UUID variant alongside
the existing real-other-user's-ID variant.

### Risk #7 — Input-boundary handling on AI generation

**Endpoint**: `src/pages/api/flashcards/generate.ts:27-70` (`POST`).
Sequence: auth check (401) → `OPENROUTER_API_KEY` presence check (503) →
JSON body parse (400 `invalid_input` on parse failure) →
`generateRequestSchema.safeParse(body)` (400, mapped error code, **line
50-53**) → only on success → `generateCandidates(...)` (the sole call site
that reaches OpenRouter, `src/lib/flashcards/generation.ts:70`) → empty
candidate array → 422 `no_cards` → else 200.

**Validation is strictly upstream of any provider call** — there is no
path where an invalid `safeParse` result still reaches
`generateCandidates`. This directly satisfies the "must challenge" framing
in the test-plan's Risk Response Guidance (validation runs before spending
a provider request).

**Schema** — `src/lib/flashcards/schemas.ts`:

```ts
export const MAX_INPUT_CHARS = 10000; // schemas.ts:5
export const generateRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_INPUT_CHARS), // schemas.ts:13-15
});
```

Zod applies `.trim()` before `.min()`/`.max()` run, so:

- `""` → trimmed `""` → fails `min(1)` (Zod issue `too_small`).
- `"   "` (whitespace-only) → trimmed `""` → same `too_small` path — this
  is the exact case the risk-map worries a naive length check would miss,
  and it's already handled correctly.
- A 10,000-char string passes; a 10,001-char string fails `max()` (Zod
  issue `too_big`).

**Error-code mapping** — `generate.ts:20-25`:

```ts
function mapInputError(error: ZodError): ApiErrorCode {
  const issue = error.issues.find((i) => i.path[0] === "text") ?? error.issues[0];
  if (issue.code === "too_small") return "empty_input";
  if (issue.code === "too_big") return "too_long";
  return "invalid_input";
}
```

This function is **not exported** — testing the exact Zod-issue-code →
`ApiErrorCode` mapping requires either exporting it or testing through the
route handler.

**Response shapes** — all three boundary cases return HTTP 400 with
`{ error: <ApiErrorCode> }`:

| Input         | Zod issue   | `ApiErrorCode` | Status |
| ------------- | ----------- | -------------- | ------ |
| `""`          | `too_small` | `empty_input`  | 400    |
| `"   "`       | `too_small` | `empty_input`  | 400    |
| 10,001+ chars | `too_big`   | `too_long`     | 400    |

The API body itself is a machine-readable code, not prose — the
human-readable "explanatory message" the PRD acceptance criterion asks for
lives client-side in `src/components/flashcards/GenerateView.tsx:19-25`
(`ERROR_COPY` map, e.g. `empty_input: "Please paste some text first."`,
`too_long: "Text is too long — keep it under 10,000 characters."`). A
pure API-level test should assert against the typed `ApiErrorCode` values;
asserting "explanatory" end-to-end would additionally need to check
`ERROR_COPY`.

**Reusable/importable for a unit test** — `generateRequestSchema` and
`MAX_INPUT_CHARS` are named, side-effect-free exports from
`src/lib/flashcards/schemas.ts`. A unit test can call
`generateRequestSchema.safeParse({ text: "..." })` directly with no HTTP
server, no Supabase mock, no OpenRouter mock — exactly the "likely cheapest
layer: unit" call in the test-plan's Risk Response Guidance.

**PRD alignment confirmed, no divergence**: `context/foundation/prd.md:77`
("Empty or unusable input produces an explanatory message, not an
empty/failed result") and `prd.md:186-187` ("input capped at 10k chars
(`400 too_long` above the cap)") match the code's `MAX_INPUT_CHARS = 10000`
exactly.

**Existing test coverage**: zero. Searched all of `tests/` (`unit/`,
`integration/`) for "empty", "whitespace", "too_long", "cap",
`generateRequestSchema`, `generate.ts` — no hits. Confirmed by
`test-plan.md`'s own Phase 1 cookbook notes, which explicitly scope Risk #7
out of Phase 1 (§6.6, index.ts's `!parsed.success` branch called out as
"Rollout Phase 2's job, not Phase 1's").

## Code References

- `src/pages/api/flashcards/[id].ts:19-63` — PATCH by-id, RLS-only ownership, 404 collapse
- `src/pages/api/flashcards/[id].ts:65-93` — DELETE by-id, same pattern
- `src/pages/api/flashcards/[id]/review.ts:24-78` — PATCH review, same pattern, includes a read step
- `src/pages/api/flashcards/index.ts:16-55` — POST create, `user_id` stamped from session (not an IDOR surface)
- `src/lib/supabase.ts:6-25` — session-bound `createClient()` used by every route above
- `supabase/migrations/20260624185919_create_flashcards.sql:46-75` — grants + four RLS policies
- `supabase/migrations/20260701213238_add_srs_state.sql:9-12` — SRS columns, inherits existing policies
- `tests/integration/risk1-api-route-ownership.test.ts:34-152` — existing cross-user 404 assertions for all three by-id routes
- `tests/integration/risk1-rls-isolation.test.ts:45-84` — existing raw-RLS cross-user assertions
- `tests/helpers/auth.ts` — `seedUser`, `signInDirect`, `getAuthCookieHeader`, `anonClient`, `cleanupUser`
- `tests/helpers/api-context.ts:20-41` — `buildContext`
- `src/pages/api/flashcards/generate.ts:27-70` — generation endpoint, validation-before-provider-call
- `src/pages/api/flashcards/generate.ts:20-25` — `mapInputError` (not exported)
- `src/lib/flashcards/schemas.ts:5,13-15` — `MAX_INPUT_CHARS`, `generateRequestSchema`
- `src/lib/flashcards/generation.ts:70` — sole OpenRouter fetch call site
- `src/components/flashcards/GenerateView.tsx:19-25` — `ERROR_COPY` (client-side explanatory text)
- `context/foundation/prd.md:65-77` — US-01 and acceptance criteria
- `context/foundation/prd.md:186-187` — resolved Open Question confirming 10k-char cap

## Architecture Insights

- **Ownership is enforced exclusively at the RLS layer, never redundantly
  in application code**, across every by-id route in this codebase. This
  is a consistent, deliberate pattern (each handler carries an inline
  comment explaining the 0-row → 404 reasoning), not an oversight — but it
  means every future by-id route inherits the same risk profile: if a route
  ever used a non-session-bound client (e.g. service-role), the "0 rows ⇒
  RLS hid it" assumption would silently stop holding. Worth flagging as a
  standing invariant for `/10x-plan` to phrase a test around ("assert the
  route uses the session-bound client," not just "assert 404 for a
  cross-user ID" — the latter would still pass even if RLS were
  accidentally bypassed by a service-role client that happened to also
  0-row for an unrelated reason, though no such bypass currently exists).
- **Validation-before-cost is a repeated pattern** in this codebase (also
  seen in the Phase 1 archive's save-endpoint hermetic tests) — Zod
  `safeParse` always gates any expensive/external call. Risk #7's test
  should exploit this: a unit test against the schema alone is sufficient
  and faster than an integration test that would otherwise need to mock or
  hit OpenRouter.
- **Error codes are typed and machine-readable (`ApiErrorCode`) at the API
  boundary; human prose is a client-side concern** (`ERROR_COPY`). This
  mirrors Risk #6's guidance elsewhere in the test-plan (assert an
  allowed-fields/allowed-values schema, not substrings) — the same
  allowed-value-set discipline applies naturally to Risk #7's error codes.

## Historical Context (from prior changes)

- `context/archive/2026-06-24-flashcard-store-rls/plan.md` — original RLS
  design rationale: UPDATE policies need both `USING` and `WITH CHECK` to
  prevent a user reassigning `user_id` on someone else's row; verification
  must use the anon key + a real user JWT, never the service-role key (a
  service-role-based check would silently mask an RLS gap).
  `reviews/plan-review.md` documents two review findings, both since fixed: missing signed-out-anon test case, and RLS-vs-GRANT confusion (a missing GRANT presents as "permission denied for table," which looks like an RLS failure but isn't one).
- `context/archive/2026-06-25-ai-card-generation/plan.md` — original
  design for `generateRequestSchema` (trim/min/max), the `ApiErrorCode`
  set, and the endpoint's error-branch mapping — this is the design Phase 2
  now needs to test, unchanged since it shipped.
  `reviews/impl-review.md` records a fixed client-side counter mismatch
  (untrimmed vs. trimmed length) and an added 20s provider-fetch timeout —
  neither affects the server-side validation boundary Phase 2 targets.
- `context/archive/2026-07-04-testing-critical-path-coverage/` (Phase 1) —
  confirms the exact scope of what's already tested for Risk #3-adjacent
  ownership (three by-id routes, all covered) and explicitly defers Risk #7
  input-boundary testing to this phase (§6.6 cookbook note: the
  `!parsed.success` branch in `index.ts` "is correctly out of scope: Risk
  #7 / input-boundary hardening is rollout Phase 2's job, not Phase 1's").

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Map), §2 Risk Response
  Guidance rows #3 and #7, §3 Phased Rollout row 2 — the frozen strategy
  this research grounds.
- `context/archive/2026-07-04-testing-critical-path-coverage/research.md`
  and `plan.md` — Phase 1's own research/plan, referenced throughout above.

## Open Questions

- Should Phase 2 also add a route-level test asserting the flashcard routes
  use the session-bound client (not a hypothetical elevated client), as a
  belt-and-suspenders check against the RLS-only ownership pattern
  becoming unsafe if a future route accidentally used a different client?
  This is a defense-in-depth suggestion, not required by the current risk
  wording — flag for `/10x-plan` to accept or explicitly defer.
- `mapInputError` in `generate.ts` is not exported. `/10x-plan` should
  decide whether Phase 2 tests the Zod-issue-code → `ApiErrorCode` mapping
  by exporting the function for a direct unit test, or only indirectly via
  a thin integration test against the route (consistent with how Phase 1
  handled similarly-unexported helpers).
