# Spaced-Repetition Study (S-04) — Plan Brief

> Full plan: `context/changes/spaced-repetition-study/plan.md`
> Research: `context/changes/spaced-repetition-study/research.md`

## What & Why

Deliver FR-009: let a user study their deck on a spaced-repetition schedule where the
product decides which card to show next based on prior recall. We integrate **ts-fsrs**
(the canonical TypeScript FSRS scheduler, verified on `workerd`) rather than building an
algorithm — satisfying the PRD's explicit buy-not-build Non-Goal. This is the retention
half of the product's value proposition.

## Starting Point

The `flashcards` store (F-01) holds `question/answer/source` per owner with table-level
RLS, and cards are created via S-01/S-02 and managed via S-03. F-01 **deliberately left
out SRS columns** until the algorithm was chosen — so this plan adds them now, as the
planned continuation, not a retrofit.

## Desired End State

A signed-in user opens `/study`, sees a due (or never-studied) card, reveals the answer,
and grades recall on four buttons (Again/Hard/Good/Easy) annotated with the next interval.
The card reschedules via ts-fsrs, its FSRS state persists, and the next due card loads.
When nothing is due, an "all caught up" state shows.

## Key Decisions Made

| Decision         | Choice                             | Why (1 sentence)                                                        | Source   |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------- | -------- |
| SRS library      | ts-fsrs @^5.4.1                    | Canonical FSRS lib, zero-dep pure ESM, verified on `workerd`.           | Research |
| Schema shape     | 9 nullable columns on `flashcards` | Additive; existing RLS covers them; no backfill needed.                 | Research |
| Card queue       | Due + never-studied, oldest-first  | True SRS loop; new cards enter naturally via NULL-due.                  | Plan     |
| New-card init    | Lazy on first grade                | No backfill migration; init logic in one place (the helper).            | Plan     |
| Re-study / reset | None in MVP                        | FR-009 doesn't require it; avoids scope + no-loss-guardrail risk.       | Plan     |
| FSRS params      | Library defaults, hardcoded        | Zero config surface; sensible defaults from the algorithm's org.        | Plan     |
| Grade UX         | Four buttons with interval hints   | Canonical FSRS/Anki UX; uses the verified `repeat()` preview.           | Plan     |
| Verification     | RLS script + build + manual        | Matches repo practice (no test framework); RLS is the F-01 launch gate. | Plan     |

## Scope

**In scope:** SRS columns migration + type regen; RLS script extension; `srs.ts` helper;
`GET /api/flashcards/study/next`; `PATCH /api/flashcards/[id]/review`; `/study` page +
`StudyView` island; route protection; dashboard link.

**Out of scope:** custom algorithm, param-tuning UI, reset/re-study, per-user weight
optimization, new test framework, changes to generate/manual/manage surfaces, session caps.

## Architecture / Approach

ts-fsrs owns the scheduling math; the app owns **selection** (a Postgres query over `due`,
RLS-scoped) and **persistence** (the new columns). Date↔string conversion is confined to the
`srs.ts` helper boundary. Endpoints mirror the existing auth→validate→mutate→`0-row=404`
idiom; the page mirrors the `cards.astro` server-load + React-island pattern.

## Phases at a Glance

| Phase               | What it delivers                                            | Key risk                                                  |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| 1. Schema & Types   | 9 nullable FSRS columns + regen types + RLS script coverage | Getting RLS wrong on new columns (silent cross-user leak) |
| 2. SRS Helper & API | `srs.ts` + next-card + review endpoints                     | Date↔string serialization; lazy-init correctness          |
| 3. Study UI         | `/study` page + `StudyView` loop + route guard              | Interval-hint UX; advancing correctly on grade/404        |

**Prerequisites:** F-01 + S-01 done (both are). Local Supabase for migration + type-gen.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- ts-fsrs edge-compat is verified (`workerd` smoke test) but there's still no _first-party_
  Workers support statement — residual risk judged negligible.
- `learning_steps` must be persisted (easy to miss) or short-term relearning misbehaves.
- NULL-due ordering (new cards first, then past-due) must be right or the queue feels wrong.

## Success Criteria (Summary)

- User completes a full reveal→grade→advance loop; grading visibly moves a card's `due`.
- "All caught up" shows when nothing is due; a fresh deck is immediately studyable.
- RLS script confirms a user cannot see or grade another user's cards/scheduling state.
