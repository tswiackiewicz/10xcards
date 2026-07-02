-- S-05: Account deletion with 30-day retention — soft-delete state + RLS blocking
--
-- Introduces `account_deletions`: one row per account that has requested deletion.
-- Presence of a row = the account is pending deletion; `requested_at` drives the
-- 30-day purge boundary (Phase 3); deleting the row = cancel/reactivate. The FK
-- cascades so the row self-cleans when the auth user is permanently purged.
--
-- The soft-delete "block" lives entirely in RLS, not in app queries: a pending user
-- must neither read nor mutate their own flashcards. We fold that into the four
-- owner-scoped flashcards policies via a SECURITY DEFINER helper that reads
-- `account_deletions` bypassing its own RLS (a raw cross-table subquery would be
-- subject to that table's RLS and is fragile). Cross-user isolation and the
-- soft-delete blocking/reactivation are verified by scripts/verify-rls.mjs.

-- Table -----------------------------------------------------------------------

create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

-- Table privileges -------------------------------------------------------------
-- Grant only what the self-service flow needs: an owner may see their own request
-- (select), create one (insert), and cancel it (delete). No update — the row is
-- immutable once created. No grant to `anon` — unauthenticated access is forbidden.
-- `service_role` also needs table access: the Phase 3 purge reads eligible rows with
-- the service-role client (RLS-bypassing), and verify-rls.mjs seeds/cleans rows with it.

grant select, insert, delete on public.account_deletions to authenticated;
grant select, insert, delete on public.account_deletions to service_role;

-- Row-Level Security -----------------------------------------------------------

alter table public.account_deletions enable row level security;

create policy "account_deletions_select_own"
on public.account_deletions
for select
to authenticated
using (auth.uid() = user_id);

create policy "account_deletions_insert_own"
on public.account_deletions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "account_deletions_delete_own"
on public.account_deletions
for delete
to authenticated
using (auth.uid() = user_id);

-- Pending-deletion helper ------------------------------------------------------
-- SECURITY DEFINER so the flashcards policies can ask "is this user pending
-- deletion?" without the lookup being subject to `account_deletions`' own RLS.
-- `stable` (no writes, consistent within a statement), empty search_path (resolve
-- everything schema-qualified — defence against search_path hijacking), execute
-- granted to `authenticated` (the only role that evaluates flashcards policies).

create function public.is_pending_deletion(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_deletions d where d.user_id = uid);
$$;

grant execute on function public.is_pending_deletion(uuid) to authenticated;

-- Extend flashcards RLS with the soft-delete block -----------------------------
-- Recreate the four owner policies (F-01) so each predicate also requires the
-- owner to NOT be pending deletion. A pending user's rows physically remain
-- (soft-delete) but become invisible and immutable until they reactivate.

drop policy "flashcards_select_own" on public.flashcards;
drop policy "flashcards_insert_own" on public.flashcards;
drop policy "flashcards_update_own" on public.flashcards;
drop policy "flashcards_delete_own" on public.flashcards;

create policy "flashcards_select_own"
on public.flashcards
for select
to authenticated
using (auth.uid() = user_id and not public.is_pending_deletion(auth.uid()));

create policy "flashcards_insert_own"
on public.flashcards
for insert
to authenticated
with check (auth.uid() = user_id and not public.is_pending_deletion(auth.uid()));

create policy "flashcards_update_own"
on public.flashcards
for update
to authenticated
using (auth.uid() = user_id and not public.is_pending_deletion(auth.uid()))
with check (auth.uid() = user_id and not public.is_pending_deletion(auth.uid()));

create policy "flashcards_delete_own"
on public.flashcards
for delete
to authenticated
using (auth.uid() = user_id and not public.is_pending_deletion(auth.uid()));
