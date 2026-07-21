---
title: "10xCards — Invariant & Aggregate Refactor Plan"
created: 2026-07-21
type: refactor-plan
---

# 10xCards — Invariant & Aggregate Refactor Plan

This is a **plan**, not an implementation. No production code is changed by this document. It builds on `context/domain/01-domain-distillation.md` but re-derives the invariant list from scratch against the current PRD and code, per the task's discovery discipline.

## Step 0 — Context recap

Source docs: `context/foundation/prd.md` (v3), `context/foundation/roadmap.md`, `README.md` — same set verified in the prior distillation. Stack: Astro 6 (`output: server`) + React 19 islands, Supabase (Postgres + Auth, RLS-first), Cloudflare Workers, Zod for input validation. Business logic lives in three layers with no service/repository layer between them today:

- **Persistence**: `supabase/migrations/*.sql` (table shape, CHECK constraints, RLS).
- **Domain rules**: `src/lib/flashcards/*.ts`, `src/lib/account/schemas.ts`.
- **Orchestration**: `src/pages/api/**/*.ts` (one file per operation: auth check → validate → touch Supabase → respond).
- **UI state**: `src/components/flashcards/*.tsx` — for the invariant this plan targets, the UI turns out to be carrying business-rule weight it shouldn't.

## Step 1 — Identify business invariants

Extracted from documents and code, cited at first occurrence:

| #      | Invariant                                                                                                                                                      | Source                                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1     | A flashcard's `question` is 1–1000 chars, `answer` is 1–2000 chars.                                                                                            | DB: `check (char_length(question) between 1 and 1000)` / `check (char_length(answer) between 1 and 2000)`, `supabase/migrations/20260624185919_create_flashcards.sql:14-15`; mirrored in `QUESTION_MAX`/`ANSWER_MAX`, `src/lib/flashcards/schemas.ts:9-10`                                                                                                  |
| I2     | A flashcard is visible and mutable only by its owner (no cross-user access).                                                                                   | Guardrail: "no flashcard is ever visible to another user. Failure here is a regression even if generation works perfectly" (`prd.md:58-59`); RLS policies `flashcards_select_own` etc., `20260624185919_create_flashcards.sql:52-75`                                                                                                                        |
| **I3** | **No AI-generated flashcard enters a user's deck without explicit human acceptance of that specific candidate; rejected/pending candidates leave no trace.**   | Guardrail: "No AI-generated flashcard enters a user's deck without explicit acceptance... there is no silent auto-save" (`prd.md:60-61`); Acceptance Criteria: "Each AI candidate can be individually accepted, edited before accepting, or rejected" / "Only explicitly accepted cards are persisted; rejected candidates leave no trace" (`prd.md:74-75`) |
| I4     | A user who requested account deletion can neither read nor mutate their flashcards until reactivation, but the data is not destroyed.                          | FR-010 (`prd.md:128-130`); `is_pending_deletion()` folded into all four `flashcards` RLS policies, `supabase/migrations/20260702145938_create_account_deletions.sql:61-106`                                                                                                                                                                                 |
| I5     | Account data past the 30-day retention window is permanently and irreversibly erased.                                                                          | FR-010 (`prd.md:129-130`); `RETENTION_DAYS = 30`, `src/pages/api/cron/purge.ts:33`                                                                                                                                                                                                                                                                          |
| I6     | The card presented to study next is deterministically the oldest due-or-never-studied card; grading always transitions to, and persists, a new schedule state. | "deciding which card a user sees next based on their prior recall" (`prd.md:162`); `getNextCard()`, `src/lib/flashcards/study.ts:13-27`; `applyGrade()`, `src/lib/flashcards/srs.ts:73-86`                                                                                                                                                                  |
| I7     | Generation input is capped at 10,000 chars; a single generation call yields at most 15 candidate cards.                                                        | Resolved Open Question: "input capped at 10k chars (`400 too_long` above the cap)" (`prd.md:187`); `MAX_INPUT_CHARS = 10000`, `MAX_CARDS = 15`, `src/lib/flashcards/schemas.ts:5-6`                                                                                                                                                                         |

## Step 2 — Classify and select #1

Scored on: **(a) core-ness** (how load-bearing for the product's stated reason to exist), **(b) spread** (how many files/layers carry a piece of the rule), **(c) enforcement** (Enforced / Declared-only / Violable).

| #      | (a) Core-ness                                                                                                                                                                                 | (b) Spread                                                                                                                                                                                                                                                               | (c) Enforcement                                                                                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1     | Low — basic data hygiene, not a differentiator                                                                                                                                                | 2 layers (DB CHECK, Zod)                                                                                                                                                                                                                                                 | **Enforced**, consistently, both layers                                                                                                                                                                               |
| I2     | High — explicit Guardrail                                                                                                                                                                     | 1 layer really (RLS)                                                                                                                                                                                                                                                     | **Enforced** solidly at the DB layer                                                                                                                                                                                  |
| **I3** | **Highest** — explicitly _the_ product wedge: "cards are AI-generated ... AND human-gated ... That pairing ... is what existing tools rarely combine" (`context/foundation/roadmap.md:26-30`) | **Highest** — stated in PRD (vision), implemented as a client-only state machine (`ReviewCard.status`, `src/components/flashcards/CandidateCard.tsx:4-9`), acted on in `GenerateView.tsx`, then **vanishes entirely** at the one server file that actually persists data | **Declared only / violable** — the project's own test suite says so explicitly (see Step 3)                                                                                                                           |
| I4     | Medium-high — compliance guardrail                                                                                                                                                            | 1 layer (RLS + SECURITY DEFINER fn)                                                                                                                                                                                                                                      | **Enforced** solidly at the DB layer                                                                                                                                                                                  |
| I5     | Medium (compliance-driven, not a differentiator per the prior distillation's subdomain classification)                                                                                        | Very high — spans PRD, `account_deletions` table, `purge.ts`, and an _external_ GitHub Actions schedule outside this repo                                                                                                                                                | Enforced **conditionally on external infrastructure** — a real weakness, but not one a data-modeling/aggregate refactor fixes (the gap is "does the trigger fire," not "is the invariant checked in the wrong place") |
| I6     | High — "the retention half of the value proposition" (`roadmap.md:140`)                                                                                                                       | Low — one shared query function, one route per write                                                                                                                                                                                                                     | **Enforced** consistently, single code path                                                                                                                                                                           |
| I7     | Low — cost/abuse guardrail, not a differentiator                                                                                                                                              | 3 places (Zod constant, system prompt string, `response_format.maxItems`)                                                                                                                                                                                                | Enforced, redundantly but consistently (no observed drift)                                                                                                                                                            |

**Selection: I3.** It is simultaneously the single most core invariant in the system (the PRD frames the whole product around it, not just as one guardrail among several) and the most weakly enforced — not merely "hard to verify" like I5, but **actively contradicted by design**: the persistence endpoint has no representation of "candidate," "review," or "acceptance" at all. I5 was considered as a close second (also compliance-critical and cross-layer), but its weak point is an _operational_ dependency (does an external cron fire on schedule), which no aggregate redesign inside this codebase can fix — it needs monitoring/alerting, not a new domain object. I3's weak point is architectural: the rule is enforced nowhere durable, which is exactly the class of problem an aggregate-with-a-repository is built to solve.

## Step 3 — Diagnosis of I3

**Where the rule is stated (vision layer, no enforcement mechanism implied):**

- `prd.md:60-61` — "No AI-generated flashcard enters a user's deck without explicit acceptance — the user always controls what content is saved; there is no silent auto-save."
- `prd.md:74-76` — "Each AI candidate can be individually accepted, edited before accepting, or rejected" / "Only explicitly accepted cards are persisted; rejected candidates leave no trace in the deck."

**Where it is "enforced" today — client only:**

- `src/components/flashcards/CandidateCard.tsx:4-9` — the _entire_ state machine for a candidate's disposition lives in a UI-local TypeScript interface: `status: "pending" | "accepted" | "rejected"`.
- `src/components/flashcards/CandidateCard.tsx:38-40, 49-51` — Accept/Reject buttons call `onAccept(card.id)` / `onReject(card.id)`, which only ever mutate React state.
- `src/components/flashcards/GenerateView.tsx:112-117` — `acceptCard`/`rejectCard` flip `status` in local state; nothing is sent to the server at the moment of the decision.
- `src/components/flashcards/GenerateView.tsx:87` — `const accepted = cards.filter((c) => c.status === "accepted");` — **this single line is the entire enforcement mechanism for the guardrail.** Everything downstream (line 92-94: the `POST /api/flashcards` body) is built from its result.

**Where enforcement disappears — server layer:**

- `src/pages/api/flashcards/index.ts:24-38` — the handler validates only shape/length via `saveRequestSchema` (`src/lib/flashcards/schemas.ts:24-26`, `min(1).max(MAX_CARDS)` on an array of `{question, answer}`). It has **no concept of "candidate," "generation," or "review" at all.**
- `src/pages/api/flashcards/index.ts:42-49` — every row in the body is unconditionally inserted with `source: "ai"` hardcoded (line 45), regardless of whether it came from a real generation call, was ever shown to the user, or was "accepted" by anything other than being present in the JSON body.

**Where an error is not swallowed — worse, never raised:** there is no `catch`, no validation branch, no domain check anywhere in this path capable of _detecting_ the violation. This is not a swallowed-error case; it is a **missing-check case**: a request that violates the guardrail returns a normal `200 { saved: N }`, indistinguishable at the wire level from a legitimate save. Nothing stops the operation because nothing was ever asked to.

**Independent confirmation — the project's own test documents this as a known, accepted gap, not an oversight:**

> "the AI-review human-gating decision (accept vs. reject/pending) is enforced entirely client-side, before this request is ever constructed ... This test proves the save endpoint persists exactly the accepted (possibly edited) subset it's given — it is NOT a server-side invariant: the endpoint has no concept of accept/reject/pending and would happily save an extra, unexpected card if one were included in the request body."
> — `tests/integration/risk2-review-save-contract.test.ts:1-7`

And the test's own assertion strategy proves it by _absence_, not by _rejection_:

> "A rejected and a pending candidate from the same review batch are deliberately never included — their absence here IS the human-gating proof; the server never sees them at all."
> — `tests/integration/risk2-review-save-contract.test.ts:28-30`

**Inconsistency with a sibling invariant:** I6 (SRS grading) _does_ have a server-side aggregate-like guard (`applyGrade`, single shared function, always mutates and persists together — `src/pages/api/flashcards/[id]/review.ts:65-77`). I3, arguably the more important invariant, has no equivalent. Note also the incidental naming collision: the endpoint that enforces I6 is named `.../[id]/review.ts`, while the PRD's own vocabulary for I3 is "review" (`prd.md:97`) — two different rules share one name in this codebase. This refactor does not rename that endpoint (out of scope — see Step 5 note), but the new vocabulary introduced below deliberately avoids the word "review" to not compound the collision.

## Step 4 — Guardian aggregate design

### Aggregate root: `GenerationBatch`

Represents one AI generation call's output and the disposition of each candidate in it. This is the **single place** I3 is checked from now on — the API route becomes a thin translator, not a decision-maker.

```
GenerationBatch
  id: BatchId (uuid)
  userId: UserId
  createdAt: DateTime
  expiresAt: DateTime            // createdAt + BATCH_TTL (see constants)
  status: "open" | "committed"
  candidates: Candidate[]

Candidate
  id: CandidateId (uuid, server-assigned — never client-supplied)
  question: string
  answer: string
  disposition: "pending" | "accepted" | "rejected"   // terminal once accepted/rejected
```

**Domain errors** (named, thrown — never a silent state change):

```
class BatchNotFoundError extends Error {}          // unknown id, or not owned by caller
class BatchExpiredError extends Error {}           // now > expiresAt
class BatchAlreadyCommittedError extends Error {}   // commit() called twice
class CandidateNotInBatchError extends Error {}     // candidateId not part of this batch
class CandidateAlreadyResolvedError extends Error {}// candidate is not "pending"
class InvalidEditError extends Error {}             // edited text fails I1's length bounds
```

**Methods, with preconditions:**

```
static GenerationBatch.open(userId: UserId, candidates: {question, answer}[]): GenerationBatch
  // factory called immediately after generateCandidates() succeeds (generate.ts).
  // Precondition: candidates.length between 1 and MAX_CARDS (already guaranteed upstream).
  // Assigns a fresh id to each candidate; disposition = "pending" for all.

batch.accept(candidateId: CandidateId, edit?: {question?: string; answer?: string}): FlashcardDraft
  // Preconditions (checked in order, first failure wins — fail-fast):
  //   1. this.status === "open"                        else BatchAlreadyCommittedError
  //   2. now() <= this.expiresAt                        else BatchExpiredError
  //   3. candidate exists in this.candidates            else CandidateNotInBatchError
  //   4. candidate.disposition === "pending"             else CandidateAlreadyResolvedError
  //   5. if edit given: edited text within I1 bounds     else InvalidEditError
  // Effect: candidate.disposition = "accepted" (terminal); returns a FlashcardDraft
  //         { question, answer, source: "ai", userId } using the edited text if given,
  //         else the original candidate text (never trusts client-supplied text for
  //         un-edited candidates — closes a secondary tampering gap for free).

batch.reject(candidateId: CandidateId): void
  // Same preconditions 1-4 as accept(). Effect: disposition = "rejected" (terminal).
  // No FlashcardDraft is produced — this is what realizes "rejected candidates leave no trace."

batch.commit(): FlashcardDraft[]
  // Precondition: this.status === "open"                else BatchAlreadyCommittedError
  // Effect: this.status = "committed" (replay-proof — a second commit() on the same
  //         batch always throws, even if it targets different candidate ids).
  //         Returns the FlashcardDrafts accumulated from every accept() call made
  //         before commit(). A batch with zero accepted candidates commits to [].
```

The state machine is intentionally strict: `pending → accepted` and `pending → rejected` are the only legal transitions, both terminal. There is no `pending → pending` (idempotent double-accept is explicitly an error, not a no-op) — this is what makes I3 replay-proof: an attacker (or a buggy retry) cannot re-submit the same `candidateId` to mint a second flashcard.

### Repository: `GenerationBatchRepository`

```
interface GenerationBatchRepository {
  save(batch: GenerationBatch): Promise<void>
    // Upserts the batch row (candidates as JSONB, id/userId/status/createdAt/expiresAt).

  findOwnedByUser(batchId: BatchId, userId: UserId): Promise<GenerationBatch | null>
    // Loads and reconstructs the aggregate. Returns null (not-found — not 403) when
    // the batch doesn't exist OR belongs to a different user, matching the existing
    // IDOR-safe not-found pattern already used by src/pages/api/flashcards/[id].ts:58-60
    // and .../[id]/review.ts:61-63.
}
```

**Atomicity.** I3 requires that "flip the batch to committed" and "insert the accepted flashcards" happen as one indivisible operation — a partial failure (batch marked committed but flashcards not inserted, or vice versa) would either silently drop accepted cards or allow a retry to double-insert. Supabase's JS client has no ad-hoc multi-statement client transaction over PostgREST, so this goes into **one Postgres function**, called via `.rpc()`:

```sql
create function public.commit_generation_batch(p_batch_id uuid, p_accepted jsonb)
returns setof public.flashcards
language plpgsql
security invoker              -- runs as the calling user; RLS still applies
as $$
begin
  update public.generation_batches
    set status = 'committed'
    where id = p_batch_id and user_id = auth.uid() and status = 'open';
  if not found then
    raise exception 'batch_not_open' using errcode = 'P0001';
  end if;

  return query
    insert into public.flashcards (question, answer, source, user_id)
    select (c->>'question'), (c->>'answer'), 'ai', auth.uid()
    from jsonb_array_elements(p_accepted) as c
    returning *;
end;
$$;
```

Everything inside the function is one transaction by default (Postgres wraps each function call in an implicit transaction); the `update ... where status = 'open'` guard is what makes double-commit impossible even under concurrent requests for the same batch (the second caller's `update` affects 0 rows → `not found` → exception → whole call rolls back, including any inserts it might otherwise have attempted). `security invoker` (not `definer`) keeps this inside the existing RLS model rather than bypassing it, consistent with how `is_pending_deletion()` deliberately chose `security definer` only where RLS genuinely needed bypassing (`20260702145938_create_account_deletions.sql:61-66`) — here it doesn't.

### Thin route layer

```
POST /api/flashcards/generate  (existing route, extended)
  parse body (generateRequestSchema)  →  generateCandidates()
  →  batch = GenerationBatch.open(user.id, candidates)
  →  await repo.save(batch)
  →  respond 200 { batchId: batch.id, candidates: batch.candidates }  // ids now server-assigned

POST /api/flashcards/batches/{batchId}/commit   (replaces today's free-form POST /api/flashcards for the AI path)
  parse body: { decisions: { candidateId, action: "accept" | "reject", edit?: {question, answer} }[] }
  →  batch = await repo.findOwnedByUser(batchId, user.id)      // null → 404 not_found
  →  for each decision: batch.accept(...) / batch.reject(...)   // first thrown error aborts the whole request
  →  drafts = batch.commit()
  →  await repo.save(batch)  +  drafts persisted via commit_generation_batch RPC, in one transaction
  →  respond 200 { saved: drafts.length }

  Domain error → HTTP mapping (fail-fast; no partial success):
    BatchNotFoundError            → 404 not_found
    BatchExpiredError             → 410 batch_expired
    BatchAlreadyCommittedError    → 409 batch_already_committed
    CandidateNotInBatchError      → 400 candidate_not_in_batch
    CandidateAlreadyResolvedError → 409 candidate_already_resolved
    InvalidEditError              → 400 invalid_edit
```

The manual-authoring path (`src/pages/api/flashcards/manual.ts`) is **untouched** — it has no AI provenance and is a different aggregate boundary entirely; this refactor does not extend to FR-005.

## Step 5 — Before / after, phased plan, tests

### Before / after per current location of the rule

| Location                                                    | Before                                                                                                           | After                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/flashcards/GenerateView.tsx:87`             | Sole enforcement point: filters `status === "accepted"` client-side, trusted by the server.                      | Still filters for _display_ purposes (which cards show as accepted in the UI), but is no longer load-bearing — the server independently re-validates every decision against the persisted batch. |
| `src/components/flashcards/CandidateCard.tsx:4-9`           | `ReviewCard.status` is the only representation of "has this been reviewed."                                      | Becomes a local UI mirror of the server-tracked `Candidate.disposition`; ids are now server-assigned (from the `generate` response) instead of `crypto.randomUUID()`.                            |
| `src/pages/api/flashcards/index.ts:42-49`                   | Inserts any `{question, answer}` pair the caller sends, tags it `"ai"` unconditionally, no notion of provenance. | AI-sourced saves go through `POST /api/flashcards/batches/{batchId}/commit`; an unlisted/foreign/replayed candidate now hard-fails with a typed 4xx instead of silently succeeding.              |
| `src/pages/api/flashcards/generate.ts:65-69`                | Returns candidates with no persisted identity — nothing to check acceptance against later.                       | Also persists a `GenerationBatch` and returns `batchId` + server-assigned candidate ids.                                                                                                         |
| `tests/integration/risk2-review-save-contract.test.ts:1-30` | Explicitly documents and accepts that the guardrail is client-only and violable.                                 | Rewritten to assert the _opposite_: an extra/unlisted card, a foreign `batchId`, or a replayed commit is **rejected**, not silently persisted (see test cases below).                            |

### Phased plan (test-first, matching this repo's existing two-layer pattern: pure-unit for domain logic, integration for real-DB round-trips — `context/foundation/test-plan.md §6.1-6.2`)

1. **Phase 1 — pure aggregate (unit, test-first).** Write unit tests for `GenerationBatch` in isolation (no DB, no HTTP): every legal and illegal transition below. Then implement `GenerationBatch`/`Candidate`/the domain errors as a pure module to make them pass.
2. **Phase 2 — persistence (integration, test-first).** Add the `generation_batches` migration + `commit_generation_batch()` function + RLS (owner-scoped, matching the `flashcards` pattern). Write integration tests against real local Supabase: save/reload round-trip, concurrent double-commit race, cross-user `findOwnedByUser` returns `null`. Then wire `GenerationBatchRepository`.
3. **Phase 3 — route wiring (integration, test-first).** Extend `generate.ts` to persist+return `batchId`; add the new commit route. Rewrite `risk2-review-save-contract.test.ts` first (red), then wire the route to turn it green.
4. **Phase 4 — client wiring (presentation only, no new business logic).** Update `GenerateView.tsx`/`CandidateCard.tsx` to carry the server-assigned `batchId`/candidate ids and call the commit route with `{decisions}` instead of raw `{cards}`.
5. **Phase 5 — cleanup.** Confirm no other caller still targets the old free-form save shape for AI-sourced cards; leave `manual.ts` untouched.

### Test cases for I3

**Legal (must succeed):**

- Accept a pending candidate in an open, unexpired, own batch → flashcard created with `source: "ai"`, candidate now `"accepted"`.
- Accept with an edit → flashcard created with the _edited_ text, not the original.
- Reject a pending candidate → no flashcard created; candidate now `"rejected"`.
- Commit a batch with a mix of accepted/rejected/still-pending candidates → only the accepted ones become flashcards, in one transaction.
- Commit a batch with zero accepted candidates → succeeds, `saved: 0`.

**Illegal (must throw a named domain error / return a typed 4xx — never a silent 200):**

- `candidateId` not present in the given batch → `CandidateNotInBatchError` / `400 candidate_not_in_batch` (this is the exact case `risk2`'s current docstring says would "happily save").
- Accept or reject a candidate whose disposition is already `"accepted"`/`"rejected"` → `CandidateAlreadyResolvedError` / `409` (replay protection).
- Commit against a `batchId` owned by a different user → `BatchNotFoundError` / `404 not_found` (IDOR-safe, consistent with existing not-found conventions).
- Commit against an expired batch → `BatchExpiredError` / `410 batch_expired`.
- Commit the same batch twice (even with different decisions the second time) → `BatchAlreadyCommittedError` / `409 batch_already_committed`.
- Submit an edit whose question/answer violates I1's length bounds → `InvalidEditError` / `400 invalid_edit`, checked before touching the DB.
- Two concurrent commit requests for the same batch → exactly one succeeds; the other gets `BatchAlreadyCommittedError` (proves the SQL function's `where status = 'open'` guard, not just an application-level check).

### New load-bearing names (no existing registry found in this repo — `docs/reference/contract-surfaces.md` referenced by a skill's docs does not exist here; listing for future reference instead)

- `GenerationBatch`, `Candidate.disposition` (aggregate + value object)
- `generation_batches` (table), `commit_generation_batch` (Postgres RPC)
- Domain errors: `BatchNotFoundError`, `BatchExpiredError`, `BatchAlreadyCommittedError`, `CandidateNotInBatchError`, `CandidateAlreadyResolvedError`, `InvalidEditError`
- New `ApiErrorCode` values: `batch_expired`, `batch_already_committed`, `candidate_not_in_batch`, `candidate_already_resolved`, `invalid_edit`
- `GenerationBatchRepository`
- New route: `POST /api/flashcards/batches/{batchId}/commit`
- Constant: `BATCH_TTL_MINUTES` (suggested default: 60 — a product decision to confirm, not silently hardcode)

**Note, out of scope for this refactor:** the pre-existing naming collision between the PRD's "review" (I3, accept/edit/reject) and the code's `src/pages/api/flashcards/[id]/review.ts` (I6, FSRS grading) is not resolved here. The vocabulary introduced above (`Candidate.disposition`, `GenerationBatch.accept/reject/commit`) deliberately avoids the word "review" so it doesn't add a third meaning to an already-overloaded term, but renaming the existing grading endpoint is a separate, low-risk cleanup (flagged previously in `context/domain/01-domain-distillation.md`, Step 5 #4).

## Summary

The most core invariant in 10xCards — "no AI-generated flashcard is saved without explicit human acceptance," the product's own stated wedge — turned out to be the least enforced: it lives entirely in a client-side `status` filter (`GenerateView.tsx:87`) and evaporates completely at the one server endpoint that persists data, a gap the project's own integration test explicitly documents rather than hides. This plan proposes a `GenerationBatch` aggregate as the single place that invariant is checked from now on: candidates get server-assigned identity, transition `pending → accepted/rejected` exactly once each, and a batch commits its accepted candidates as flashcards atomically via one Postgres function — replacing today's free-form, provenance-blind insert. Every illegal operation (unlisted candidate, replayed decision, foreign or expired batch, double-commit) now throws a named domain error and returns a typed 4xx instead of silently succeeding with `200`. The manual-authoring path and the (separately-named, out-of-scope) SRS grading endpoint are untouched. The phased plan is test-first throughout, starting from a pure unit test of the aggregate's state machine, through an integration test of the atomic commit, to rewriting the one existing test that currently certifies the gap as acceptable.
