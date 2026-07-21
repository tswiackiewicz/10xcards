---
title: "10xCards — Anti-Corruption Layer Refactor Plan"
created: 2026-07-21
type: refactor-plan
---

# 10xCards — Anti-Corruption Layer Refactor Plan

This is a **plan**, not an implementation. No production code is changed by this document. It builds on `context/domain/01-domain-distillation.md` and `02-invariant-aggregate-refactor.md` but re-derives the leak list from scratch per the task's discovery discipline.

## Step 0 — Context

`context/foundation/tech-stack.md:29` frames the stack's typed-boundary story explicitly: "TypeScript and Zod giving typed boundaries for candidate-card payloads" — Zod is documented as a _boundary_ concern. `context/foundation/prd.md:175-177` states a deliberate buy-not-build choice for scheduling: "No custom spaced-repetition algorithm. The MVP integrates a ready-made SRS algorithm rather than building its own... a deliberate buy-not-build decision to keep scope to three weeks." `context/foundation/roadmap.md:139` treats the specific library as an open, swappable pick: "Which ready-made SRS algorithm/library to integrate (PRD Non-Goals forbid building a custom engine) — Owner: user/TBD." These are the two explicit "this should be replaceable" declarations found in the docs.

Package manifest (`package.json:20-43`, `dependencies`): `@supabase/ssr`, `@supabase/supabase-js`, `ts-fsrs`, `zod`, plus Astro/React/Tailwind. Layers: persistence (`supabase/migrations/*.sql`, generated `src/db/database.types.ts`), domain (`src/lib/flashcards/*.ts`), API (`src/pages/api/**/*.ts`), UI (`src/components/**/*.tsx`, `.astro` pages — the latter run server-side, but `client:*`-mounted `.tsx` components ship to the browser).

## Step 1 — Identify leaking dependencies

Verified by grep + read, file:line:

### Candidate A (selected) — `ts-fsrs`'s internal `Card` shape, baked into the DB schema and propagated unchanged through the wire contract into client-hydrated UI

`ts-fsrs` itself is imported in exactly one file — `src/lib/flashcards/srs.ts:1` (`import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";`) — nowhere else does the _package_ get imported. But its **data shape** was copied field-for-field into persistence and never re-encapsulated afterward:

- `supabase/migrations/20260701213238_add_srs_state.sql:1-2` — "Adds the scheduling state ts-fsrs persists between reviews... to the existing `flashcards` store" — the migration's own comment names the library as the source of the column shape.
- `supabase/migrations/20260701213238_add_srs_state.sql:14-23` — nine columns added verbatim as `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review` — these are `ts-fsrs`'s own `Card` field names, not a domain-chosen vocabulary.
- `src/db/database.types.ts:52-108` — the generated `flashcards.Row` type carries all nine fields as first-class, typed columns (`difficulty: number | null`, `stability: number | null`, etc., lines 56, 66).
- `src/lib/flashcards/schemas.ts:46` — `export type Flashcard = Database["public"]["Tables"]["flashcards"]["Row"];` — the DB row _is_ the domain type, unfiltered.
- `src/lib/flashcards/schemas.ts:55` — `export interface NextCardResponse { card: Flashcard | null; previews: GradePreview[] | null; }` — the wire contract embeds the raw DB row (and therefore the raw FSRS shape) directly.
- `src/lib/flashcards/srs.ts:14-17` — `SrsColumns = Pick<Flashcard, "due" | "stability" | "difficulty" | "scheduled_days" | "learning_steps" | "reps" | "lapses" | "state" | "last_review">` — the adapter's own comment concedes this is "the persisted FSRS state subset of a flashcard row" (line 13) — i.e., `Flashcard` is acknowledged internally as FSRS-shaped, yet `Flashcard` is still the type exported and reused everywhere else, not `SrsColumns`.
- `src/lib/flashcards/study.ts:14-21` — `getNextCard()` does `.select("*")` and returns the full row as `card` in `NextCardResponse`.
- `src/pages/api/flashcards/study/next.ts:31,35` — `const next = await getNextCard(...)` then `return json(200, next);` — the full FSRS-shaped row is serialized straight into the HTTP response body.
- `src/pages/study.astro:11-14` — server-loads the first card via the same `getNextCard()` and passes it as `initialCard` into a `client:load` island (line 27) — the full row, FSRS internals included, lands in the page's hydration payload.
- `src/pages/cards.astro:7-13` — `supabase.from("flashcards").select("*")` fetches every column for every saved card, typed `Flashcard[]`, passed into a `client:load` island (line 26).
- `src/components/flashcards/StudyView.tsx:4,34-35,40` — imports `type { ..., Flashcard, ... }`, types `initialCard`/`card` state as `Flashcard | null` — the FSRS-shaped type is now a client component's prop/state type, even though the component reads only `card.id` (line 78), `card.question` (line 141), `card.answer` (line 146).
- `src/components/flashcards/SavedCardsView.tsx:15,51-57,157-165,257-258` — imports `type { Flashcard }`, types every card prop as `Flashcard`, and the component (and its `CardEditor`/`SavedCard` children) only ever reads `.id`, `.question`, `.answer`, `.source` — never `.stability`, `.difficulty`, `.due`, etc.

**Partial, already-good containment worth noting** (so the diagnosis stays honest): `src/pages/api/flashcards/[id]/review.ts:20,53-57,69,77` reads the same `SRS_COLUMNS` subset and computes the new state via the adapter, but its response only ever returns `{ due: data[0].due }` (line 77) — it does **not** leak the full row back to the client. This route is a partial precedent for the ACL boundary this plan formalizes everywhere else.

### Candidate B (identified, not selected) — `zod` pulled into the client bundle via shared constants

- `src/lib/flashcards/schemas.ts:1,13-14,18-21,24-26,29,32-34` — defines `z.object(...)` schemas at module scope, alongside plain constants (`MAX_INPUT_CHARS`, `QUESTION_MAX`, `ANSWER_MAX`, lines 6,9-10).
- `src/components/flashcards/GenerateView.tsx:15` — `import { MAX_INPUT_CHARS, type Candidate, type ApiErrorCode } from "@/lib/flashcards/schemas";` — a **value** import of `MAX_INPUT_CHARS` pulls in the whole module (and therefore `zod`'s runtime) for a client-side React island.
- `src/components/flashcards/ManualCardForm.tsx:4` and `src/components/flashcards/SavedCardsView.tsx:15` — same pattern with `QUESTION_MAX`/`ANSWER_MAX`.

This is a real "server library into client bundle" leak, and `tech-stack.md:29`'s "typed boundaries" framing implies Zod was meant to stay at the server boundary. It is smaller in blast radius than Candidate A (no persistence-schema or wire-contract entanglement, purely a bundling side-effect) and has a weaker documented swap-intent signal (no PRD Non-Goal calling out validator choice as a deliberate placeholder, unlike ts-fsrs). Noted here for completeness; not the #1 pick. A one-line remedy is included in Step 5 as a low-cost adjacent fix.

### Considered and rejected — `@supabase/supabase-js` / `@supabase/ssr`

Grep confirms these are imported only in `src/lib/supabase.ts:1`, `src/lib/supabase-admin.ts:1`, and test helpers (`tests/helpers/auth.ts:1-3`) — never in `src/components/**` or client-facing `.astro` script sections. All app communication with Supabase goes through Astro API routes. **Not a leak** — already correctly layered.

## Step 2 — Classification and selection

| Axis                                   | Candidate A: `ts-fsrs` shape via `Flashcard`                                                                                                                                                                                                                                                                                                                                                     | Candidate B: `zod` in client bundle                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Layers/files touched               | Persistence (1 migration) → generated types (1 file) → domain (`schemas.ts`, `srs.ts`, `study.ts`) → API (2 routes) → 2 `.astro` pages → 2 client components = **10 files across all 4 layers**                                                                                                                                                                                                  | Domain module (1 file) → 3 client components = 4 files, UI layer only                                                                                                               |
| (b) Cost of swapping the library today | High — a different scheduling library with a different state shape (e.g., SM-2's `interval`/`easeFactor`/`repetitions`) would require a new migration, a type regen, and edits to every one of the 10 files above, including two UI components that don't even use the fields                                                                                                                    | Moderate — swapping validators is routine, but the surprising cost is that 3 UI files would need re-auditing for accidental bundle changes even though they never validate anything |
| (c) Documented swap intent vs. code    | **Strong and explicit**: PRD Non-Goal "a deliberate buy-not-build decision" (`prd.md:175-177`); roadmap treats the library choice as open (`roadmap.md:139`); `srs.ts:4-9`'s own comment claims the dependency is "isolated behind a thin ts-fsrs wrapper" — directly contradicted by the fact that the wrapper's boundary (`Flashcard`/`SrsColumns`) is not thin at all; it reaches the browser | Weaker: `tech-stack.md:29` implies a boundary role for Zod, but no document frames the _validator choice itself_ as a deliberate, swappable, buy-not-build decision                 |

**Selection: Candidate A.** It is both the widest-spread leak (persistence through UI, all four layers) and the one with the clearest intent-vs-code contradiction: the code's own docstring claims isolation that the code's own type exports disprove. Candidate B is real but narrower and less clearly a broken promise — it is noted for a low-cost follow-up in Step 5, not chosen as the primary target.

## Step 3 — Diagnosis

**Duplication / reconstruction:** there is no duplicated _reconstruction_ of the `Card` object outside `srs.ts` (good — grading logic itself is not copy-pasted anywhere). The problem is narrower and more insidious: the library's field _names and types_ were adopted directly as the persistence schema (`20260701213238_add_srs_state.sql:14-23`) instead of being translated at a boundary, so every consumer of that schema inherits the library's shape by construction, with no translation step to skip.

**Where the library type appears in domain signatures / wire contracts (the specific danger this task calls out):**

- `NextCardResponse.card: Flashcard` (`schemas.ts:55`) is a **wire-contract field typed as a DB row that is itself FSRS-shaped** — the HTTP JSON response of `GET /api/flashcards/study/next` literally contains `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review` alongside `question`/`answer` (`src/pages/api/flashcards/study/next.ts:35`).
- The same shape crosses into a **client-hydrated component's prop types**: `StudyView.tsx:34-35` (`initialCard: Flashcard | null`) and `SavedCardsView.tsx:257` (`{ cards }: { cards: Flashcard[] }`). This is the "biblioteka serwerowa wciągana do bundla klienta" pattern in its type-system form: not the `ts-fsrs` _package_ in the bundle, but its _data shape_, unfiltered, in the client's type contract and in every JSON payload the client receives — over-fetching internal scheduling memory the UI never reads (confirmed above: `StudyView.tsx` and `SavedCardsView.tsx` only ever touch `.id`/`.question`/`.answer`/`.source`).

**Layers that do NOT enforce any boundary here:** the domain layer (`schemas.ts`, `study.ts`) re-exports the raw type instead of narrowing it; the API layer (`study/next.ts`) forwards it verbatim; the SSR layer (`study.astro`, `cards.astro`) fetches `select("*")` instead of a narrowed projection; the UI layer accepts whatever shape arrives. **Where it is enforced inconsistently:** `review.ts` (the grading endpoint) _does_ narrow its response to `{ due }` before returning — proving the codebase already knows how to do this correctly in one place but didn't apply the same discipline everywhere else.

**Where the client is the only guardian of anything:** not applicable to _this_ invariant (there is no guardrail being bypassed here, just an unnecessary coupling) — but it is worth noting the asymmetry: the client is trusted to simply _ignore_ the fields it doesn't need, rather than the server declining to send them in the first place.

**Intent vs. code, cited directly:** `src/lib/flashcards/srs.ts:4-9` states the intent — "S-04 spaced-repetition scheduling, **isolated behind a thin ts-fsrs wrapper**." The code contradicts this: the "wrapper" (`SrsColumns`, a `Pick` of `Flashcard`) is thin, but `Flashcard` itself — the type the wrapper picks _from_, and the type every other layer uses — is not wrapped at all; it _is_ the FSRS shape, exported and reused verbatim as the domain type, the wire type, and the UI prop type.

## Step 4 — Anti-corruption layer design

Two things must exist that don't today: (1) a domain-owned, client-safe view of a flashcard that never carries scheduling internals, and (2) a narrow port that hides `ts-fsrs` (and any future replacement) behind domain vocabulary.

### Domain entity: `StudyCard` (replaces `Flashcard` as the type every layer outside the scheduling subsystem is allowed to see)

```
StudyCard
  id: FlashcardId (uuid)
  question: string
  answer: string
  source: "ai" | "manual"
  createdAt: DateTime
  updatedAt: DateTime
```

No `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, or `last_review` — those never leave the scheduling subsystem. `NextCardResponse` becomes `{ card: StudyCard | null; previews: GradePreview[] | null }` — same field name, narrower type; no client-visible contract changes beyond dropping fields nothing reads.

### Value object: `SchedulingState` (replaces `SrsColumns` as the _only_ place scheduling-library shape is allowed to exist)

```
SchedulingState
  due: DateTime | null            // domain-meaningful for ANY algorithm — kept queryable
  memory: SchedulingMemory        // opaque to everyone except the adapter (see below)

SchedulingMemory = unknown        // adapter-owned encoding; domain code never inspects it
```

`due` stays a first-class, queryable domain fact (every spaced-repetition algorithm needs "when is this next shown"); everything algorithm-internal (`stability`, `difficulty`, etc., or whatever a future library calls them) collapses into one opaque `memory` blob whose shape only the adapter understands.

### Narrow port: `SchedulingEngine` (domain-owned interface — no `ts-fsrs` import, no `ts-fsrs` type in any signature)

```
interface SchedulingEngine {
  previewGrades(state: SchedulingState | null, now: DateTime): GradePreview[]
  applyGrade(state: SchedulingState | null, rating: ReviewRating, now: DateTime): SchedulingState
}
```

Same two operations `srs.ts` already exposes today (`previewGrades`, `applyGrade` — `srs.ts:60-67, 73-86`), just re-typed against `SchedulingState`/`GradePreview`/`ReviewRating` (all already domain types) instead of directly against `Flashcard`/`SrsColumns`.

### Adapter: `TsFsrsSchedulingEngine implements SchedulingEngine` (the _only_ file allowed to import `ts-fsrs`)

```
class TsFsrsSchedulingEngine implements SchedulingEngine {
  private scheduler = fsrs()   // ts-fsrs, imported here and only here

  previewGrades(state, now):
    card = this.toLibraryCard(state)          // SchedulingState -> ts-fsrs Card
    preview = this.scheduler.repeat(card, now)
    return RATINGS.map(r => ({ rating: r, label: formatInterval(now, preview[GRADE_BY_RATING[r]].card.due) }))

  applyGrade(state, rating, now):
    card = this.toLibraryCard(state)
    next = this.scheduler.next(card, now, GRADE_BY_RATING[rating]).card
    return this.fromLibraryCard(next)         // ts-fsrs Card -> SchedulingState

  private toLibraryCard(state): Card           // ts-fsrs Card, private, never escapes this class
    if state === null: return createEmptyCard()
    memory = state.memory as TsFsrsMemoryShape  // adapter's own private encoding of `memory`
    return { due: state.due ?? new Date(), stability: memory.stability, difficulty: memory.difficulty,
             scheduled_days: memory.scheduledDays, learning_steps: memory.learningSteps,
             reps: memory.reps, lapses: memory.lapses, state: memory.phase, last_review: memory.lastReview }

  private fromLibraryCard(card: Card): SchedulingState
    return { due: card.due, memory: { stability: card.stability, difficulty: card.difficulty,
             scheduledDays: card.scheduled_days, learningSteps: card.learning_steps,
             reps: card.reps, lapses: card.lapses, phase: card.state, lastReview: card.last_review } }
}
```

**Open question resolved here, in the ACL — not in the API layer:** today the DB's `state smallint` column stores `ts-fsrs`'s own `State` enum ordinal directly (per `ts-fsrs`'s documented `State` enum: `New=0, Learning=1, Review=2, Relearning=3`), with no translation step (`srs.ts:44`: `state: row.state ?? State.New` — the raw library enum, unconverted). Per `ts-fsrs`'s own contract, that ordinal is an implementation detail of the library's internal model, not a documented stable public API for external storage. The ACL is where this gets decided: `TsFsrsSchedulingEngine.fromLibraryCard`/`toLibraryCard` are the only two functions allowed to know that `memory.phase` (an app-owned concept, e.g. `"new" | "learning" | "review" | "relearning"`) maps to `ts-fsrs`'s numeric `State` enum — the mapping, and any future re-mapping if the library's enum ever changes, lives entirely in the adapter, never in a route handler or the persistence schema.

### Repository: `FlashcardRepository` (splits what's fetched, instead of `select("*")` everywhere)

```
interface FlashcardRepository {
  findDue(userId: UserId, now: DateTime): Promise<{ card: StudyCard; scheduling: SchedulingState } | null>
  findAllOwnedBy(userId: UserId): Promise<StudyCard[]>              // cards.astro's list — never fetches scheduling columns
  findSchedulingState(id: FlashcardId, userId: UserId): Promise<SchedulingState | null>  // review.ts's read
  persistGrade(id: FlashcardId, userId: UserId, next: SchedulingState): Promise<DateTime | null>
}
```

`findAllOwnedBy` (backing `cards.astro`/`SavedCardsView`) selects only `id, question, answer, source, created_at, updated_at` — never touches the nine scheduling columns at all, closing the over-fetch at the query, not just at the type level.

## Step 5 — Isolation proof and before/after

**Proof that swapping the scheduling library touches only the adapter:**

1. Table shape: `due timestamptz` (kept — domain-meaningful) + one opaque `scheduling_state jsonb` (replaces the nine typed columns) → a new algorithm's state, whatever shape it takes, serializes into the same jsonb column. No new migration needed on library swap, only on the _first_ introduction of this refactor.
2. `src/db/database.types.ts` → after regen, shows `scheduling_state: Json | null`, not nine typed fields — swapping the library never touches this file again.
3. `NextCardResponse`, `StudyCard`, `SchedulingEngine`, `FlashcardRepository` — none import or mention `ts-fsrs`; a library swap changes zero signatures here.
4. `study.ts`, `study/next.ts`, `review.ts`, `study.astro`, `cards.astro`, `StudyView.tsx`, `SavedCardsView.tsx` — all operate on `StudyCard`/`GradePreview`/the `SchedulingEngine` port; a library swap changes zero lines in any of these seven files.
5. Only `TsFsrsSchedulingEngine` (one file) and the one line in the composition root that constructs it (`new TsFsrsSchedulingEngine()` → `new SomeOtherEngine()`) change.

**Before / after for each duplicated/leaking location:**

| Location                              | Before                                                                                 | After                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas.ts:46,55`                    | `Flashcard = Database[...]["Row"]` (full FSRS row); `NextCardResponse.card: Flashcard` | `StudyCard` (no scheduling fields); `NextCardResponse.card: StudyCard`                                                                                      |
| `srs.ts:14-17`                        | `SrsColumns = Pick<Flashcard, ...9 fields>`                                            | `SchedulingState { due, memory }`, defined independently of any DB row type                                                                                 |
| `study.ts:14-21`                      | `.select("*")`, returns full row                                                       | Repository's `findDue()` returns `{ card: StudyCard, scheduling: SchedulingState }`; only `card` (narrowed) reaches `NextCardResponse`                      |
| `study/next.ts:35`                    | `return json(200, next)` — full row over the wire                                      | Same call shape, but `next.card` is now a `StudyCard` — response body drops nine fields nothing read                                                        |
| `study.astro:11-14,27`                | Full row passed into `client:load` island                                              | `StudyCard` passed in — hydration payload shrinks; no scheduling internals ever reach the browser                                                           |
| `cards.astro:12`                      | `select("*")`                                                                          | `findAllOwnedBy()` — query itself never selects the nine columns                                                                                            |
| `StudyView.tsx:34-35,40`              | `initialCard: Flashcard \| null`                                                       | `initialCard: StudyCard \| null` — component's own type now documents exactly what it uses                                                                  |
| `SavedCardsView.tsx:15,51-57,157-165` | `card: Flashcard` throughout                                                           | `card: StudyCard` throughout — same three fields read (`question`, `answer`, `source`), now the type says so                                                |
| `review.ts:20,53-57`                  | Reads `SRS_COLUMNS` literal string subset directly against the table                   | Reads via `repository.findSchedulingState()` / writes via `repository.persistGrade()` — same behavior, now behind the port instead of an inline column list |

The UI layer's role changes from "receives the raw persistence row and is trusted to only look at three fields" to "receives a domain view object that structurally cannot contain scheduling internals" — the difference between convention and a compiler-enforced boundary.

**Adjacent, smaller fix (Candidate B, low cost, not required to close Candidate A):** split `schemas.ts`'s plain wire-format constants (`MAX_INPUT_CHARS`, `QUESTION_MAX`, `ANSWER_MAX`, `MAX_CARDS`) into a constants-only module with no `zod` import; `GenerateView.tsx`, `ManualCardForm.tsx`, `SavedCardsView.tsx` import from that module instead of from the Zod-schema-bearing one. Zod then only loads where it's actually used: the four server-side files that already import it intentionally.

## Step 6 — Verification and phased plan

**Success criterion:** `grep -rn "from \"ts-fsrs\"" src/` returns exactly one match, and it is the adapter file. A second check closes the type-shape leak specifically: `grep -rnE "\b(stability|difficulty|scheduled_days|learning_steps|lapses)\b" src/` returns matches only inside the adapter file and the migration/generated-types files that define the opaque `scheduling_state` column (which no longer name these fields at all post-migration) — never in `schemas.ts`, `study.ts`, any `api/**`, any `.astro` page, or any `.tsx` component.

**Files that know the dependency today (10, per Step 1) vs. after the refactor:**

| File                                                   | Knows it today                                                         | Knows it after                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260701213238_add_srs_state.sql` | Yes (defines 9 FSRS-named columns)                                     | N/A (superseded by a new migration defining `scheduling_state jsonb`, which is algorithm-agnostic) |
| `src/db/database.types.ts`                             | Yes (9 typed fields)                                                   | No — generic `Json`                                                                                |
| `src/lib/flashcards/schemas.ts`                        | Yes (`Flashcard`, `NextCardResponse`)                                  | No — exports `StudyCard`; `NextCardResponse` narrowed                                              |
| `src/lib/flashcards/srs.ts` → adapter                  | Yes (direct import + `SrsColumns`)                                     | **Yes — this is the intended, sole home**                                                          |
| `src/lib/flashcards/study.ts`                          | Yes (`select("*")`)                                                    | No — calls `FlashcardRepository.findDue()`                                                         |
| `src/pages/api/flashcards/study/next.ts`               | Yes (forwards full row)                                                | No — forwards `StudyCard`                                                                          |
| `src/pages/api/flashcards/[id]/review.ts`              | Partially (reads scheduling columns, but already narrows its response) | No — reads/writes via the repository/port                                                          |
| `src/pages/study.astro`                                | Yes (full row into island)                                             | No — `StudyCard` into island                                                                       |
| `src/pages/cards.astro`                                | Yes (`select("*")`)                                                    | No — `findAllOwnedBy()`                                                                            |
| `src/components/flashcards/StudyView.tsx`              | Yes (`Flashcard` prop type)                                            | No — `StudyCard` prop type                                                                         |
| `src/components/flashcards/SavedCardsView.tsx`         | Yes (`Flashcard` prop type)                                            | No — `StudyCard` prop type                                                                         |

### Phased plan (matching this repo's test-first convention, `context/foundation/test-plan.md §6.1-6.2`)

1. **Phase 1 — port + adapter (unit, test-first).** Write unit tests for `SchedulingEngine`/`TsFsrsSchedulingEngine` against the existing `srs.ts` test expectations (preview/grade behavior unchanged), asserting the class's public signatures never reference `ts-fsrs` types. Then extract the adapter from today's `srs.ts`.
2. **Phase 2 — persistence (integration, test-first).** New migration: add `scheduling_state jsonb`, backfill it from the nine existing columns for existing rows, then drop the nine columns. Integration tests: round-trip a `SchedulingState` through the repository against real local Supabase; confirm `due`-based queue ordering is unaffected.
3. **Phase 3 — repository + routes (integration, test-first).** Introduce `FlashcardRepository`; rewire `study.ts`, `study/next.ts`, `review.ts`, `cards.astro`'s query to use it. Rewrite any test asserting on the old full-row response shape (if any exist) to assert on the narrowed `StudyCard` shape instead.
4. **Phase 4 — UI (presentation only).** Change `StudyView.tsx`/`SavedCardsView.tsx` prop types to `StudyCard`; no behavior change since neither component ever read the dropped fields.
5. **Phase 5 (optional, low-cost) — close Candidate B.** Split `schemas.ts`'s wire-format constants into a `zod`-free module; repoint the three client components' imports.

## Summary

The worst leaking dependency in 10xCards is not a stray `import` statement — `ts-fsrs` itself is imported in exactly one file — but the fact that its internal `Card` state shape was copied field-for-field into the `flashcards` table (`stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`), and that same row type (`Flashcard`) is then reused unfiltered as the domain type, the `GET /api/flashcards/study/next` wire contract, and the prop type of two client-hydrated React components that only ever read three or four of its fourteen columns. `srs.ts`'s own comment claims the dependency is "isolated behind a thin ts-fsrs wrapper," but the wrapper's boundary (`Flashcard`/`SrsColumns`) is exactly what leaks — a clear, citable intent-vs-code contradiction, strengthened by the PRD's own explicit "buy-not-build" framing of the scheduling algorithm as a deliberately swappable choice. The proposed fix introduces a `StudyCard` domain entity (no scheduling fields, safe to serialize anywhere), a `SchedulingState` value object with one queryable `due` fact and one opaque `memory` blob, a narrow `SchedulingEngine` port with no library types in its signature, and a `TsFsrsSchedulingEngine` adapter as the sole remaining home of the library — collapsing the persisted state into a single algorithm-agnostic `jsonb` column so a future library swap touches one file and one migration, never the API or UI. A secondary, smaller leak (Zod's runtime pulled into three client bundles via shared wire-format constants) was identified and given a low-cost follow-up but was not selected as the primary target, since it lacks the same documented swap-intent and cross-layer severity as the scheduling-library case.
