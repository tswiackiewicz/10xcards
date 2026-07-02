# Candidate Review UX (S-06) — Plan Brief

> Full plan: `context/changes/ux-improvements/plan.md`
> Research: `context/changes/ux-improvements/research.md`

## What & Why

Polish the AI candidate review flow (roadmap slice S-06) with three UX additions: **bulk accept/reject**, **reset a review session**, and **clearer loading states**. Motivation: reduce per-card clicking on large candidate sets and satisfy the >2s-progress NFR so the screen never looks frozen — without redesigning the flow.

## Starting Point

The whole review flow is one client island, `GenerateView.tsx` (+ `CandidateCard.tsx`). Per-card status is an enum on a single `cards` array, so counts and the save filter are already derived. Loading today is only an in-button spinner; the card area is blank during generate and controls stay live during save. The save endpoint already batch-inserts — no backend work needed.

## Desired End State

After generating, the user gets footer "Accept all" / "Reject all" (targeting pending cards), a "Reset" that returns the island to its empty start state (confirming first if there's unsaved work), a full-view spinner during generation, and a full control lock during save. Per-card accept/edit/reject still work; only explicitly accepted cards ever save.

## Key Decisions Made

| Decision             | Choice                                               | Why (1 sentence)                                                        | Source   |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| Bulk scope           | Accept/reject-all target **pending only**            | Preserves deliberate per-card decisions (FR-004 individual control).    | Plan     |
| Loading UX           | Full-view generate spinner + disable-all on save     | Satisfies >2s NFR, reuses StudyView idiom, closes the save-enabled gap. | Plan     |
| Reset confirmation   | `AlertDialog` **only when unsaved work exists**      | Guards accidental loss without nagging on an empty session.             | Plan     |
| ERROR_COPY type      | Narrow to `Partial<Record<ApiErrorCode,string>>`     | Removes a type lie in a file we're editing; matches sibling components. | Research |
| No streaming/timeout | Determinate-feel only; no AbortController this slice | Streaming was ruled out in S-01; timeout widens scope to the endpoint.  | Research |

## Scope

**In scope:** pending-only bulk accept/reject; `resetSession()` with conditional confirm; full-view generating spinner; disable-all during save (incl. new `disabled` prop on `CandidateCard`); `ERROR_COPY` type fix.

**Out of scope:** streaming/SSE; AbortController/timeout on the OpenRouter call; per-item multi-select/checkboxes; new endpoint/schema/migration; toast system; any review-flow redesign; test framework.

## Architecture / Approach

Two phases, both inside the review island. Phase 1 = behavior (bulk + reset handlers, footer controls, one `AlertDialog`), reusing the existing single `cards` array and setters. Phase 2 = loading clarity (full-view spinner, disable pass) + the type fix. No data flow beyond the existing two `fetch` calls.

## Phases at a Glance

| Phase                           | What it delivers                                          | Key risk                                                       |
| ------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Bulk actions & session reset | Accept/reject-all (pending), reset w/ conditional confirm | Bulk semantics must not clobber manual decisions or auto-save. |
| 2. Clearer loading & type fix   | Full-view generate spinner, disable-all on save, type fix | Disable coverage must be complete to prevent double-submit.    |

**Prerequisites:** F-01 + S-01 done (both archived). Local `OPENROUTER_API_KEY` for manual verification.
**Estimated effort:** ~1 session across 2 phases; single-file surface, low risk.

## Open Risks & Assumptions

- Design decisions were confirmed against the research recommendations while the user was away — all four are easily revisited on review (bulk scope, loading depth, reset gate, type fix).
- The un-bounded OpenRouter fetch can still hang the generating state indefinitely; the full-view spinner makes it _visible_ but not _bounded_ — bounding it is a deliberate follow-up, not this slice.
- CI does not run `tsc`/`astro check`, so the `ERROR_COPY` mismatch never failed the build; the fix is correctness hygiene, not a red-build fix.

## Success Criteria (Summary)

- On a large candidate set, one click accepts/rejects all remaining pending cards while manual per-card choices survive.
- Generation shows a visible working state; save locks the UI so nothing can be edited or double-submitted mid-write.
- Reset returns to a clean start state (confirming when work would be lost); only explicitly accepted cards ever reach the deck.
