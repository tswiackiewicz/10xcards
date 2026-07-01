# Manual Card Authoring Implementation Plan

## Overview

Add the manual flashcard authoring path (roadmap S-02, PRD FR-005): a signed-in user
fills a question + answer form and saves a single card to their deck as `source:'manual'`.
This is the fallback path for when AI output doesn't fit, and it shares no code with the
S-01 generation flow. It builds entirely on existing F-01 (store + RLS) and S-01 (Zod
schemas, typed client, page/island pattern) infrastructure.

## Current State Analysis

- **DB is ready, no migration.** `public.flashcards` already carries
  `source text not null default 'manual' check (source in ('ai','manual'))`
  (`supabase/migrations/20260624185919_create_flashcards.sql`), with owner-scoped RLS
  (SELECT/INSERT/UPDATE/DELETE) and length CHECKs (question 1–1000, answer 1–2000).
- **A save endpoint exists but is AI-specific.** `POST /api/flashcards`
  (`src/pages/api/flashcards/index.ts`) authenticates via `supabase.auth.getUser()`,
  validates the body with `saveRequestSchema`, and batch-inserts — but hardcodes
  `source: "ai"` (line 45). Reusing it as-is would save manual cards as `'ai'` and
  corrupt the "75%-via-AI" success metric, so manual authoring gets its own endpoint.
- **Schemas are reusable.** `src/lib/flashcards/schemas.ts` exports `candidateSchema`
  (`{ question, answer }` with the DB-mirroring caps) and the `ApiErrorCode` union.
- **UI pattern is established by S-01.** `/generate.astro` mounts a `client:load` React
  island inside `Layout.astro`; `GenerateView.tsx` owns fetch + typed-error mapping
  (`ERROR_COPY`) + green inline confirmation; `dashboard.astro` links to `/generate`;
  `src/middleware.ts` guards routes via the `PROTECTED_ROUTES` array (line 4).
- **No test framework** — verification is `astro sync` + `lint` + `build` + manual UI check,
  as in F-01/S-01.

### Key Discoveries:

- `flashcards.source` defaults to `'manual'` — the manual insert can rely on the default,
  but the plan sets it explicitly for clarity and symmetry with the AI path.
  (`supabase/migrations/20260624185919_create_flashcards.sql:14`)
- `user_id` must come from the verified session (`user.id`), never the request body — RLS
  additionally pins it. This was confirmed correct in the S-01 impl-review (F2).
  (`src/pages/api/flashcards/index.ts:40-47`)
- The typed error → friendly copy pattern lives client-side in `ERROR_COPY`
  (`src/components/flashcards/GenerateView.tsx:8-17`); the manual form reuses the same shape.
- `candidateSchema` already enforces `trim().min(1).max(...)` matching the DB CHECKs —
  the manual endpoint validates with the same schema, so caps can't drift.
  (`src/lib/flashcards/schemas.ts:17-20`)

## Desired End State

A signed-in user visits `/create` (protected), types a question and an answer, and clicks
"Save card". The card persists to `public.flashcards` with `source:'manual'` and their own
`user_id`. On success a green "Card saved to your deck" message appears and the form clears,
ready for the next card. Empty fields disable the button; over-length input and save
failures show a specific inline message with the entered text preserved (except after a
successful save, which clears it). The dashboard links to `/create`. `astro sync`, `lint`,
and `build` all pass. No change to the S-01 AI generate/save path.

## What We're NOT Doing

- No viewing, listing, editing, or deleting saved cards — that is S-03 (`manage-saved-flashcards`).
- No redirect to a saved-cards list after save (no list exists yet; stay on `/create`).
- No change to `POST /api/flashcards`, `GenerateView`, `generate.astro`, or the AI schemas.
- No new DB migration, no new columns, no SRS fields (S-04).
- No batch/multi-card entry — one card per save.
- No test framework introduction.

## Implementation Approach

Bottom-up in two phases, mirroring S-01: **(1)** a dedicated single-card save endpoint that
reuses the existing Zod `candidateSchema`, sets `source:'manual'`, and derives `user_id` from
the session under RLS; **(2)** a `/create` page mounting a `ManualCardForm` island that posts
to the endpoint, maps typed error codes to friendly copy, and resets on success. The manual
path is deliberately isolated from the AI wedge so a fallback feature never touches
north-star code.

## Phase 1: Manual save endpoint

### Overview

Add a dedicated endpoint that accepts one `{ question, answer }` card and inserts it as
`source:'manual'`, reusing existing validation, auth, and RLS patterns.

### Changes Required:

#### 1. Manual card request schema

**File**: `src/lib/flashcards/schemas.ts`

**Intent**: Provide a request schema for a single manual card so the endpoint validates the
same length caps as the DB and the AI path, without coupling to the batch `saveRequestSchema`.

**Contract**: Add `manualCardSchema = candidateSchema` (a single `{ question, answer }` object)
and export `type ManualCardRequest = z.infer<typeof manualCardSchema>`. Reuse the existing
`candidateSchema` rather than redefining caps. No change to existing exports or `ApiErrorCode`.

#### 2. Manual save endpoint

**File**: `src/pages/api/flashcards/manual.ts` (new)

**Intent**: Persist one manually authored flashcard for the signed-in user as `source:'manual'`.

**Contract**: `export const POST: APIRoute`. Mirror `index.ts` structure: build the RLS client
with `createClient(context.request.headers, context.cookies)`; return `401 unauthorized` if no
client or no `getUser()` user; parse JSON body (catch → `400 invalid_input`); validate with
`manualCardSchema` (`400 invalid_input` on failure); insert a single row
`{ question, answer, source: "manual", user_id: user.id }` via `supabase.from("flashcards").insert(...)`
(`500 save_failed` on error); return `200 { saved: 1 }`. Reuse the local `json`/`fail` helper
shape from `index.ts`. `user_id` comes from the session, never the body.

### Success Criteria:

#### Automated Verification:

- Type generation passes: `npx astro sync`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `curl -X POST /api/flashcards/manual` with a valid body while signed in returns `200 {"saved":1}`
  and the row appears in Supabase with `source='manual'` and the caller's `user_id`.
- Unauthenticated request returns `401`; empty/over-length question or answer returns `400 invalid_input`.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 2: Authoring page & form

### Overview

Build the `/create` page and the `ManualCardForm` island, link it from the dashboard, and
protect the route.

### Changes Required:

#### 1. Manual card form island

**File**: `src/components/flashcards/ManualCardForm.tsx` (new)

**Intent**: A controlled question/answer form that posts to `/api/flashcards/manual`, shows a
loading state while saving, maps typed error codes to friendly copy, and on success shows a
green confirmation and clears the fields for the next card.

**Contract**: Default-exported React component. Local state for `question`, `answer`, a
`status: "idle" | "saving"`, an `error: ApiErrorCode | null`, and a `saved: boolean`. Reuse the
`postJson` fetch shape and a local `ERROR_COPY` map keyed by `ApiErrorCode` (only the codes this
path can return: `invalid_input`, `unauthorized`, `save_failed`; plus an over-length hint).
Save button disabled when either trimmed field is empty, over the caps, or `status==="saving"`.
On `ok`, set `saved`, clear both fields; on failure set `error` and preserve input. Match the
Tailwind styling and `Button`/`lucide-react` usage from `GenerateView.tsx`. Import caps
(`QUESTION_MAX`/`ANSWER_MAX`) — export them from `schemas.ts` if not already exported — to drive
the client-side length guard, comparing `trim().length` (per S-01 impl-review F4).

#### 2. Create page

**File**: `src/pages/create.astro` (new)

**Intent**: Host the manual authoring island on a protected page consistent with `/generate`.

**Contract**: Mirror `generate.astro` — `Layout title="Create flashcard"`, the same `bg-cosmic`
container and header markup with a "← Dashboard" link, mounting `<ManualCardForm client:load />`.

#### 3. Route protection

**File**: `src/middleware.ts`

**Intent**: Guard `/create` behind auth like the other app pages.

**Contract**: Add `"/create"` to the `PROTECTED_ROUTES` array (line 4). No other change.

#### 4. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Give users a way to reach manual authoring.

**Contract**: Add an anchor to `/create` ("Create flashcard") next to the existing "Generate
flashcards" link, matching its styling.

### Success Criteria:

#### Automated Verification:

- Type generation passes: `npx astro sync`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Visiting `/create` while signed out redirects to `/auth/signin`.
- Signed in, typing a question + answer and clicking "Save card" shows the green confirmation,
  clears the form, and the card is visible in Supabase with `source='manual'`.
- Empty fields keep the save button disabled; a save failure shows an inline message with input preserved.
- The dashboard "Create flashcard" link navigates to `/create`.
- The `/generate` flow still works unchanged (no regression).

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps:

1. Signed out, hit `/create` → redirected to `/auth/signin`.
2. Sign in, go to dashboard → click "Create flashcard" → lands on `/create`.
3. Enter a valid Q/A → "Save card" → green "Card saved to your deck", form clears.
4. Confirm the row in Supabase: correct `question`/`answer`, `source='manual'`, own `user_id`.
5. Leave a field empty → save button disabled. Paste an over-length question → inline hint, no save.
6. Simulate a failure (e.g. expire the session) → inline error, entered text preserved.
7. Regression: run the `/generate` AI flow end-to-end → still saves as `source='ai'`.

## Migration Notes

None — no schema change. The `flashcards.source` column and its CHECK/default already exist from F-01.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-02)
- PRD: FR-005 (`context/foundation/prd.md`)
- Reused save pattern: `src/pages/api/flashcards/index.ts`
- Reused UI/island pattern: `src/pages/generate.astro`, `src/components/flashcards/GenerateView.tsx:8-33`
- Schemas: `src/lib/flashcards/schemas.ts`
- S-01 impl-review lessons (user_id source, trimmed-length client check): `context/archive/2026-06-25-ai-card-generation/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Manual save endpoint

#### Automated

- [x] 1.1 Type generation passes: `npx astro sync` — 3e100c5
- [x] 1.2 Linting passes: `npm run lint` — 3e100c5
- [x] 1.3 Build passes: `npm run build` — 3e100c5

#### Manual

- [x] 1.4 Valid signed-in POST returns 200 {"saved":1}; row has source='manual' and caller's user_id — 3e100c5
- [x] 1.5 Unauthenticated → 401; empty/over-length question or answer → 400 invalid_input — 3e100c5

### Phase 2: Authoring page & form

#### Automated

- [x] 2.1 Type generation passes: `npx astro sync`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build passes: `npm run build`

#### Manual

- [x] 2.4 `/create` signed out redirects to `/auth/signin`
- [x] 2.5 Signed in, save shows green confirmation, clears form, row saved with source='manual'
- [x] 2.6 Empty fields disable save; save failure shows inline message with input preserved
- [x] 2.7 Dashboard "Create flashcard" link navigates to `/create`
- [x] 2.8 `/generate` AI flow still works (no regression)
