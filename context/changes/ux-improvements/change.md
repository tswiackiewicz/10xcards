---
change_id: ux-improvements
title: Candidate review UX — bulk actions, session reset, clearer loading states
status: implementing
created: 2026-07-02
updated: 2026-07-02
archived_at: null
---

## Notes

Roadmap slice **S-06** (`ux-improvements`).

- **Outcome:** on the AI candidate review flow, user can accept/reject candidates in bulk and reset a review session; long operations show clearer loading states so the screen never looks frozen.
- **PRD refs:** FR-004, NFR (visible progress for >~2s operations)
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-05
- **Scope guardrails:** polish over the existing S-01 review flow — no new data model, no redesign. Bulk reject must stay inside the human-gating guardrail (no silent auto-accept).
