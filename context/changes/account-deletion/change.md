---
change_id: account-deletion
title: Account deletion with 30-day retention
status: implementing
created: 2026-07-02
updated: 2026-07-02
archived_at: null
---

## Notes

Roadmap slice **S-05** (`context/foundation/roadmap.md`). User can request account deletion;
the account is immediately marked deleted and sign-in blocked, all data stays recoverable for a
30-day window, then is permanently erased across every user-scoped store.

- **PRD gap:** no dedicated right-to-erasure FR yet — anchors to the GDPR NFR by intent. See Open
  Roadmap Question 3 (re-run `/10x-prd` to add an explicit erasure FR before/alongside planning).
- **Open unknowns** (from the slice): how the 30-day purge is triggered on Cloudflare Workers
  (Cron Trigger vs. purge-on-access), and where "deleted" state lives (app uses only Supabase
  `auth.users` + the `flashcards` table; no account-state schema yet).
- **Parallel with S-06** (`ux-improvements`) — assessed low conflict risk: disjoint file sets,
  different layers. Watch soft-delete read-filtering if it spreads across `/api/flashcards/*`.
