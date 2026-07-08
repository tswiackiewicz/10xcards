---
change_id: testing-quality-gates-wiring
title: Wire quality gates — migration-drift CI check and AI review flow e2e smoke
status: implementing
created: 2026-07-08
updated: 2026-07-08
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Quality-gates wiring".
Risks covered: #5. Test types planned: gates + e2e.
Risk response intent: Risk #5: prove every migration file present in the repository is provably applied in the production database before a DB-dependent feature is treated as shipped; challenge "CI ran a dry-run" ≠ "CI pushed the migration" — those are different steps that can silently drift apart again; avoid treating "migration file exists in the repo" as equivalent to "schema is live" — that conflation caused the prior incident.
After creating the folder, follow the downstream continuation rule.
