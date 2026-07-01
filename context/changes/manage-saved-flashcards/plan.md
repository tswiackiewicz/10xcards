# Manage Saved Flashcards Implementation Plan

## Overview

Deliver roadmap S-03 (PRD FR-006/007/008): a signed-in user can **view** their saved
flashcards in a list, **edit** any card, and **delete** any card. The deck already exists
and is fully owner-scoped; this slice adds the management surface on top of it. Delivered as
one coherent `/cards` page, split into three phases that map 1:1 to the three FRs so each is
independently shippable with its own manual-verification gate.

## Current State Analysis

The store and its guardrails are already complete — this slice is additive UI + read/mutate
endpoints, no data-model work.

- **Data layer is done.** `supabase/migrations/20260624185919_create_flashcards.sql` defines
  `flashcards(id, user_id, question, answer, source, created_at, updated_at)` with owner-scoped
  RLS for **SELECT, UPDATE, and DELETE** (`auth.uid() = user_id`), CRUD grants to
  `authenticated`, per-field CHECKs (Q 1–1000, A 1–2000), and a `flashcards_set_updated_at`
  BEFORE-UPDATE trigger. **No migration is needed.**
- **Typed DB access exists.** `src/db/database.types.ts` exposes the `flashcards` `Row`,
  `Insert`, and `Update` types; `createClient(headers, cookies)` (`src/lib/supabase.ts`)
  returns an RLS-bound `SupabaseClient<Database>` (or `null` when unauthenticated).
- **Endpoint pattern is established** (`src/pages/api/flashcards/index.ts`, `manual.ts`):
  `createClient` → 401 if null → `auth.getUser()` → `json()`/`fail()` helpers → typed
  `ApiErrorCode` → zod `safeParse`. `user_id` is always taken from the verified session,
  never the request body; RLS double-pins each row.
- **Validation is shared.** `candidateSchema` (`src/lib/flashcards/schemas.ts`) validates a
  `{question, answer}` pair against caps that mirror the DB CHECKs. `ApiErrorCode` currently
  covers `invalid_input | unauthorized | save_failed | …`.
- **UI convention is established.** React islands on protected Astro pages
  (`PROTECTED_ROUTES = ["/dashboard","/generate","/create"]` in `src/middleware.ts`),
  controlled Q/A textareas with live char counters, an `ERROR_COPY` typed-error→copy map,
  **inline** confirmation/error alerts (emerald/red glass panels — no toast system exists),
  cosmic/glass theme, shadcn `Button` + lucide icons. `dashboard.astro` is a nav hub linking
  `/generate` and `/create`. `ManualCardForm.tsx` and `CandidateCard.tsx` are the closest
  reusable field/edit patterns.
- **Gap to fill.** No endpoint lists, edits, or deletes a single card by id; no management
  page exists. Only `button` is installed under `src/components/ui/` (the app hand-rolls the
  rest) — the delete-confirmation dialog needs `shadcn add alert-dialog`.
- **No test framework.** Verification is `npx astro sync` + `npm run lint` + `npm run build`
  - manual UI check (same as S-01/S-02).

## Desired End State

A signed-in user visits `/cards` (linked from the dashboard) and sees every card in their
deck, newest first, each showing the full question and answer plus an `AI`/`Manual` source
badge. They can click **Edit** on any card to flip that row into inline editable Q/A fields
(same caps and counters as authoring), save the change (persisted, `updated_at` auto-touched)
or cancel. They can click **Delete**, confirm in a dialog, and the card is removed from the
deck and the list. An empty deck shows a friendly prompt linking to Generate/Create.
Signed-out access to `/cards` redirects to sign-in; a user can only ever see or mutate their
own cards (RLS). The S-01 generate flow and S-02 create flow are unchanged.

### Key Discoveries:

- RLS UPDATE + DELETE policies and grants already exist — `create_flashcards.sql:64-75,46`.
- `updated_at` auto-touch trigger fires on any UPDATE — `create_flashcards.sql:35-38`.
- Endpoint auth/validation pattern to copy verbatim — `src/pages/api/flashcards/index.ts:16-54`.
- Shared `candidateSchema` reused for the PATCH body — `src/lib/flashcards/schemas.ts:17-28`.
- Island field/counter/error pattern to adapt — `src/components/flashcards/ManualCardForm.tsx`.
- Typed `Row`/`Update` for the card — `src/db/database.types.ts` (`flashcards`).
- RLS makes another user's (or a missing) row invisible, so an UPDATE/DELETE by a bad id
  affects **0 rows** rather than erroring — the endpoints must detect this and return 404.

## What We're NOT Doing

- No DB migration, schema change, or new RLS policy (the store already supports all three ops).
- No pagination, infinite scroll, search, or filtering (render the full deck; deferred risk).
- No soft-delete / undo / trash — delete is a hard delete gated by an explicit confirm dialog.
- No batch/multi-select operations; edit and delete act on one card at a time.
- No change to the S-01 generate or S-02 manual save paths or their endpoints.
- No SRS/study features (S-04).
- No new toast/notification system — reuse the existing inline-alert pattern.
- No client-side `GET` list endpoint — the initial list is server-rendered.

## Implementation Approach

Bottom-up per phase, mirroring S-01/S-02. The `/cards` page is server-rendered: the Astro
page runs one RLS-scoped Supabase `SELECT` and passes the rows to a `SavedCardsView` island
as props, so first paint needs no client fetch or spinner. The island owns the deck in local
state; edits and deletes call the new by-id endpoint and then mutate that local state in place
(no full-page reload). Phase 1 ships the read-only list. Phase 2 adds `PATCH` + inline edit.
Phase 3 adds `DELETE` + the confirm dialog. Edit and Delete share a single dynamic route file
`src/pages/api/flashcards/[id].ts` (Phase 2 creates it with `PATCH`; Phase 3 adds `DELETE`).

## Critical Implementation Details

- **0-row mutations are "not found", not success.** Because RLS hides rows the caller doesn't
  own, an UPDATE/DELETE targeting a non-existent or foreign id silently affects zero rows and
  returns no error. Both handlers must `.select()` the affected rows and treat an empty result
  as `404 not_found` — otherwise the UI would report a phantom success. This is the one
  non-obvious server detail in the slice.

## Phase 1: View saved cards (FR-006)

### Overview

Server-render the user's deck at a protected `/cards` page and display it read-only, newest
first, with a source badge and an empty state. Wire routing and navigation.

### Changes Required:

#### 1. Shared card type

**File**: `src/lib/flashcards/schemas.ts`

**Intent**: Export a single `Flashcard` type so the page, props, and island agree on the row
shape without re-deriving it. Also add a `not_found` code to `ApiErrorCode` now (used by
Phases 2–3) so the union is defined in one place.

**Contract**: `export type Flashcard = Database["public"]["Tables"]["flashcards"]["Row"]`
(import the generated `Database` type from `@/db/database.types`). Extend `ApiErrorCode` with
`"not_found"`.

#### 2. Saved-cards list page

**File**: `src/pages/cards.astro`

**Intent**: Protected page that queries the current user's cards server-side and hands them to
the island. Mirrors `create.astro`'s Layout + island-mount structure.

**Contract**: Build a client via `createClient(Astro.request.headers, Astro.cookies)`; select
`*` from `flashcards` ordered by `created_at` descending (RLS scopes to the owner). Render
`<SavedCardsView client:load cards={cards} />` inside `Layout`. On a query error, pass an empty
list (the island shows its empty/error state rather than crashing the page).

#### 3. Saved-cards island (read-only for this phase)

**File**: `src/components/flashcards/SavedCardsView.tsx`

**Intent**: Render the deck as a list of card rows and hold the cards in local state (so later
phases can mutate them). This phase is display-only.

**Contract**: `export default function SavedCardsView({ cards }: { cards: Flashcard[] })`.
Initialize state from `cards`. Render one row per card showing full question + answer and an
`AI`/`Manual` badge derived from `source`, using the existing glass-panel styling. When the
deck is empty, render a friendly empty state with links to `/generate` and `/create`. Card-row
markup should live in a small `SavedCard` sub-component (or row block) that Phases 2–3 extend
with edit/delete controls.

#### 4. Route protection + navigation

**File**: `src/middleware.ts`, `src/pages/dashboard.astro`

**Intent**: Guard `/cards` and let users reach it.

**Contract**: Add `"/cards"` to `PROTECTED_ROUTES`. Add a "My flashcards" link to the
dashboard hub alongside the existing Generate/Create links (same anchor styling).

### Success Criteria:

#### Automated Verification:

- Type generation is current: `npx astro sync`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Signed-in user visits `/cards` and sees all their cards, newest first, with full Q+A and an AI/Manual badge.
- A user with no cards sees the empty state linking to Generate/Create.
- Signed-out access to `/cards` redirects to sign-in.
- A second user does not see the first user's cards (RLS).
- Dashboard shows a working "My flashcards" link.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Edit a card (FR-007)

### Overview

Add a by-id `PATCH` endpoint and inline edit-in-place in each card row.

### Changes Required:

#### 1. Edit endpoint

**File**: `src/pages/api/flashcards/[id].ts`

**Intent**: Persist an edited question/answer for one owned card. Reuses the established auth

- validation pattern and the shared `candidateSchema`.

**Contract**: `export const PATCH: APIRoute`. Auth via `createClient` + `auth.getUser()`
(401 `unauthorized` otherwise). Validate `context.params.id` as a UUID → `400 invalid_input`
if malformed. Parse body with `candidateSchema` (`manualCardSchema`) → `400 invalid_input`.
`update({ question, answer }).eq("id", id).select("id")` (RLS pins the owner; `updated_at`
auto-touches via trigger). Empty result → `404 not_found`. DB error → `500 save_failed`.
Success → `200 { updated: 1 }`.

```ts
// 0-row result means the id doesn't exist or isn't ours (RLS) — not a success.
const { data, error } = await supabase.from("flashcards").update({ question, answer }).eq("id", id).select("id");
if (error) return fail(500, "save_failed");
if (!data || data.length === 0) return fail(404, "not_found");
```

#### 2. Inline edit mode in the card row

**File**: `src/components/flashcards/SavedCardsView.tsx`

**Intent**: Let a row toggle between read view and an editable Q/A form, save via the PATCH
endpoint, and reflect the change in local state without a reload.

**Contract**: Add an editing state to the card row. In edit mode, render controlled Q/A
textareas with the same live char counters and caps (`QUESTION_MAX`/`ANSWER_MAX`) and
`canSave` guard as `ManualCardForm`, plus Save/Cancel `Button`s. On Save, `PATCH
/api/flashcards/{id}` with `{question, answer}`; on success update that card in local state and
exit edit mode; on failure show an inline error via an `ERROR_COPY` map (include `not_found`).
Cancel restores the original values. Only one row edits at a time.

### Success Criteria:

#### Automated Verification:

- Type generation is current: `npx astro sync`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Editing a card's question/answer and saving persists the change (visible after reload).
- Over-length or empty input disables Save; server rejects it with an inline message and input is preserved.
- Editing a card you don't own / a bad id returns not-found (verify via crafted request; RLS-blocked).
- Cancel discards edits and restores the original text.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Delete a card (FR-008)

### Overview

Add a by-id `DELETE` endpoint and a confirm-gated delete control that honors the no-loss
guardrail (intentional delete allowed; accidental loss prevented by an explicit confirmation).

### Changes Required:

#### 1. Delete endpoint

**File**: `src/pages/api/flashcards/[id].ts`

**Intent**: Hard-delete one owned card.

**Contract**: Add `export const DELETE: APIRoute` to the same file. Same auth + UUID
validation as PATCH. `delete().eq("id", id).select("id")` (RLS pins the owner). Empty result →
`404 not_found`. DB error → `500 save_failed`. Success → `200 { deleted: 1 }`.

#### 2. Confirmation dialog component

**File**: `src/components/ui/alert-dialog.tsx` (generated)

**Intent**: Provide the confirm gate. Not currently installed.

**Contract**: `npx shadcn@latest add alert-dialog` (new-york style, matches `components.json`).
Adds `@radix-ui/react-alert-dialog`. Do not hand-roll.

#### 3. Delete control in the card row

**File**: `src/components/flashcards/SavedCardsView.tsx`

**Intent**: A Delete button on each row that opens an AlertDialog ("Delete this card? This
can't be undone."); confirming calls the DELETE endpoint and removes the row from local state.

**Contract**: Add a destructive-styled Delete `Button` (lucide `Trash2`) per row wired to an
`AlertDialog`. On confirm, `DELETE /api/flashcards/{id}`; on success remove that card from
local state (and show the empty state if it was the last one); on failure show an inline error
via the `ERROR_COPY` map. Cancel/escape closes the dialog with no change.

### Success Criteria:

#### Automated Verification:

- Type generation is current: `npx astro sync`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking Delete opens a confirmation dialog; canceling leaves the card intact.
- Confirming deletes the card from the deck (gone after reload) and removes the row from the list.
- Deleting the last card shows the empty state.
- Deleting a card you don't own / a bad id returns not-found (RLS-blocked; verify via crafted request).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Testing Strategy

No automated test framework is wired up (consistent with S-01/S-02). Verification per phase is
`npx astro sync` → `npm run lint` → `npm run build`, then manual UI checks.

### Manual Testing Steps:

1. Sign in, create/generate a few cards, then open `/cards`; confirm all appear newest-first with correct badges.
2. Edit a card, save, reload; confirm the change persisted and `updated_at` moved.
3. Attempt over-length and empty edits; confirm Save is blocked / server rejects with input preserved.
4. Delete a card via the confirm dialog; confirm it's gone after reload; cancel a delete and confirm no change.
5. Sign in as a second user; confirm none of the first user's cards are visible or mutable (RLS).
6. Hit `/cards` signed-out; confirm redirect to sign-in.

## Performance Considerations

The list renders the full deck in one SSR query — fine for MVP deck sizes and aligned with the
`speed` roadmap goal. If decks grow into the hundreds, revisit with pagination or a virtualized
list (tracked as a deferred risk, not in this slice).

## Migration Notes

None. The `flashcards` table, its RLS policies (incl. UPDATE/DELETE), grants, and the
`updated_at` trigger already exist from F-01.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD: FR-006/007/008, no-loss guardrail — `context/foundation/prd.md:101-110,125-126`
- Sibling slice (patterns): `context/archive/2026-07-01-manual-card-authoring/plan.md`
- Store + RLS: `supabase/migrations/20260624185919_create_flashcards.sql`
- Endpoint pattern: `src/pages/api/flashcards/index.ts`
- Field/UI pattern: `src/components/flashcards/ManualCardForm.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: View saved cards (FR-006)

#### Automated

- [x] 1.1 Type generation is current: `npx astro sync` — 14a163d
- [x] 1.2 Linting passes: `npm run lint` — 14a163d
- [x] 1.3 Build succeeds: `npm run build` — 14a163d

#### Manual

- [x] 1.4 Signed-in user sees all their cards at `/cards`, newest first, full Q+A + AI/Manual badge — 14a163d
- [x] 1.5 Empty deck shows the empty state linking to Generate/Create — 14a163d
- [x] 1.6 Signed-out access to `/cards` redirects to sign-in — 14a163d
- [x] 1.7 A second user does not see the first user's cards (RLS) — 14a163d
- [x] 1.8 Dashboard shows a working "My flashcards" link — 14a163d

### Phase 2: Edit a card (FR-007)

#### Automated

- [x] 2.1 Type generation is current: `npx astro sync` — 682f3cb
- [x] 2.2 Linting passes: `npm run lint` — 682f3cb
- [x] 2.3 Build succeeds: `npm run build` — 682f3cb

#### Manual

- [x] 2.4 Editing a card and saving persists the change (visible after reload) — 682f3cb
- [x] 2.5 Over-length/empty input disables Save; server rejects with inline message, input preserved — 682f3cb
- [x] 2.6 Editing a non-owned / bad id returns not-found (RLS-blocked) — 682f3cb
- [x] 2.7 Cancel discards edits and restores original text — 682f3cb

### Phase 3: Delete a card (FR-008)

#### Automated

- [x] 3.1 Type generation is current: `npx astro sync`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build succeeds: `npm run build`

#### Manual

- [x] 3.4 Delete opens a confirmation dialog; canceling leaves the card intact
- [x] 3.5 Confirming deletes the card (gone after reload) and removes the row from the list
- [x] 3.6 Deleting the last card shows the empty state
- [x] 3.7 Deleting a non-owned / bad id returns not-found (RLS-blocked)
