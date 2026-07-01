---
change_id: manual-card-authoring
title: Manual card authoring
status: archived
created: 2026-07-01
updated: 2026-07-01
archived_at: 2026-07-01T17:36:59Z
---

## Notes

Roadmap S-02 (Stream B). Outcome: user can create a flashcard manually
(question + answer) and have it saved to their deck.

- PRD refs: FR-005
- Prerequisites: F-01 (`flashcard-store-rls`) — done, store + RLS in place.
- Parallel with S-01 (`ai-card-generation`) — done; shares no code path with
  generation. This is the fallback path when AI output doesn't fit.
- Risk: smallest slice, depends only on the store. Low risk.
