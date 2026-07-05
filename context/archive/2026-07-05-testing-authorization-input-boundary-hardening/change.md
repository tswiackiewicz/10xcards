---
change_id: testing-authorization-input-boundary-hardening
title: Prove per-resource ownership checks and input-boundary handling
status: archived
created: 2026-07-05
updated: 2026-07-05
archived_at: 2026-07-05T18:32:38Z
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md` §3 ("Authorization &
input-boundary hardening"). Risks covered: #3, #7. Test types planned:
integration + unit.

Risk response intent (from test-plan.md §2 Risk Response Guidance):

- **Risk #3 (IDOR)** — An authenticated user reads, edits, or deletes another
  user's flashcard by manipulating a resource ID. Prove a request to
  read/edit/delete a flashcard by ID belonging to a different user is
  rejected (403/404), not merely absent from that user's list. Must
  challenge: "logged in" ≠ "authorized" — ownership must be checked
  per-resource, independent of whether RLS alone is relied on. Avoid: testing
  only that the list endpoint filters correctly (that proves list-scoping,
  not direct-ID access control).

- **Risk #7 (input boundary)** — Empty, whitespace-only, or over-cap input to
  AI generation returns an empty/failed result instead of an explanatory
  message. Prove submitting empty, whitespace-only, or over-the-cap source
  text returns a clear explanatory error, never an empty success result or an
  unhandled failure. Must challenge: "the happy path returns candidates"
  says nothing about the boundary. Avoid: happy-path-only testing that never
  exercises the exact boundary values named in the PRD acceptance criteria.

Next step after this change folder: `/10x-research` to ground both risks in
the actual code (which routes/clients enforce ownership, exact validation
rule and where it runs) before planning test sub-phases.
