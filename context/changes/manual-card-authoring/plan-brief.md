# Manual Card Authoring — Plan Brief

> Full plan: `context/changes/manual-card-authoring/plan.md`

## What & Why

Roadmap S-02 / PRD FR-005: let a signed-in user create a flashcard by hand (question +
answer) and save it to their deck as `source:'manual'`. It's the fallback path when AI
generation (S-01) doesn't fit the material. Deliberately isolated from the AI wedge — a
fallback feature should not touch north-star code.

## Starting Point

F-01 and S-01 are done. The `flashcards` table already has
`source ... default 'manual' check (source in ('ai','manual'))` with owner-scoped RLS and
length CHECKs — **no migration needed**. `POST /api/flashcards` exists but hardcodes
`source:"ai"`. Zod `candidateSchema`, the typed Supabase client, and the `/generate` page +
island pattern (protected via `middleware.ts` `PROTECTED_ROUTES`) are all in place. No test
framework — verification is `astro sync` + `lint` + `build` + manual UI check.

## Desired End State

A protected `/create` page hosts a Q/A form. On "Save card" the card persists with
`source:'manual'` and the session's `user_id` (under RLS), a green "Card saved to your deck"
message shows, and the form clears for the next card. Empty fields disable save; over-length
input and save failures show inline messages with input preserved. Dashboard links to
`/create`. The S-01 AI flow is unchanged.

## Key Decisions Made

| Decision       | Choice                                     | Why (1 sentence)                                                                                       | Source |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------ |
| Save path      | New `POST /api/flashcards/manual` endpoint | Leaves the proven AI batch-save (core wedge) untouched; zero regression risk.                          | Plan   |
| `source` value | Insert `source:'manual'` explicitly        | Keeps the "75%-via-AI" metric accurate; reusing the AI endpoint would mislabel.                        | Plan   |
| UI placement   | New protected page `/create` + island      | Mirrors the established `/generate` pattern; dashboard stays a nav hub.                                | Plan   |
| Post-save UX   | Inline confirmation + clear form           | Matches S-01 save UX; supports rapid multi-card entry; no dependency on the not-yet-built list (S-03). | Plan   |
| Validation     | Reuse `candidateSchema` (Q≤1000, A≤2000)   | Caps can't drift from the DB CHECKs or the AI path.                                                    | Plan   |
| `user_id`      | From `auth.getUser()`, never the body      | RLS pins it; confirmed correct by the S-01 impl-review.                                                | Plan   |

## Scope

**In scope:** single-card manual save endpoint (`source:'manual'`); reused Zod schema;
`ManualCardForm` island; `/create.astro` page; middleware protection; dashboard link;
inline error/confirmation UX.

**Out of scope:** view/list/edit/delete (S-03); redirect-to-list on save; SRS (S-04); any
change to the AI generate/save path; DB migration; batch entry; test framework.

## Architecture / Approach

Bottom-up, two phases mirroring S-01. **Phase 1:** `POST /api/flashcards/manual` — auth via
`getUser()`, validate one `{question,answer}` with `candidateSchema`, insert one row with
`source:'manual'` + session `user_id` under RLS, return `{saved:1}`. **Phase 2:**
`ManualCardForm` island (controlled fields, typed-error→copy map, reset on success) mounted
by `/create.astro`, `/create` added to `PROTECTED_ROUTES`, dashboard link added.

## Phases at a Glance

| Phase                    | What it delivers                              | Key risk                                               |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------ |
| 1. Manual save endpoint  | `POST /api/flashcards/manual` (source:manual) | Mislabeling source; trusting user_id from the body     |
| 2. Authoring page & form | `/create` page + form + dashboard link        | Missing middleware guard; client caps drifting from DB |

**Prerequisites:** F-01 + S-01 done (both are); local Supabase running for manual verification.
**Estimated effort:** ~1 after-hours session across 2 phases.

## Open Risks & Assumptions

- The endpoint must set `source:'manual'` (not rely on ambiguity) and derive `user_id` from
  the session — the two ways this slice could silently break a guardrail/metric.
- `/create` must be added to `PROTECTED_ROUTES`, or flashcard authoring leaks to anon users.
- Client-side length guard compares `trim().length` to mirror the server (S-01 impl-review F4).

## Success Criteria (Summary)

- A signed-in user can create a card via `/create`; it saves with `source='manual'` and their `user_id`.
- Signed-out access to `/create` redirects to sign-in; only owner can see/manage the row (RLS).
- Save shows a clear confirmation and clears the form; failures show a friendly message with input kept.
- The `/generate` AI flow is unaffected.
