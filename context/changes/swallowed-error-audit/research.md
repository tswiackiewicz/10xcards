---
date: 2026-07-10T00:00:00+02:00
researcher: Claude (Sonnet 5)
git_commit: 71c0349
branch: master
repository: tswiackiewicz/10xcards
topic: "Swallowed error audit: try/catch that logs but doesn't propagate to the API response"
tags: [research, codebase, error-handling, api, try-catch]
status: complete
last_updated: 2026-07-10
last_updated_by: Claude (Sonnet 5)
---

# Research: Swallowed error audit (try/catch log-without-propagate pattern)

**Date**: 2026-07-10T00:00:00+02:00
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 71c0349
**Branch**: master
**Repository**: tswiackiewicz/10xcards

## Research Question

Zidentyfikuj połknięty błąd w projekcie. Przeszukaj kod pod kątem wzorca
try/catch, który łapie wyjątek i loguje go, ale nie propaguje go do
odpowiedzi API. (Identify a swallowed error in the project. Search the code
for a try/catch pattern that catches an exception and logs it, but doesn't
propagate it to the API response.)

## Summary

**No instance of the requested anti-pattern exists in the current
codebase.** Three independent search agents (API endpoints, `src/lib/**`,
middleware/shared-error-conventions) and a direct manual grep sweep all
converge on the same result: every `catch` block in `src/pages/api/**`
translates the caught exception into an error `Response` with an
appropriate non-2xx status; `src/middleware.ts` has no try/catch at all;
and the only file anywhere under `src/` that calls `console.*` inside a
catch block (`src/pages/api/cron/purge.ts`) correctly tallies logged
failures into a counter that forces a 500 response when any occur.

The closest related (but non-matching) finding is in
`src/lib/flashcards/generation.ts`: two `catch` blocks silently degrade to
`return []` / `return null` on JSON-parse failure — but neither logs
anything first, so it fails the "log AND swallow" precondition from the
request. It's flagged below as a secondary observation, not the answer to
the question as posed.

## Detailed Findings

### 1. `src/pages/api/**` — API endpoint layer

Every endpoint under `src/pages/api/flashcards/**` and `src/pages/api/cron/purge.ts`
follows the same local convention: a per-file `json(status, body)` +
`fail(status, errorCode)` pair, with every `try/catch` converting the
caught exception into a `fail(...)` call (400 for bad JSON, 401
unauthorized, 429 rate-limited, 500 save/purge failed, 502/503
upstream/service unavailable). No exception is caught and then allowed to
fall through to a 200/success response.

- [src/pages/api/flashcards/generate.ts:44-48](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/generate.ts#L44-L48) — bad JSON body → `fail(400, ...)`
- [src/pages/api/flashcards/generate.ts:56-63](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/generate.ts#L56-L63) — `GenerationError` → `fail(429|502, ...)`
- [src/pages/api/flashcards/index.ts:29-33](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/index.ts#L29-L33) — same JSON-parse guard pattern
- [src/pages/api/flashcards/manual.ts:29-33](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/manual.ts#L29-L33) — same pattern
- [src/pages/api/flashcards/\[id\].ts:37-41](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/%5Bid%5D.ts#L37-L41) — same pattern
- [src/pages/api/flashcards/\[id\]/review.ts:42-46](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/%5Bid%5D/review.ts#L42-L46) — same pattern

### 2. `src/pages/api/cron/purge.ts` — the only file that logs inside a catch

This is the sole file in the whole `src/` tree that calls `console.*`. It's
worth walking through in detail because it's the closest surface candidate
for the anti-pattern, and it turns out to correctly avoid it:

- [src/pages/api/cron/purge.ts:60-63](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/cron/purge.ts#L60-L63) — count-query error: logged via `console.error`, then immediately `return fail(500, "purge_failed")`. Not swallowed.
- [src/pages/api/cron/purge.ts:79-83](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/cron/purge.ts#L79-L83) — claim-delete error: same log-then-fail(500) pattern. Not swallowed.
- [src/pages/api/cron/purge.ts:91-109](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/cron/purge.ts#L91-L109) — per-row `deleteUser` failure inside the batch loop: increments an `errors` counter (line 93), attempts a compensating re-insert, and logs (`console.error`, lines 101-108) if _that_ re-insert also fails. This inner log is genuinely informational-only (the outer `errors` counter was already incremented at line 93 regardless of the re-insert outcome), so it doesn't independently cause a swallow.
- [src/pages/api/cron/purge.ts:116-126](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/cron/purge.ts#L116-L126) — after the loop, logs a summary line, then: `if (errors > 0) return json(500, {...})`, else `return json(200, {...})`. The comment at lines 119-121 explicitly documents _why_: "Any failed deletion means a user is being retained past the 30-day window... rather than being masked by a 200 and only visible in the logs (GDPR liability)." This is the exact opposite of the anti-pattern — a deliberate design decision to avoid it, motivated by GDPR retention risk.

### 3. `src/middleware.ts` — no try/catch present

[src/middleware.ts:6-27](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/middleware.ts#L6-L27) contains no try/catch block. The auth check
(`supabase.auth.getUser()`) is unguarded — an exception there fails loudly
(500 from Astro's default error handling), not silently. The one "soft"
branch is `createClient()` returning `null` when Supabase env vars are
missing ([src/lib/supabase.ts:7-9](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/lib/supabase.ts#L7-L9)), which middleware explicitly checks
for and treats as `user = null` — an intentional, checked sentinel, not a
caught-and-hidden exception.

### 4. `src/lib/**` — business logic layer

No file under `src/lib/` calls `console.*`/any logger at all (confirmed by
direct `grep -rln "console\." src` returning only `purge.ts`), so no
try/catch in this layer can satisfy the "logs the error" half of the
requested pattern by construction.

The only try/catch blocks in `src/lib/` live in
[src/lib/flashcards/generation.ts](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/lib/flashcards/generation.ts):

- Lines 69-88: transport/fetch failure → `throw new GenerationError(...)`. Properly propagates (as a thrown error, for the caller to catch and translate to a response).
- Lines 100-104: `JSON.parse(content)` failure → bare `catch { return []; }`. **No log call.** Silently returns an empty candidate array indistinguishable from "the model legitimately produced zero cards."
- Lines 126-131 (`extractContent`): `response.json()` failure → bare `catch { return null; }`. Same shape, no log call.

These are a real design smell — the API caller ([src/pages/api/flashcards/generate.ts](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/pages/api/flashcards/generate.ts)) can't distinguish "upstream
model returned nothing useful" from "upstream model returned malformed
JSON garbage," both collapse to the same `[]`/empty-candidates response.
But because neither catch logs anything, it does not match the specific
pattern asked for (catch + log + fail-to-propagate). It's noted here as a
secondary, lower-severity finding rather than the primary answer.

## Code References

- `src/pages/api/flashcards/generate.ts:44-63` — JSON-parse and `GenerationError` handling, both correctly propagate to `fail(...)`
- `src/pages/api/flashcards/index.ts:29-33`, `manual.ts:29-33`, `[id].ts:37-41`, `[id]/review.ts:42-46` — repeated JSON-parse guard, all correctly propagate
- `src/pages/api/cron/purge.ts:60-126` — the only file with `console.*` inside catch blocks; every logged failure also forces a non-2xx response
- `src/middleware.ts:6-27` — no try/catch; unguarded auth call fails loudly
- `src/lib/supabase.ts:7-9` — `createClient()` returns `null` on missing env vars, an intentional checked sentinel, not a swallowed exception
- `src/lib/flashcards/generation.ts:100-104,126-131` — silent-degrade-to-empty on JSON-parse failure, no logging (related but non-matching finding)

## Architecture Insights

- **No shared error-response helper exists.** The `json(status, body)` +
  `fail(status, errorCode)` pair is duplicated per-file across every
  endpoint rather than factored into a shared utility. This is consistent
  (same shape everywhere) but means any future endpoint author has to
  remember to replicate the pattern by hand rather than being forced into
  it by a shared wrapper.
- **Domain-scoped error-code unions.** `ApiErrorCode` ([src/lib/flashcards/schemas.ts:61](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/lib/flashcards/schemas.ts#L61))
  and `AccountErrorCode` ([src/lib/account/schemas.ts:2](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/lib/account/schemas.ts#L2), explicitly
  commented as mirroring the flashcards pattern) constrain the `fail()`
  body shape per domain rather than a single global error-code enum.
- **`purge.ts` treats "log but still 200" as an explicit anti-pattern to
  avoid**, motivated by GDPR account-retention liability — the inline
  comments at lines 119-121 name this concern directly. This suggests the
  team is already aware of the swallowed-error risk in principle; it's
  just not present anywhere in the current code.
- **`generation.ts`'s silent-degrade methods are deliberately documented**
  as intentional in the function's docstring ("Returns `[]` on a
  well-formed-but-empty/unusable result; throws `GenerationError` only on
  transport/HTTP failure") — so even the secondary finding may be an
  accepted design tradeoff rather than an oversight, though the JSON-parse
  case specifically conflates "unusable" with "malformed," which the
  docstring doesn't distinguish.

## Historical Context (from prior changes)

No entry in `context/foundation/lessons.md` addresses error propagation or
swallowed exceptions. The closest related prior work is
`context/archive/2026-07-02-account-deletion/` (introduced the
`account_deletions` retention/purge flow that `purge.ts` implements) —
its GDPR-driven design rationale for surfacing purge failures as non-2xx
responses likely predates and motivates the current `purge.ts` code
reviewed above.

## Related Research

None — this is the first research artifact under `context/changes/` for
this topic.

## Open Questions

- Should `generateCandidates`'s JSON-parse-failure branch
  ([src/lib/flashcards/generation.ts:100-104](https://github.com/tswiackiewicz/10xcards/blob/71c0349/src/lib/flashcards/generation.ts#L100-L104)) log the parse error (even
  without PII/source-text leakage) so "model returned garbage" is
  distinguishable from "model returned nothing" in observability, even
  though it doesn't rise to the level of an HTTP-error-worthy failure?
- Is a shared `withErrorHandling`/`handleApiError` helper worth factoring
  out of the six near-identical `json()`/`fail()` pairs, to guarantee by
  construction (not just convention) that future endpoints can't
  regress into a swallowed-error pattern?
