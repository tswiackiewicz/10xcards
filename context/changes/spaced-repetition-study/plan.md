# Spaced-Repetition Study (S-04) Implementation Plan

## Overview

Add a spaced-repetition study loop to 10xCards by integrating **ts-fsrs** (the canonical
TypeScript FSRS scheduler). The product persists per-card FSRS scheduling state on the
existing `flashcards` table, serves the next card that is due (or never studied), lets the
user reveal the answer and grade their recall (Again/Hard/Good/Easy), and reschedules the
card via the library. This delivers FR-009 ("study a deck through a spaced-repetition
schedule — the product decides which card to show next based on prior recall") while
honoring the PRD Non-Goal of _not_ building a custom algorithm.

## Current State Analysis

- **Store exists, SRS state does not.** `flashcards` has `id, user_id, question, answer,
source, created_at, updated_at` (`supabase/migrations/20260624185919_create_flashcards.sql:11-19`).
  F-01 _deliberately deferred_ SRS columns until the algorithm was picked
  (`context/archive/2026-06-24-flashcard-store-rls/plan.md:58-59`). Adding them now is the
  planned path, not a retrofit.
- **RLS is table-level and column-agnostic.** The four owner-scoped policies
  (`...create_flashcards.sql:52-75`, `auth.uid() = user_id`) cover any new column with no
  new policy. F-01 treats RLS correctness as a launch gate verified by a repeatable script,
  not assumed (`context/archive/2026-06-24-flashcard-store-rls/plan.md:11`).
- **Endpoint idioms are established.** `src/pages/api/flashcards/[id].ts:19-63` is the
  template: `createClient` → `auth.getUser()` → `401`; Zod-validate → `400`; mutate with
  `.select()` → treat `data.length === 0` as `404 not_found`. `user_id` is never trusted
  from the request body (`context/archive/2026-06-25-ai-card-generation/plan.md:107`).
- **Page + island pattern is established.** `src/pages/cards.astro:7-14` server-loads
  RLS-scoped rows and hands them to a `client:load` React island
  (`SavedCardsView`). `/study` mirrors this.
- **Typed error codes** live in one union (`src/lib/flashcards/schemas.ts:40-49`).
- **ts-fsrs verified on `workerd`** (2026-07-01 smoke test, see research) — zero-dependency,
  pure ESM, no `nodejs_compat` needed. `scheduler.next(card, now, grade, handler)` accepts a
  transform handler to serialize `Date`→timestamp on the way to Postgres.

## Desired End State

A signed-in user visits `/study`, sees one due (or never-studied) card's question, reveals
the answer, and picks one of four grade buttons annotated with the next interval. The card is
rescheduled by ts-fsrs, its FSRS state is persisted, and the next due card loads. When
nothing is due, the user sees a friendly "all caught up" state. Cross-user isolation is
re-verified by the RLS script.

Verify: RLS script passes (incl. new columns), `npx astro sync && lint && build` is clean,
and a manual walkthrough on `astro dev` completes a full reveal→grade→advance loop with
scheduling that visibly changes `due`.

### Key Discoveries:

- **Lazy-init model** — SRS columns are nullable; `NULL due` means "never studied", treated
  as due-now. First grade runs `createEmptyCard()` → `next()` and writes full state. No
  backfill migration, existing rows untouched.
- **`learning_steps` is a real, easy-to-miss `Card` field in v5.4.1** — must be persisted or
  short-term (re)learning misbehaves on reload (research, "State fields to persist").
- **`elapsed_days` is `@deprecated`/derived** — do not persist it.
- **`next()` transform handler** serializes dates cleanly:
  `scheduler.next(card, now, grade, ({card, log}) => ({ card: {...card, due: card.due.getTime(), ...}, log }))`.
- **Astro routing** allows `[id].ts` and `[id]/review.ts` to coexist (distinct path segments).

## What We're NOT Doing

- **No custom algorithm / no parameter tuning UI** — `fsrs()` with library defaults
  (FSRS-6, `request_retention` 0.9, fuzz on), hardcoded. `request_retention` as a user
  setting is future work.
- **No reset / re-study feature** — FSRS state persists indefinitely; `forget()` / deck-wide
  reset are backlog.
- **No per-user weight optimization** — requires the native Rust optimizer (won't run on
  Workers); off-edge batch job, out of scope.
- **No new test framework** — the repo has none wired up; verification stays RLS-script +
  build + manual.
- **No changes to generation, manual authoring, or manage (S-01/S-02/S-03) surfaces** beyond
  a dashboard link to `/study`.
- **No session-length cap / daily-limit** — the queue serves due cards until empty.

## Implementation Approach

Vertical slice in dependency order: schema → backend (helper + endpoints) → UI. ts-fsrs owns
the scheduling math; the app owns _selection_ (a Postgres query over `due`) and _persistence_
(the new columns). Keep each request to one in-memory scheduler call plus minimal Supabase
round-trips (S-01 free-tier lesson). Mirror existing endpoint/page idioms exactly so the new
code reads like the surrounding code.

## Critical Implementation Details

- **NULL-due ordering.** The "next card" query must surface never-studied cards _and_ due
  reviews. Order so `NULL due` sorts first (new cards lead), then ascending `due` for reviews
  that are past-due. A single query with `.or("due.is.null,due.lte.<now>")` plus
  `.order("due", { ascending: true, nullsFirst: true })` and `.limit(1)` returns the one card
  to show.
- **Date serialization boundary.** ts-fsrs `Card` uses `Date`; Postgres returns ISO strings.
  Convert at the helper boundary only (row→`Card` on read, `Card`→columns on write via the
  `next()` transform handler), so endpoints and UI never juggle `Date` vs string.
- **Lazy init is in the helper, one place.** `applyGrade` detects a NULL-due row, builds a
  fresh card with `createEmptyCard()`, then grades it — so both "first study" and "review"
  flow through the same code path.

## Phase 1: Schema & Types

### Overview

Add the nine FSRS state columns to `flashcards` as nullable, regenerate the typed row, and
extend the RLS verification script to prove the new columns stay owner-isolated.

### Changes Required:

#### 1. Migration — add FSRS columns

**File**: `supabase/migrations/<timestamp>_add_srs_state.sql` (new; timestamp per the
`YYYYMMDDHHMMSS_name.sql` convention of `20260624185919_create_flashcards.sql`)

**Intent**: Attach per-card FSRS scheduling state to the existing store so a card can be
scheduled and reselected. All columns nullable — a `NULL due` row is "never studied". No new
RLS policies (existing table-level policies cover new columns); no data backfill.

**Contract**: `alter table public.flashcards add column` for: `due timestamptz`,
`stability double precision`, `difficulty double precision`, `scheduled_days integer`,
`learning_steps integer`, `reps integer`, `lapses integer`, `state smallint`,
`last_review timestamptz` — all nullable, no defaults. Add a partial/plain index on `due`
(`create index idx_flashcards_due on public.flashcards (due)`) to support the ordered
next-card query. Do **not** add `elapsed_days`. Include a header comment noting the S-04
context and that RLS is inherited from F-01.

#### 2. Regenerate database types

**File**: `src/db/database.types.ts`

**Intent**: Propagate the new columns into the typed `Flashcard` row so the helper, endpoints,
and UI are type-checked against the real schema.

**Contract**: Regenerate via the project's Supabase type-gen command against local Supabase.
`Database["public"]["Tables"]["flashcards"]["Row"]` gains the nine fields (each `T | null`).
No hand-editing.

#### 3. Extend RLS verification script

**File**: `scripts/verify-rls.mjs` (existing, from F-01)

**Intent**: Prove the new SRS columns are subject to the same owner isolation — a user cannot
read or write another user's scheduling state.

**Contract**: Add assertions that user B cannot `select`/`update` user A's `due`/`state`
columns, and (retaining F-01's coverage) that an anon-role client reads zero rows. Reuse the
existing two-user harness; no new policy is expected to be needed.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase (`npx supabase db reset` or the project's migrate step)
- Type generation succeeds and `Flashcard` row includes the 9 new fields
- RLS verification script passes: `node scripts/verify-rls.mjs`
- `npx astro sync` succeeds; `npm run lint` passes; `npm run build` passes

#### Manual Verification:

- Inspect the migrated table (Supabase Studio / `psql`): 9 nullable columns present, `due` index exists, existing rows have `NULL` SRS state
- Confirm no existing flashcard rows were mutated by the migration

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: SRS Helper & API

### Overview

Add a thin ts-fsrs wrapper that maps DB rows ↔ FSRS `Card` and applies grades (with lazy
init), then expose the two endpoints that drive the loop.

### Changes Required:

#### 1. Install ts-fsrs

**File**: `package.json`

**Intent**: Add the verified scheduler dependency.

**Contract**: `npm i ts-fsrs@^5.4.1` (zero transitive deps). No `nodejs_compat` change needed.

#### 2. SRS helper

**File**: `src/lib/flashcards/srs.ts` (new)

**Intent**: Isolate all ts-fsrs interaction and the `Date`↔string boundary. Endpoints call
this helper and never touch the library directly.

**Contract**: Module-level `const scheduler = fsrs()` (library defaults). Exports:

- a type for the persisted SRS subset of a row (the 9 columns);
- `rowToCard(row): Card` — builds a `Card` from stored columns (ISO strings → `Date`), or
  `createEmptyCard()` when `due` is `NULL`;
- `previewGrades(card, now): Record<Rating, { due: Date; interval: string }>` — derived from
  `scheduler.repeat(card, now)`, for the UI's per-button interval hints;
- `applyGrade(row, rating, now): { srsColumns }` — runs `scheduler.next(card, now, rating)`
  using the transform handler to return column-ready values (timestamps for `due`/`last_review`,
  numeric `state`). Handles the lazy-init case internally.

  Snippet (the non-obvious serialization contract other code depends on):

  ```ts
  const { card } = scheduler.next(fsrsCard, now, rating, ({ card, log }) => ({
    card: { ...card, due: card.due.getTime(), last_review: card.last_review?.getTime() ?? null },
    log,
  }));
  // map card.state (enum), stability, difficulty, scheduled_days, learning_steps, reps, lapses
  ```

#### 3. Next-card endpoint

**File**: `src/pages/api/flashcards/study/next.ts` (new)

**Intent**: Return the single card the user should study now (due or never-studied), scoped to
the owner by RLS.

**Contract**: `GET`. Auth pattern from `[id].ts:19-29`. Query: `select("*")` with
`.or("due.is.null,due.lte.<now-iso>")`, `.order("due", { ascending: true, nullsFirst: true })`,
`.limit(1)`. Response `200 { card: Flashcard | null }` (null = all caught up). DB error →
`500 save_failed`.

#### 4. Review (grade) endpoint

**File**: `src/pages/api/flashcards/[id]/review.ts` (new)

**Intent**: Record a grade for a card, reschedule via ts-fsrs, persist the new SRS state.

**Contract**: `PATCH`. Mirrors `[id].ts` exactly: auth → `401`; UUID param via `z.uuid()`;
Zod-validate body `{ rating: 1|2|3|4 }` (new `reviewSchema` in `schemas.ts`) → `400 invalid_rating`.
Fetch the card (RLS-scoped, `select` the SRS columns) → `404 not_found` if missing. Call
`applyGrade`, then `.update({ ...srsColumns }).eq("id", id).select("id")` → `data.length === 0`
means `404 not_found`; error → `500 save_failed`. Response `200 { due: string }` (new due, for
the client to confirm). `user_id` never read from the body.

#### 5. Schemas & error codes

**File**: `src/lib/flashcards/schemas.ts`

**Intent**: Add the review request schema and the new error code.

**Contract**: Add `reviewSchema = z.object({ rating: z.union([...1..4]) })` (or a `z.enum`
mirroring `Rating`), export its inferred type, and add `"invalid_rating"` to the `ApiErrorCode`
union (`schemas.ts:40-49`).

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds; `npm run lint` passes; `npm run build` passes (bundles ts-fsrs without `nodejs_compat` errors)
- Type checking passes — `applyGrade` output matches the `flashcards` Update type

#### Manual Verification:

- `GET /api/flashcards/study/next` returns a never-studied card for a fresh deck, and `{ card: null }` when nothing is due (verified via curl/browser with a signed-in session)
- `PATCH /api/flashcards/<id>/review` with `{ rating: 3 }` on a never-studied card initializes state and returns a future `due`; a second grade advances `due` again
- Grading a non-existent / foreign id returns `404`; invalid rating returns `400 invalid_rating`; unauthenticated returns `401`

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Study UI

### Overview

Add the `/study` route and an interactive island that runs the reveal→grade→advance loop.

### Changes Required:

#### 1. Study page

**File**: `src/pages/study.astro` (new)

**Intent**: Server-load the first due card (RLS-scoped) and hand it to the study island, mirroring
`cards.astro`.

**Contract**: Same `createClient` + query shape as the next-card endpoint (or fetch via the
endpoint). Render `Layout` + `<StudyView client:load initialCard={card} />`. Header with a
"← Dashboard" link like `cards.astro:20-25`.

#### 2. StudyView island

**File**: `src/components/flashcards/StudyView.tsx` (new)

**Intent**: The study loop UI — show question, reveal answer, four grade buttons with interval
hints, then load the next card.

**Contract**: Props `{ initialCard: Flashcard | null }`. State: current card, `revealed` boolean.
Flow: show question → "Show answer" reveals answer + four buttons (Again/Hard/Good/Easy) labeled
with the next interval (computed from a client-side ts-fsrs `repeat()` on the current card's SRS
state, or returned by the next-card payload). On grade: `PATCH /api/flashcards/{id}/review`
(reuse the `requestJson` helper pattern from `SavedCardsView.tsx:28-32`), then `GET
/api/flashcards/study/next` to advance. When the next card is `null`, render an "all caught up"
empty state with a link back to `/dashboard` or `/cards`. Handle `404` on review (card deleted
elsewhere) by advancing to the next card.

#### 3. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require auth for `/study`.

**Contract**: Add `"/study"` to `PROTECTED_ROUTES` (`src/middleware.ts:4`), alongside `/cards`.

#### 4. Dashboard entry point

**File**: dashboard page (e.g. `src/pages/dashboard.astro`)

**Intent**: Give users a way to reach study.

**Contract**: Add a "Study" link/button to `/study` next to the existing flashcard links.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds; `npm run lint` passes; `npm run build` passes
- Unauthenticated `GET /study` redirects to `/auth/signin` (middleware)

#### Manual Verification:

- Full loop on `astro dev`: open `/study`, reveal answer, grade a card, next card loads; interval hints on the four buttons are sensible and differ (Again < Hard < Good < Easy)
- Grading advances scheduling — a graded card's `due` moves into the future (re-studying doesn't immediately resurface it unless due)
- "All caught up" state shows when no card is due
- No regressions on `/cards`, `/generate`, `/create`

**Implementation Note**: Final phase — confirm the manual walkthrough before closing the plan.

---

## Testing Strategy

### Unit Tests:

- None automated (no test framework in the repo by design). The `srs.ts` helper is the natural
  future unit-test target if a runner is later introduced — note in the epilogue.

### Integration / Isolation Tests:

- Extend `scripts/verify-rls.mjs` (Phase 1) to assert cross-user isolation on the new SRS
  columns and retain the anon-role zero-rows assertion.

### Manual Testing Steps:

1. Fresh signed-in user with saved cards → `/study` serves a never-studied card.
2. Reveal → grade "Good" → card reschedules, next card appears.
3. Grade all cards → "all caught up" state.
4. Second user cannot see or grade first user's cards (RLS script + spot check).
5. `curl` the review endpoint with a foreign/nonexistent id → `404`; bad rating → `400`.

## Performance Considerations

Each request is one in-memory scheduler call + one or two Supabase round-trips — well within
the Cloudflare free-tier CPU/subrequest caps (S-01 infra lesson). The `due` index keeps the
next-card query cheap. ts-fsrs adds no measurable bundle weight after tree-shaking.

## Migration Notes

- Additive, nullable columns — no backfill, existing rows keep `NULL` SRS state and are treated
  as never-studied. **Rollback**: `alter table ... drop column` for the nine columns + drop the
  `due` index; no data loss for the original card fields. RLS unchanged.

## References

- Research: `context/changes/spaced-repetition-study/research.md`
- ts-fsrs README: https://github.com/open-spaced-repetition/ts-fsrs/blob/main/packages/fsrs/README.md
- Endpoint pattern: `src/pages/api/flashcards/[id].ts:19-63`
- Page + island pattern: `src/pages/cards.astro:7-26`, `src/components/flashcards/SavedCardsView.tsx:28-32`
- Store + RLS: `supabase/migrations/20260624185919_create_flashcards.sql:11-75`
- Error-code union: `src/lib/flashcards/schemas.ts:40-49`
- RLS-as-launch-gate: `context/archive/2026-06-24-flashcard-store-rls/plan.md:11`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & Types

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — a363c4b
- [x] 1.2 Type generation succeeds and `Flashcard` row includes the 9 new fields — a363c4b
- [x] 1.3 RLS verification script passes: `node scripts/verify-rls.mjs` — a363c4b
- [x] 1.4 `astro sync` + `lint` + `build` pass — a363c4b

#### Manual

- [x] 1.5 Migrated table has 9 nullable columns + `due` index; existing rows have NULL SRS state — a363c4b
- [x] 1.6 No existing flashcard rows were mutated by the migration — a363c4b

### Phase 2: SRS Helper & API

#### Automated

- [x] 2.1 `astro sync` + `lint` + `build` pass (ts-fsrs bundles without `nodejs_compat` errors)
- [x] 2.2 Type checking passes — `applyGrade` output matches the `flashcards` Update type

#### Manual

- [x] 2.3 `GET /study/next` returns a new card for a fresh deck and `{ card: null }` when nothing is due
- [x] 2.4 `PATCH /<id>/review` initializes a new card and advances `due` on repeat grades
- [x] 2.5 Review returns 404 (foreign/missing id), 400 (bad rating), 401 (unauthenticated)

### Phase 3: Study UI

#### Automated

- [ ] 3.1 `astro sync` + `lint` + `build` pass
- [ ] 3.2 Unauthenticated `GET /study` redirects to `/auth/signin`

#### Manual

- [ ] 3.3 Full reveal→grade→advance loop works on `astro dev`; interval hints differ per button
- [ ] 3.4 Grading advances scheduling (graded card's `due` moves to the future)
- [ ] 3.5 "All caught up" state shows when no card is due
- [ ] 3.6 No regressions on `/cards`, `/generate`, `/create`
