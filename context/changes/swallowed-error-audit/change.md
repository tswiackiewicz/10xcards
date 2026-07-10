---
change_id: swallowed-error-audit
title: Swallowed error audit (try/catch log-without-propagate pattern)
status: preparing
created: 2026-07-10
updated: 2026-07-10
---

## Notes

Requested: identify a "swallowed error" in the project — a try/catch that
logs an exception but doesn't propagate it into the API response. Full
codebase sweep (three parallel agents + manual verification) found **no**
occurrence of this anti-pattern under `src/pages/api/**`, `src/middleware.ts`,
or `src/lib/**`. See `research.md` for the detailed sweep and a related,
lower-severity finding in `src/lib/flashcards/generation.ts` (silent-degrade
without logging, not a strict match).
