# Manage Saved Flashcards — Plan Brief

> Full plan: `context/changes/manage-saved-flashcards/plan.md`

## What & Why

Roadmap S-03 / PRD FR-006/007/008: let a signed-in user **view** their saved flashcards,
**edit** any card, and **delete** any card. Without a management surface there's no way to
correct or prune what AI generation (S-01) and manual authoring (S-02) put in the deck.
Deletion must honor the no-loss guardrail — intentional delete is allowed; accidental/
cross-user loss is not.

## Starting Point

F-01 + S-01 + S-02 are done. The `flashcards` table already has owner-scoped RLS for
**SELECT, UPDATE, and DELETE**, CRUD grants, length CHECKs, and an `updated_at` auto-touch
trigger — **no migration needed**. The auth/validation endpoint pattern (`createClient` →
`getUser()` → `json`/`fail` → typed `ApiErrorCode` → zod), the shared `candidateSchema`
(Q≤1000, A≤2000), the typed Supabase client + `database.types.ts`, and the protected
page + React-island convention all exist. What's missing: any endpoint that lists/edits/
deletes a card by id, and a management page. Only `button` is installed under
`components/ui/`. No test framework — verify via `astro sync` + `lint` + `build` + manual.

## Desired End State

A protected `/cards` page (linked from the dashboard) SSR-lists the user's deck newest-first,
each row showing the full Q+A and an AI/Manual badge. **Edit** flips a row into inline Q/A
fields (same caps/counters as authoring) that save via `PATCH`. **Delete** opens a confirm
dialog, then hard-deletes via `DELETE` and drops the row. Empty deck shows a prompt linking to
Generate/Create. RLS keeps everything owner-only; the S-01/S-02 flows are untouched.

## Key Decisions Made

| Decision           | Choice                                             | Why (1 sentence)                                                                  | Source |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| List data fetch    | SSR query in `/cards.astro`, cards passed as props | Idiomatic for `output: server`; no new GET endpoint, no client loading state.     | Plan   |
| Edit UX            | Inline edit-in-place in the row                    | Reuses the proven textarea + counter + `ERROR_COPY` pattern; keeps context.       | Plan   |
| Delete UX          | shadcn AlertDialog confirm before hard delete      | Realizes the no-loss guardrail as an explicit intentional gate.                   | Plan   |
| Endpoint shape     | REST `/api/flashcards/[id].ts` (PATCH + DELETE)    | Conventional; both by-id mutations for one entity in one file.                    | Plan   |
| Placement          | New protected page `/cards`                        | Keeps dashboard a thin nav hub; mirrors page-per-feature (`/generate`,`/create`). | Plan   |
| List display       | Full Q+A, newest first, source badge               | No truncation logic; just-saved cards surface first; badge reuses `source`.       | Plan   |
| List scope         | Render all cards (no paging/search/filter)         | Matches the `speed` goal and MVP deck sizes; not in the FRs.                      | Plan   |
| Not-found on 0-row | UPDATE/DELETE affecting 0 rows → 404 `not_found`   | RLS hides foreign/missing rows, so 0-row must not be reported as success.         | Plan   |

## Scope

**In scope:** `/cards.astro` SSR list page; `SavedCardsView` island (read view, inline edit,
confirm-delete); `PATCH` + `DELETE` `/api/flashcards/[id]`; `shadcn add alert-dialog`; shared
`Flashcard` type + `not_found` error code; middleware guard + dashboard link.

**Out of scope:** DB migration; pagination/search/filter; soft-delete/undo/trash;
batch/multi-select; any change to S-01/S-02 paths; SRS (S-04); a client GET list endpoint.

## Architecture / Approach

Server-render the deck (`/cards.astro` runs one RLS-scoped `SELECT`) and hand it to the
`SavedCardsView` island as props — no client fetch on load. The island owns the deck in local
state; edit/delete call the by-id endpoint then mutate local state in place (no reload). Phase 1
ships the read-only list; Phase 2 adds `PATCH` + inline edit; Phase 3 adds `DELETE` + confirm
dialog. Edit and Delete share one dynamic route file.

## Phases at a Glance

| Phase              | What it delivers                               | Key risk                                              |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| 1. View (FR-006)   | `/cards` SSR list + island + empty state + nav | Missing middleware guard leaks the list to anon users |
| 2. Edit (FR-007)   | `PATCH /api/flashcards/[id]` + inline edit     | 0-row update reported as success; client caps drift   |
| 3. Delete (FR-008) | `DELETE /api/flashcards/[id]` + confirm dialog | Accidental deletion; 0-row delete reported as success |

**Prerequisites:** F-01 + S-01 done (both are); local Supabase running for manual verification.
**Estimated effort:** ~1–2 after-hours sessions across 3 phases.

## Open Risks & Assumptions

- Both by-id mutations must `.select()` and treat 0 rows as `404 not_found` — RLS hides
  foreign/missing rows, so a naive "no error = success" would report phantom writes.
- `/cards` must be added to `PROTECTED_ROUTES`, or the deck leaks to anon users.
- Client-side length guard must compare `trim().length` to mirror the server (S-01 impl-review).
- Rendering the whole deck is fine for MVP; large decks (hundreds) are a deferred perf risk.

## Success Criteria (Summary)

- A signed-in user can view, edit, and delete their own cards from `/cards`; changes persist across reloads.
- Deletion is gated by an explicit confirm dialog; only the owner can see or mutate a card (RLS).
- Signed-out access redirects to sign-in; the S-01 generate and S-02 create flows are unaffected.
