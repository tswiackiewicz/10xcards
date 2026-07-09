---
change_id: test-plan-refresh-2026-07-09
title: Lifecycle & route-protection hardening (test-plan refresh)
status: implemented
created: 2026-07-09
updated: 2026-07-09
archived_at: null
---

## Notes

Opened by `/10x-test-plan --refresh` (2026-07-09) as rollout Phase 5:
"Lifecycle & route-protection hardening" — not yet added to
`context/foundation/test-plan.md` §3; backport after research grounds these
risks and the user confirms.

Risks covered (new, not yet in test-plan.md §2):

- **#8** — A route that should require authentication silently drifts out of
  the protected-routes list (or vice versa) as routes change, uncaught by any
  test. Impact High, Likelihood High. Source: interview (low-confidence area +
  under-tested, raised independently twice); hot-spot `src/middleware.ts`
  (6 commits/30d).
- **#9** — A user cancels a pending account deletion, but a purge run
  concurrent with or immediately after the cancellation still erases their
  data. Impact High, Likelihood Medium. Source: interview (top worry); PRD
  FR-010 ("all account data is recoverable for a 30-day retention window");
  Phase 3's `plan.md` explicit scope-out note ("not testing account
  reactivation — not part of Risk #4's failure scenario").
- **#10** — A card studied more than once schedules its next review at the
  wrong interval because prior SRS state isn't correctly reloaded on a repeat
  review. Impact Medium, Likelihood Medium. Source: test-plan.md §6.7 Phase 1
  mutation-testing note, which explicitly flagged this survivor as a refresh
  candidate.

Risk response intent:

- **#8** — prove every should-be-protected route rejects unauthenticated
  requests and every public route stays public, verified against an
  independently authored expected list (not a copy of the current
  `PROTECTED_ROUTES` array — that's the oracle problem). Cheapest layer:
  integration (real requests through middleware).
- **#9** — prove cancellation-before-purge always survives and the reverse
  ordering is deterministic, not a race — test both orderings, not just the
  happy one. Cheapest layer: integration (seed a pending-deletion row, control
  execution order of reactivation vs. purge).
- **#10** — prove a twice-studied card's next-review date reflects the prior
  outcome, not a first-time-studied default. Cheapest layer: unit if the
  scheduling function is pure, else integration.

Test types planned: integration + unit.

Full refresh brief (challenger-pass notes, impact/likelihood rubric detail):
`/private/tmp/claude-502/-Users-tswiackiewicz-Developer-personal-10xdevs/69b010f4-7ead-43b5-8b8d-32da22652996/scratchpad/refresh-brief-2026-07-09.md`
