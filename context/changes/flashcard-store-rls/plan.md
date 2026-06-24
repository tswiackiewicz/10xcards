# Per-user Flashcard Store with RLS Isolation — Implementation Plan

## Overview

Create the foundation every downstream slice writes to: a single per-user `flashcards`
table in Supabase Postgres with Row-Level Security (RLS) that makes a card visible and
mutable only by its owner, and that survives sessions. F-01 from `context/foundation/roadmap.md`.

The store is deliberately minimal — one owner-scoped entity, not a data layer. The
load-bearing risk is RLS correctness: getting it wrong is a silent cross-user-visibility
regression, so isolation is _verified with a repeatable script_, not assumed.

## Current State Analysis

- **No schema exists.** `supabase/config.toml` has `schema_paths = []`; there is no
  `supabase/migrations/` directory and no `seed.sql`. The app currently uses only
  Supabase's built-in `auth.users`.
- **Supabase CLI is installed** — `supabase@2.23.4` (devDependency), Postgres `major_version = 17`.
- **Supabase client is untyped** — `src/lib/supabase.ts:9` calls `createServerClient` with no
  `<Database>` generic; no generated `database.types.ts` exists anywhere in the repo.
- **`SUPABASE_KEY` is the anon public key** (confirmed in README). This is critical: runtime
  queries go through the anon key + the user's JWT, so **RLS is actually enforced** — it is
  not bypassed by a service-role key. The isolation guarantee is real, which is exactly why
  it must be verified.
- **Middleware** (`src/middleware.ts:10-12`) sets `locals.user` via `auth.getUser()`;
  `PROTECTED_ROUTES = ["/dashboard"]`. The client is created per-request via
  `createClient(headers, cookies)` and is **not** attached to locals.
- **No Zod, no test framework.** API routes (`src/pages/api/auth/*`) use a redirect pattern,
  no JSON, no validation library. There is no harness to lean on for RLS verification — it
  must be a standalone artifact.

## Desired End State

A `flashcards` table exists in Supabase with:

- columns `id`, `user_id` (→ `auth.users`), `question`, `answer`, `source` (`'ai' | 'manual'`),
  `created_at`, `updated_at`;
- RLS enabled with owner-scoped SELECT/INSERT/UPDATE/DELETE policies keyed on `auth.uid()`;
- NOT NULL + length-cap CHECK constraints and an index on `user_id`.

Verification: a committed `scripts/verify-rls.mjs` runs against local Supabase and passes —
proving user B cannot read, insert-as, update, or delete user A's card. The Supabase client
is typed (`createServerClient<Database>`) and `npx astro sync && lint && build` all pass. The
exact production-push command is documented for a human to run as the final manual gate.

### Key Discoveries:

- `src/lib/supabase.ts:9` — untyped client; this is where the `<Database>` generic gets wired.
- `supabase/config.toml` `schema_paths = []` — migrations are the mechanism, not declarative schema.
- README confirms `SUPABASE_KEY` = anon key → RLS enforced at runtime (verification is meaningful).
- `package.json` has `supabase@2.23.4` and `@supabase/supabase-js@2.99.1` — type-gen and the
  verify script have everything they need; no new deps required.

## What We're NOT Doing

- **No CRUD API endpoints, no UI.** Reading/writing cards through the app is S-01/S-02/S-03.
  F-01 only creates the store, proves isolation, and types the client.
- **No SRS/scheduling columns** (due date, interval, ease) — S-04's algorithm is unpicked;
  those fields would be guesses. Out of scope.
- **No soft delete.** Hard delete per FR-008; the no-loss guardrail targets accidental/cross-user
  loss, not user-initiated deletion.
- **No decks/tags/relations.** One flat owner-scoped entity only.
- **No automatic production migration.** Prod push is a documented, human-executed manual gate.
- **No new validation framework (Zod).** DB-level CHECKs are the integrity floor for now;
  app-layer validation arrives with the first consumer slice.

## Implementation Approach

Standard Supabase migration workflow: author one SQL migration, apply it to local Supabase
(`supabase start` + `db reset`), generate TypeScript types from the local schema, and wire the
typed client. The RLS proof is a standalone Node script (no test framework exists) that uses the
local service-role key to seed two confirmed users, then drives two anon-key clients (one per
user JWT) through the real runtime path to assert isolation. Production rollout is a documented
`supabase db push` left to a human — mirroring the project's existing "secrets/prod actions are
human-gated" posture (cf. the deferred OpenRouter secret).

## Critical Implementation Details

- **RLS UPDATE needs both `USING` and `WITH CHECK`.** `USING` gates which rows are visible to
  update; `WITH CHECK` gates the post-update row. Omitting `WITH CHECK` lets a user reassign
  `user_id` to themselves on someone else's row in some patterns — both clauses must pin
  `auth.uid() = user_id`. The verify script must cover the UPDATE case explicitly.
- **Verification must use the anon key + a real user JWT, never the service-role key.** The
  service-role key bypasses RLS, so a test run with it would falsely pass. The script seeds users
  with the service-role (admin) client but performs all isolation assertions with anon clients
  signed in as each user.
- **User seeding.** Local email confirmation is already OFF (`supabase/config.toml:209`
  `enable_confirmations = false`), so a plain `signUp` is auto-confirmed and sign-in works
  immediately. Seeding via the admin API with `email_confirm: true` is the more robust path (it
  stays correct even if confirmations are later enabled), but either works locally.

## Phase 1: Migration & RLS Policies

### Overview

Author the `flashcards` migration — table, constraints, index, `updated_at` trigger, RLS enable,
and four owner-scoped policies — and apply it to local Supabase.

### Changes Required:

#### 1. Flashcards migration

**File**: `supabase/migrations/<timestamp>_create_flashcards.sql` (new)

**Intent**: Create the owner-scoped `flashcards` store with integrity constraints and full RLS so
that, at the database level, a card is only ever visible/mutable by its owner.

**Contract**:

- Table `public.flashcards`:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `question text not null check (char_length(question) between 1 and 1000)`
  - `answer text not null check (char_length(answer) between 1 and 2000)`
  - `source text not null default 'manual' check (source in ('ai','manual'))`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Index `idx_flashcards_user_id on public.flashcards (user_id)`.
- `updated_at` auto-touch trigger (BEFORE UPDATE) via a small `set_updated_at()` trigger function.
- Explicit table GRANTs to the `authenticated` role:
  `grant select, insert, update, delete on public.flashcards to authenticated;`. RLS governs
  _which rows_; GRANT governs _whether the role can touch the table at all_. Supabase's default
  privileges usually cover this for new `public` tables, but stating it explicitly makes the table
  reachable deterministically across local and prod regardless of default-privilege state — and
  avoids a confusing "permission denied for table" that reads like an RLS failure. Do **not** grant
  to `anon` (unauthenticated access is forbidden; see Phase 2).
- `alter table public.flashcards enable row level security;`
- Four policies (role `authenticated`), all keyed on `auth.uid() = user_id`:
  - SELECT: `using (auth.uid() = user_id)`
  - INSERT: `with check (auth.uid() = user_id)`
  - UPDATE: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
  - DELETE: `using (auth.uid() = user_id)`

The length caps (1000 / 2000) are provisional; S-01 may revisit them when the AI input-size cap
(roadmap Open Q1) is decided.

#### 2. Apply locally

**Intent**: Bring the local Supabase database to the new schema so types and verification run
against real applied state.

**Contract**: `npx supabase start` (Docker) then `npx supabase db reset` (replays migrations on a
clean DB). No code change — this is an environment step whose output proves the migration is valid.

### Success Criteria:

#### Automated Verification:

- Migration applies with no error: `npx supabase db reset`
- Table exists with RLS on: `psql` query against local DB shows `relrowsecurity = true` for
  `public.flashcards` (e.g. `select relrowsecurity from pg_class where relname='flashcards';`)
- Four policies present: `select count(*) from pg_policies where tablename='flashcards';` returns `4`

#### Manual Verification:

- SQL review: the four policies each pin `auth.uid() = user_id`, and UPDATE carries both `USING`
  and `WITH CHECK`.
- Column/constraint review: `source` CHECK, NOT NULLs, and length caps match the contract.

**Implementation Note**: After Phase 1 automated checks pass, pause for manual confirmation that
the SQL review is satisfactory before proceeding to Phase 2.

---

## Phase 2: RLS Isolation Verification

### Overview

Prove the isolation guarantee with a repeatable script — the launch-gate evidence the roadmap
demands. This is the most important phase.

### Changes Required:

#### 1. Two-user isolation script

**File**: `scripts/verify-rls.mjs` (new)

**Intent**: Demonstrate, through the real runtime path (anon key + user JWT), that one user cannot
see or mutate another user's flashcards across all four operations.

**Contract**: A standalone Node ESM script (`@supabase/supabase-js`, already a dependency). Reads
three values from env vars — `SUPABASE_URL` (API URL), `SUPABASE_ANON_KEY` (anon key), and
`SUPABASE_SERVICE_ROLE_KEY` (service-role key) — all printed by `npx supabase status`. Invocation
inlines them, e.g. `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/verify-rls.mjs`.
Steps:

1. Admin (service-role) client creates two confirmed users (A and B) with `email_confirm: true`.
2. Two anon clients sign in as A and B respectively (each holds that user's JWT).
3. As A: insert a card → succeeds; capture its `id`.
4. As B: `select` all flashcards → must NOT include A's card (expect zero rows for B).
5. As B: attempt to `update` A's card by id → affects 0 rows (RLS hides it).
6. As B: attempt to `delete` A's card by id → affects 0 rows.
7. As B: attempt to `insert` a card with `user_id = A` → rejected by the INSERT `WITH CHECK`.
8. As a fresh anon client (NOT signed in): `select` flashcards → must return zero rows
   (covers the PRD "unauthenticated access is not permitted" guardrail; `anon` role has no policy).
9. As A: confirm own card is still intact and unchanged.
   Script exits non-zero with a clear message on any failed assertion; exits 0 only if all pass.
   Run via `node scripts/verify-rls.mjs` with the local credentials from `npx supabase status`.

### Success Criteria:

#### Automated Verification:

- Script passes end-to-end: `node scripts/verify-rls.mjs` exits 0
- The four cross-user isolation assertions (select, update, delete, insert-as-other) all hold
- The unauthenticated assertion holds: a signed-out anon client reads zero flashcards

#### Manual Verification:

- Review that assertions use anon clients (not the service-role key) for all isolation checks.
- Confirm the script's negative cases would actually fail loudly if a policy were dropped (e.g.
  spot-check by temporarily disabling one policy locally, then restoring).

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation before
proceeding to Phase 3.

---

## Phase 3: Typed Supabase Client

### Overview

Generate TypeScript types from the applied schema and wire the typed client so downstream slices
get type-safe `.from('flashcards')` queries.

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts` (new, generated)

**Intent**: Provide a `Database` type reflecting the `flashcards` schema for compile-time safety.

**Contract**: Output of `npx supabase gen types typescript --local > src/db/database.types.ts`.
File exports a `Database` type whose `public.Tables.flashcards` row matches the migration.
Treated as generated — not hand-edited.

#### 2. Typed client wiring

**File**: `src/lib/supabase.ts`

**Intent**: Parametrize the SSR client with the generated `Database` type so all callers get typed
queries; behavior is otherwise unchanged.

**Contract**: Import `Database` from `@/db/database.types` and change `createServerClient(...)` to
`createServerClient<Database>(...)`. No change to the cookie handlers, null-guard, or signature
beyond the generic. Existing callers (`middleware.ts`, `api/auth/*`) continue to compile unchanged.

### Success Criteria:

#### Automated Verification:

- Types regenerate cleanly: `npx supabase gen types typescript --local` produces a file referencing `flashcards`
- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In an editor, `supabase.from("flashcards").select()` autocompletes column names (typed client
  confirmed end-to-end).

**Implementation Note**: After Phase 3 automated checks pass, pause for manual confirmation before
proceeding to Phase 4.

---

## Phase 4: Production Rollout (Manual Gate)

### Overview

Apply the verified migration to the production Supabase project. Human-executed — the agent does
not run this; it documents and confirms.

### Changes Required:

#### 1. Production migration (human-run)

**File**: (no repo change — operational step)

**Intent**: Bring prod schema in line with the verified local schema so S-01 can run live.

**Contract**: Document and run, against the linked prod project:
`npx supabase link --project-ref <ref>` then `npx supabase db push`. Requires prod DB credentials
held by the human; not available in the planning/implementation session. After push, re-confirm
RLS is enabled on the prod `flashcards` table (same `pg_class` / `pg_policies` checks against prod).

### Success Criteria:

#### Manual Verification:

- `supabase db push` reports the `flashcards` migration applied to prod.
- Prod `flashcards` shows `relrowsecurity = true` and four policies.
- A smoke check (or repoint `verify-rls.mjs` env at a disposable prod/staging check) confirms
  isolation holds in prod — RLS not silently dropped in transit.

**Implementation Note**: This phase is human-gated end to end; there are no automated checks the
agent runs. Mark complete only after the human confirms the prod push.

---

## Testing Strategy

### Unit Tests:

- None — no test framework is wired up, and F-01 adds no application logic to unit-test.

### Integration Tests:

- `scripts/verify-rls.mjs` is the integration test: it exercises the real anon-key + JWT + RLS
  path across all four operations for two distinct users.

### Manual Testing Steps:

1. `npx supabase start` then `npx supabase db reset` — migration applies cleanly.
2. `node scripts/verify-rls.mjs` — isolation assertions pass.
3. Temporarily drop one policy locally, re-run the script — it must fail loudly; restore the policy.
4. `npx astro sync && npm run lint && npm run build` — typed client compiles.

## Performance Considerations

Negligible at MVP scale (small data volume, low QPS per the PRD). The `user_id` index keeps
per-user list queries (S-03) efficient as decks grow. RLS predicates are simple equality on an
indexed column.

## Migration Notes

- Migrations live in `supabase/migrations/`; `schema_paths` stays `[]` (declarative schema is not
  used). Commit the migration file.
- Production push is **manual and human-gated** (Phase 4): `supabase link` + `supabase db push`
  with prod credentials. Do not run it from the planning/implementation session.
- Rollback: the migration is additive (one new table). To revert, drop `public.flashcards`
  (cascades the trigger/policies); no existing data depends on it pre-S-01.

## References

- Roadmap item: `context/foundation/roadmap.md` (F-01)
- PRD: `context/foundation/prd.md` — Access Control, Guardrails, NFR (no-loss)
- Tech stack: `context/foundation/tech-stack.md`
- Untyped client to wire: `src/lib/supabase.ts:9`
- Auth route conventions: `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration & RLS Policies

#### Automated

- [x] 1.1 Migration applies with no error (`npx supabase db reset`) — 400dba5
- [x] 1.2 Table exists with RLS on (`relrowsecurity = true` for `public.flashcards`) — 400dba5
- [x] 1.3 Four policies present (`pg_policies` count = 4) — 400dba5

#### Manual

- [x] 1.4 SQL review: policies pin `auth.uid() = user_id`; UPDATE has USING + WITH CHECK — 400dba5
- [x] 1.5 Column/constraint review: source CHECK, NOT NULLs, length caps match contract — 400dba5

### Phase 2: RLS Isolation Verification

#### Automated

- [x] 2.1 `node scripts/verify-rls.mjs` exits 0 — e2d0d07
- [x] 2.2 Cross-user select/update/delete/insert-as-other assertions all hold — e2d0d07
- [x] 2.3 Unauthenticated (anon, signed-out) client reads zero flashcards — e2d0d07

#### Manual

- [x] 2.4 Review: isolation checks use anon clients, not the service-role key — e2d0d07
- [x] 2.5 Negative cases fail loudly when a policy is dropped (spot-check, then restore) — e2d0d07

### Phase 3: Typed Supabase Client

#### Automated

- [x] 3.1 `supabase gen types` produces `src/db/database.types.ts` referencing `flashcards`
- [x] 3.2 `npx astro sync` passes
- [x] 3.3 `npm run lint` passes
- [x] 3.4 `npm run build` passes

#### Manual

- [x] 3.5 `supabase.from("flashcards")` autocompletes typed columns in editor

### Phase 4: Production Rollout (Manual Gate)

#### Manual

- [ ] 4.1 `supabase db push` applies the flashcards migration to prod
- [ ] 4.2 Prod `flashcards` shows `relrowsecurity = true` and four policies
- [ ] 4.3 Isolation smoke check confirms RLS holds in prod
