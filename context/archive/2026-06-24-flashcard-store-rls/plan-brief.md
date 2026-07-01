# Per-user Flashcard Store with RLS Isolation — Plan Brief

> Full plan: `context/changes/flashcard-store-rls/plan.md`

## What & Why

Create the foundation (F-01) every downstream slice writes to: a single per-user `flashcards`
table in Supabase Postgres with Row-Level Security so a card is visible and mutable only by its
owner. This is the launch-gate guardrail — no cross-user visibility, no silent loss — and getting
RLS wrong is a silent regression, so isolation is _proven_, not assumed.

## Starting Point

No schema exists: `supabase/config.toml` has `schema_paths = []`, no `migrations/` dir, app uses
only `auth.users`. The Supabase CLI is installed (`2.23.4`, Postgres 17), the client is untyped
(`src/lib/supabase.ts:9`), and `SUPABASE_KEY` is the **anon key** — so RLS is genuinely enforced
at runtime. No test framework or Zod is present.

## Desired End State

A `flashcards` table (owner, question, answer, source, timestamps) with RLS enabled and four
owner-scoped policies. A committed `scripts/verify-rls.mjs` proves user B can't read/insert-as/
update/delete user A's card. The Supabase client is typed (`createServerClient<Database>`) and
sync/lint/build pass. The prod-push command is documented for a human to run.

## Key Decisions Made

| Decision            | Choice                              | Why (1 sentence)                                                              | Source |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------- | ------ |
| Schema scope        | owner/Q/A/timestamps **+ `source`** | S-01 needs ai-vs-manual to measure the "75% via AI" metric; avoids re-migrate | Plan   |
| RLS verification    | Throwaway two-user Node script      | Exercises the real anon-key+JWT path; repeatable in-repo evidence             | Plan   |
| DB types            | Generate + wire typed client now    | First consumer (S-01) inherits a type-safe `.from('flashcards')`              | Plan   |
| Prod migration      | Local verify; document prod push    | Keeps prod-touching step human-gated, like the deferred OpenRouter secret     | Plan   |
| Delete semantics    | Hard delete                         | PRD allows intentional delete; no-loss targets accidental/cross-user loss     | Plan   |
| Content constraints | NOT NULL + length-cap CHECKs        | DB integrity floor + partial guard on the unresolved AI input cap (Open Q1)   | Plan   |

## Scope

**In scope:** one `flashcards` table; RLS + 4 owner policies; constraints + index + `updated_at`
trigger; repeatable RLS isolation script; generated DB types + typed client; documented prod push.

**Out of scope:** CRUD endpoints/UI (S-01/02/03); SRS columns (S-04); soft delete; decks/tags;
auto prod migration; Zod/app-layer validation.

## Architecture / Approach

Standard Supabase migration workflow: one SQL migration → apply to local Supabase → generate types
→ wire typed client. The RLS proof is a standalone Node script that seeds two confirmed users with
the local service-role key, then drives two anon clients (one per user JWT) through SELECT/INSERT/
UPDATE/DELETE to assert isolation on the real runtime path. Prod rollout is a documented
`supabase db push` left to a human.

## Phases at a Glance

| Phase                          | What it delivers                              | Key risk                                            |
| ------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| 1. Migration & RLS policies    | `flashcards` table + RLS + 4 policies (local) | UPDATE policy missing `WITH CHECK`                  |
| 2. RLS isolation verification  | `scripts/verify-rls.mjs` passing              | Accidentally testing with service-role key (bypass) |
| 3. Typed client                | `database.types.ts` + `<Database>` generic    | Type-gen drift; build/lint regressions              |
| 4. Production rollout (manual) | Prod schema migrated, RLS confirmed           | Prod push silently drops RLS; human-only step       |

**Prerequisites:** local Supabase running (`npx supabase start`, needs Docker); prod creds for Phase 4 (human-held).
**Estimated effort:** ~1 session across 4 phases (Phase 4 is a human-run gate).

## Open Risks & Assumptions

- RLS UPDATE must carry both `USING` and `WITH CHECK`; the verify script must exercise UPDATE.
- Verification must use the anon key — the service-role key bypasses RLS and would falsely pass.
- Length caps (1000/2000) are provisional; S-01 may revisit when AI input cap (Open Q1) is set.
- A remote prod Supabase project exists (auth is live); Phase 4 assumes it can be linked + pushed.

## Success Criteria (Summary)

- `flashcards` exists with RLS on and four owner-scoped policies (local; then prod via manual gate).
- `node scripts/verify-rls.mjs` passes — cross-user read/insert/update/delete all blocked.
- Typed client compiles cleanly (`astro sync` + `lint` + `build`), ready for S-01 to consume.
