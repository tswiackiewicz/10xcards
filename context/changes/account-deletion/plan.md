# Account Deletion with 30-Day Retention — Implementation Plan

## Overview

Let a signed-in user request deletion of their account. The request immediately marks the account
as pending deletion (soft-delete), hides all their data via RLS, and signs them out. Their data
stays recoverable for a 30-day window during which they can self-service reactivate. After 30 days
a scheduled job permanently erases the account and — via the existing `on delete cascade` FK — all
their flashcards. This is roadmap slice **S-05**.

## Current State Analysis

- **Auth is anon-key + RLS only.** The single client factory (`src/lib/supabase.ts:1-25`) uses the
  anon `SUPABASE_KEY` and forwards the user's cookies, so it acts as the logged-in user under RLS.
  There is **no service-role credential anywhere** (`astro.config.mjs:17-23`, `.dev.vars`,
  `.env.example`) — so `auth.admin.deleteUser` (the permanent purge) is not possible today.
- **One user-scoped table.** `public.flashcards` is the only app-owned table; its only FK is
  `user_id → auth.users(id) on delete cascade` (`supabase/migrations/20260624185919_create_flashcards.sql:13`).
  Deleting the auth user erases all flashcards automatically.
- **Everything relies on RLS for scoping** — no app-code `user_id` filters exist. Query sites:
  `src/pages/cards.astro:12`, `src/lib/flashcards/study.ts:14-21`,
  `src/pages/api/flashcards/[id]/review.ts:54`, plus mutations in `index.ts`, `manual.ts`, `[id].ts`.
- **No account state** beyond `auth.users`; no `profiles` table; no metadata usage.
- **Sign-in** (`src/pages/api/auth/signin.ts:13-19`) calls `signInWithPassword`, redirects to `/`
  on success — the natural place to divert a flagged account.
- **Server-page + island pattern** is established (`src/pages/cards.astro` reads via the SSR client,
  renders a `client:load` React island); `Topbar.astro` and `dashboard.astro` hold nav links;
  `src/components/ui/alert-dialog.tsx` exists (used for card delete in S-03).
- **`observability.enabled: true`** in `wrangler.jsonc:14-16` (Workers Logs on). CI deploys from
  GitHub via `wrangler-action`; secrets follow the `astro.config.mjs` env schema → `.dev.vars` →
  `wrangler secret put` → GitHub repo secret pattern.

Full evidence: `context/changes/account-deletion/research.md`.

## Desired End State

- A `/account` page (linked from Topbar + dashboard) shows a "Danger zone" with a type-to-confirm
  delete control. Requesting deletion signs the user out; their flashcards are immediately invisible.
- Signing in during the window lands the user on `/account` showing a "scheduled for deletion —
  reactivate?" panel. Reactivating restores full access.
- A daily GitHub Actions job POSTs to a secret-guarded `/api/cron/purge`; accounts past 30 days are
  permanently deleted (auth user + cascade), the job is idempotent, and emits an explicit
  success/failure log line.
- `scripts/verify-rls.mjs` proves: a pending-deletion user sees zero flashcards; reactivation
  restores them; post-purge no rows survive for that `user_id`; a purge with nothing eligible is a
  no-op.

Verify: run `scripts/verify-rls.mjs` (exits 0); manually walk request → data-hidden → sign-out →
reactivate → data-restored; manually trigger the purge route against a >30-day-old test row and
confirm the user and their flashcards are gone.

### Key Discoveries:

- Cascade is the purge: `flashcards.user_id … on delete cascade` (`create_flashcards.sql:13`) —
  `admin.deleteUser(id)` is the whole erasure.
- Soft-delete blocking belongs in RLS (extend policy `using`), not app queries — zero query-site
  changes (research §B).
- Service-role plane is genuinely new (research "Architecture Insights") — isolate it in Phase 3.
- RLS verification uses the anon-key + real-user-JWT path; service-role only seeds/cleans
  (`scripts/verify-rls.mjs:174-178`).

## What We're NOT Doing

- **No PRD edit in this plan.** The missing right-to-erasure FR is tracked as a risk (see Open Risks);
  a follow-up `/10x-prd` run adds it. Not a blocker for implementation.
- **No native Cloudflare `scheduled()` handler / Cron Trigger.** Blocked on an unverified adapter
  question (research Open Q1); we use a guarded route + GitHub Actions instead.
- **No admin/support UI** for recovery — recovery is self-service via reactivation only.
- **No email notifications** (deletion-requested / purge-imminent). Out of scope for this slice.
- **No changes to the S-06 review-flow files** — disjoint from `ux-improvements`.
- **No generalization of the service-role client** beyond what the purge needs.

## Implementation Approach

Three phases along the credential seam. Phases 1–2 ship the complete user-visible soft-delete
experience using only the existing anon+RLS plane — no new secret, no blocked-on-human step. Phase 3
adds the service-role plane and the scheduled purge; it is gated on you provisioning
`SUPABASE_SERVICE_ROLE_KEY` (human-only), so it lands after 1–2 are verified. The `account_deletions`
table (Phase 1) is the shared contract: Phase 2 writes/deletes rows, Phase 3 reads eligible rows.

## Critical Implementation Details

- **RLS pending-deletion check must use a `SECURITY DEFINER` helper, not a raw cross-table subquery.**
  Embedding `not exists (select 1 from account_deletions …)` directly in the `flashcards` policy makes
  the subquery subject to `account_deletions`' own RLS, which is fragile. Define
  `public.is_pending_deletion(uid uuid) returns boolean language sql security definer` that reads
  `account_deletions` bypassing RLS, and reference it from the `flashcards` policies. Mark it
  `stable`, set an empty `search_path`, and grant execute to `authenticated`.
- **Sign-in divert, not hard block.** Self-service cancel needs a live session, so a flagged account's
  `signInWithPassword` still succeeds; `signin.ts` then redirects to `/account` (not `/`). RLS keeps
  their data hidden meanwhile, so the diverted session is safe. The "block" is "never lands in the app
  proper + data hidden," with reactivation as the escape hatch.
- **Purge idempotency + subrequest budget.** `/api/cron/purge` deletes N users with N admin calls;
  the free-tier subrequest cap is 50/request (research §D). Process a bounded batch per invocation
  (e.g. the oldest ≤N eligible) and let the daily cadence drain the rest; log the count skipped.
- **Purge must not fail silently.** Emit a structured success/failure log line (Workers Logs is on) —
  a silent failure retains data past the promised window (GDPR liability).

## Phase 1: Data model + soft-delete RLS

### Overview

Introduce the `account_deletions` table, the pending-deletion helper, and extend `flashcards` RLS so a
pending-deletion user's data is immediately invisible and immutable. Regenerate DB types. Prove the
blocking in `verify-rls.mjs`.

### Changes Required:

#### 1. Migration: `account_deletions` table + RLS

**File**: `supabase/migrations/<UTC-timestamp>_create_account_deletions.sql`

**Intent**: Store one row per account that has requested deletion. Presence of a row = pending; the
row's timestamp drives the 30-day purge boundary; deleting the row = cancel/reactivate. FK cascades so
the row self-cleans when the auth user is purged.

**Contract**: Table `public.account_deletions` — `user_id uuid primary key references auth.users(id)
on delete cascade`, `requested_at timestamptz not null default now()`. Index not required (PK covers
lookups; purge scans the whole small table). RLS enabled; GRANT select/insert/delete to
`authenticated` only (no update, no `anon`). Three owner policies (`auth.uid() = user_id`):
`account_deletions_select_own`, `account_deletions_insert_own`, `account_deletions_delete_own`.
Follow the house migration style (header comment referencing `verify-rls.mjs`, section banners).

#### 2. Migration: `is_pending_deletion` helper + extend `flashcards` RLS

**File**: same migration file as (1)

**Intent**: Give the `flashcards` policies a safe way to ask "is the current user pending deletion?"
and fold that into every owner policy so pending users can neither read nor mutate their cards.

**Contract**: `public.is_pending_deletion(uid uuid) returns boolean language sql stable security
definer set search_path = ''` — body `select exists(select 1 from public.account_deletions d where
d.user_id = uid)`; `grant execute … to authenticated`. Then `alter`/recreate the four `flashcards`
policies so each predicate becomes `auth.uid() = user_id and not public.is_pending_deletion(auth.uid())`
(the `select`/`update`/`delete` `using` clauses and the `insert`/`update` `with check` clauses).

```sql
-- illustrative: the recreated select policy
create policy "flashcards_select_own" on public.flashcards
for select to authenticated
using (auth.uid() = user_id and not public.is_pending_deletion(auth.uid()));
```

#### 3. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new table so the app + scripts are typed.

**Contract**: Regenerate via the project's Supabase type-gen (the command that produced the current
file). `account_deletions` Row/Insert/Update types appear under `public.Tables`.

#### 4. Extend RLS verification (blocking + reactivation)

**File**: `scripts/verify-rls.mjs`

**Intent**: Prove the soft-delete blocking and its reversal on the real anon+JWT path.

**Contract**: Add assertions using the existing two-user harness: after inserting an
`account_deletions` row for user A (service-role seed), A's anon client `select * from flashcards`
returns zero rows and A's insert/update/delete affect zero rows; after deleting that row, A sees their
rows again. Keep the existing assertions intact.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local Supabase (`npx supabase db reset` or migration up)
- `astro sync` + type check pass with regenerated types: `npx astro sync && npm run lint`
- Build passes: `npm run build`
- RLS suite passes including new assertions: `node scripts/verify-rls.mjs` (exits 0)

#### Manual Verification:

- Inspecting the DB, a pending-deletion user's flashcards still physically exist (soft, not hard)
- Removing the `account_deletions` row restores visibility for that user

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation before proceeding.

---

## Phase 2: Request / cancel / sign-in divert + `/account` UI

### Overview

Wire the user-facing soft-delete: a `/account` page with a type-to-confirm danger zone and a
reactivate panel, the two endpoints that write/delete the `account_deletions` row, and the sign-in
divert. Anon+RLS plane only — no new secret.

### Changes Required:

#### 1. Delete-request endpoint

**File**: `src/pages/api/account/delete.ts`

**Intent**: Record the deletion request for the session user, then sign them out (immediate
revocation on the requesting device).

**Contract**: `POST` handler mirroring the existing API shape (`json`/`fail` helpers, `createClient`,
`auth.getUser()` → 401 if absent). Inserts `{ user_id }` into `account_deletions` (idempotent —
treat a duplicate/pending row as success), then `supabase.auth.signOut()`, returns `200 { ok: true }`.
Reuse/extend the `ApiErrorCode` union in `src/lib/flashcards/schemas.ts` or add a small account-scoped
error set — implementer's call to keep it consistent.

#### 2. Reactivate endpoint

**File**: `src/pages/api/account/reactivate.ts`

**Intent**: Cancel a pending deletion for the session user.

**Contract**: `POST` handler; `auth.getUser()` → 401 if absent; `delete from account_deletions where
user_id = <session user>` (RLS pins it; 0-row delete is still success). Returns `200 { ok: true }`.

#### 3. Sign-in divert

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Route a flagged account to `/account` instead of into the app.

**Contract**: After a successful `signInWithPassword` (`:13-15`), query `account_deletions` for the
signed-in user; if a row exists, `redirect("/account")` instead of `redirect("/")`. Error path
unchanged.

#### 4. `/account` server page

**File**: `src/pages/account.astro`

**Intent**: Host the account-management island; fetch pending-deletion state server-side.

**Contract**: Mirror `cards.astro` — read `Astro.locals.user`, create the SSR client, query
`account_deletions` for the user, render `<Layout title="Account">` + `<AccountView client:load
pending={boolean} requestedAt={string|null} />`. (Purge date = `requestedAt + 30d`, computed for
display.)

#### 5. `AccountView` island

**File**: `src/components/account/AccountView.tsx`

**Intent**: Render either the danger-zone delete UI or the reactivate panel, and call the endpoints.

**Contract**: Props `{ pending: boolean; requestedAt: string | null }`. When not pending: a "Danger
zone" card with a shadcn `AlertDialog` whose confirm button is disabled until the user types their
email (passed in, or "DELETE"); confirm → `POST /api/account/delete` → on success redirect to
`/auth/signin`. When pending: a panel showing the scheduled purge date with a "Reactivate account"
button → `POST /api/account/reactivate` → on success redirect to `/dashboard`. Use the `postJson`
fetch pattern from `GenerateView.tsx` and existing `Button`/`AlertDialog` components.

#### 6. Protect `/account` + nav links

**Files**: `src/middleware.ts`, `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Guard the route and make it reachable.

**Contract**: Add `"/account"` to `PROTECTED_ROUTES` (`middleware.ts:4`). Add an "Account" link in
`Topbar.astro` (next to Dashboard/Sign out) and a nav link in `dashboard.astro` alongside the existing
buttons.

### Success Criteria:

#### Automated Verification:

- Type check + lint pass: `npx astro sync && npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- On `/account`, the delete button stays disabled until the confirm text matches; confirming signs
  the user out and their flashcards are gone from `/cards` and `/study`
- Signing back in lands on `/account` showing the reactivate panel with the correct purge date
- Reactivating restores access; `/cards` shows the cards again
- `/account` redirects to `/auth/signin` when signed out (middleware guard)

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Hard-delete purge + GitHub Actions cron (service-role plane)

### Overview

Add the service-role plane and the scheduled permanent erasure. Gated on you provisioning
`SUPABASE_SERVICE_ROLE_KEY` and `CRON_PURGE_SECRET`.

### Changes Required:

#### 1. New secrets in the env schema

**Files**: `astro.config.mjs`, `.env.example`, `.dev.vars`

**Intent**: Declare the service-role key and the cron shared-secret as server-only secrets.

**Contract**: Add `SUPABASE_SERVICE_ROLE_KEY` and `CRON_PURGE_SECRET` as
`envField.string({ context: "server", access: "secret", optional: true })` in `astro.config.mjs`
(matching `OPENROUTER_API_KEY`). Add both to `.env.example` (placeholder) and `.dev.vars` (local
values). Production: `npx wrangler secret put …` + GitHub repo secrets (human-gated, documented).

#### 2. Service-role admin client factory

**File**: `src/lib/supabase-admin.ts`

**Intent**: A privileged client for unattended, RLS-bypassing operations (user deletion).

**Contract**: `createAdminClient()` using `createClient` from `@supabase/supabase-js` with
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, no cookie wiring, `auth: { persistSession: false }`.
Returns `null` if the key is unset (mirrors `src/lib/supabase.ts` guard). This is the only module that
touches the service-role key.

#### 3. Guarded purge route

**File**: `src/pages/api/cron/purge.ts`

**Intent**: Permanently erase accounts past the 30-day window; safe to call repeatedly.

**Contract**: `POST` handler. Reject unless the `Authorization: Bearer <CRON_PURGE_SECRET>` header
matches (constant-time compare) → `401`. Build the admin client (→ `503` if unconfigured). Select
`account_deletions where requested_at < now() - interval '30 days'`, oldest first, limited to a bounded
batch (see Critical Implementation Details). For each, `admin.auth.admin.deleteUser(user_id)` — the
`on delete cascade` FKs erase `flashcards` and the `account_deletions` row. Emit a structured log line
with counts (eligible, deleted, skipped, errors). Return `200 { deleted, skipped }`. Idempotent: a run
with nothing eligible deletes nothing.

#### 4. Scheduled GitHub Actions workflow

**File**: `.github/workflows/purge.yml`

**Intent**: Invoke the purge daily.

**Contract**: `on: schedule: - cron: "0 3 * * *"` (+ `workflow_dispatch` for manual runs). A single
job that `curl -fsS -X POST` the production `/api/cron/purge` URL with
`Authorization: Bearer ${{ secrets.CRON_PURGE_SECRET }}`; fail the job on non-2xx so failures surface
in the Actions UI.

#### 5. Extend RLS verification (purge)

**File**: `scripts/verify-rls.mjs`

**Intent**: Prove permanent erasure and idempotency.

**Contract**: Add: seed user A with a flashcard and an `account_deletions` row backdated >30 days; call
the purge path (or invoke `admin.deleteUser` directly as the route does); assert a service-role query
finds zero flashcards and zero `account_deletions` rows for A's id; assert a second purge with nothing
eligible is a no-op. Reuse the existing service-role seed/teardown.

### Success Criteria:

#### Automated Verification:

- Type check + lint pass: `npx astro sync && npm run lint`
- Build passes: `npm run build`
- Purge + idempotency assertions pass: `node scripts/verify-rls.mjs` (exits 0)
- `curl` with a wrong/absent bearer secret returns 401 (local dev run)

#### Manual Verification:

- With secrets set locally, a backdated test account is fully gone after hitting the route (auth user
  - flashcards), and the log line reports the correct counts
- A second immediate call deletes nothing (idempotent)
- The GitHub Actions workflow runs on `workflow_dispatch` against production and reports success

**Implementation Note**: This phase cannot complete until `SUPABASE_SERVICE_ROLE_KEY` and
`CRON_PURGE_SECRET` are provisioned (human-only). Pause for that before the automated purge assertions.

---

## Testing Strategy

### Unit Tests:

- No unit-test framework is wired up (AGENTS.md). Verification is the standalone `verify-rls.mjs`
  harness plus lint/build, consistent with the project.

### Integration Tests (`scripts/verify-rls.mjs`):

- Pending-deletion user's own reads/mutations affect zero rows (Phase 1)
- Removing the pending row restores access (Phase 1)
- Post-purge: zero flashcards and zero `account_deletions` rows survive for the deleted user (Phase 3)
- Purge idempotency: nothing eligible → no-op (Phase 3)
- All pre-existing cross-user isolation assertions still pass

### Manual Testing Steps:

1. Sign in → `/account` → type email → confirm delete → verify sign-out and empty `/cards`, `/study`
2. Sign back in → land on `/account` reactivate panel with correct purge date → reactivate → verify
   `/cards` shows cards again
3. Backdate a test `account_deletions` row >30 days → POST `/api/cron/purge` with the bearer secret →
   verify the auth user and flashcards are gone and the log line is correct
4. POST the purge route with a bad secret → verify 401

## Performance Considerations

- The `is_pending_deletion` helper adds a tiny indexed PK lookup to `flashcards` policy evaluation;
  negligible for per-user card volumes.
- The purge issues one admin call per account; bounded per run to stay under the 50-subrequest free-tier
  cap, with the daily cadence draining any backlog.

## Migration Notes

- One new migration adds `account_deletions`, the helper function, and recreates the four `flashcards`
  policies. Existing `flashcards` rows/policies are otherwise untouched; no backfill.
- New secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_PURGE_SECRET`) are human-gated: set via
  `wrangler secret put` for prod and GitHub repo secrets for CI. Rotating the service-role key is a
  human-only action.
- Rollback: dropping the new policies' pending-deletion clause (or the migration) restores prior
  behavior; the `account_deletions` table can be dropped if the feature is reverted before purge use.

## References

- Related research: `context/changes/account-deletion/research.md`
- RLS + cascade pattern: `supabase/migrations/20260624185919_create_flashcards.sql:13,52-75`
- RLS verification harness: `scripts/verify-rls.mjs:174-178`
- Server-page + island pattern: `src/pages/cards.astro`
- Secret-wiring precedent: `context/archive/2026-06-25-ai-card-generation/plan.md`,
  `context/archive/2026-07-02-deployment/deployment-plan.md:29-38,80`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model + soft-delete RLS

#### Automated

- [x] 1.1 Migration applies cleanly against a local Supabase
- [x] 1.2 Type check + lint pass with regenerated types (`npx astro sync && npm run lint`)
- [x] 1.3 Build passes (`npm run build`)
- [x] 1.4 RLS suite passes including new blocking/reactivation assertions (`node scripts/verify-rls.mjs`)

#### Manual

- [x] 1.5 Pending-deletion user's flashcards still physically exist in the DB (soft, not hard)
- [x] 1.6 Removing the `account_deletions` row restores visibility for that user

### Phase 2: Request / cancel / sign-in divert + /account UI

#### Automated

- [ ] 2.1 Type check + lint pass (`npx astro sync && npm run lint`)
- [ ] 2.2 Build passes (`npm run build`)

#### Manual

- [ ] 2.3 Delete button stays disabled until confirm text matches; confirming signs out and hides cards
- [ ] 2.4 Signing back in lands on `/account` reactivate panel with correct purge date
- [ ] 2.5 Reactivating restores access; `/cards` shows cards again
- [ ] 2.6 `/account` redirects to `/auth/signin` when signed out

### Phase 3: Hard-delete purge + GitHub Actions cron

#### Automated

- [ ] 3.1 Type check + lint pass (`npx astro sync && npm run lint`)
- [ ] 3.2 Build passes (`npm run build`)
- [ ] 3.3 Purge + idempotency assertions pass (`node scripts/verify-rls.mjs`)
- [ ] 3.4 Purge route returns 401 with a wrong/absent bearer secret

#### Manual

- [ ] 3.5 Backdated test account fully erased (auth user + flashcards) after hitting the route; log counts correct
- [ ] 3.6 Second immediate call deletes nothing (idempotent)
- [ ] 3.7 GitHub Actions workflow runs on `workflow_dispatch` against production and reports success
