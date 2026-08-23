# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Migrations aren't shipped until CI pushes them to production

- **Context**: Any change that adds or modifies a Supabase migration under supabase/migrations/, and any CI/CD pipeline change touching .github/workflows/ci.yml's deploy job.
- **Problem**: Migrations applied locally (via `supabase db reset`/`start`) don't automatically reach production. CI only ran `wrangler deploy` for Worker code — three migrations (account_deletions, optimize_pending_deletion_rls, add_srs_state) sat unapplied in prod for days with no failure, until the account-deletion purge cron hit a missing table and returned a 500.
- **Rule**: Never assume a migration file existing in supabase/migrations/ means it's live in production — confirm the CI deploy pipeline actually pushes schema changes (supabase db push), not just app code, before treating a DB-dependent feature as shipped.
- **Applies to**: plan, implement, impl-review

## UI copy is English-only; AI card content follows the source text

- **Context**: Any change touching user-facing strings — page copy, headings, `<title>`/meta tags, form labels, error and banner messages, transactional emails.
- **Problem**: The project started from a starter whose config-status banner shipped 6 Polish strings (`src/lib/config-status.ts`, `Layout.astro`). They survived unnoticed because no test asserts copy language, and a diacritics-only grep passes over words like `Uwaga`/`Dokumentacja`. Mixed-language chrome reads as unfinished and blocks any future i18n baseline.
- **Rule**: All UI chrome is written in English, with no exceptions and no per-market forks. The one carve-out is AI-generated flashcard *content*, which follows the language of the user's source text by design (`src/lib/flashcards/generation.ts`) — that is user data, not chrome. When adding a language gate to CI, grep for both diacritics **and** known non-English literals; diacritics alone miss too much.
- **Applies to**: plan, implement, impl-review
