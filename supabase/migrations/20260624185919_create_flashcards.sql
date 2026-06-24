-- F-01: Per-user flashcard store with RLS isolation
--
-- Creates the single owner-scoped `flashcards` table every downstream slice writes to.
-- Row-Level Security makes a card visible and mutable only by its owner; getting this
-- wrong is a silent cross-user-visibility regression, so it is verified separately
-- (see scripts/verify-rls.mjs). Unauthenticated access is forbidden: no policy and no
-- grant is given to the `anon` role.

-- Table -----------------------------------------------------------------------

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 1000),
  answer text not null check (char_length(answer) between 1 and 2000),
  source text not null default 'manual' check (source in ('ai', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flashcards_user_id on public.flashcards (user_id);

-- updated_at auto-touch --------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger flashcards_set_updated_at
before update on public.flashcards
for each row
execute function public.set_updated_at();

-- Table privileges -------------------------------------------------------------
-- RLS governs *which rows* a role can touch; GRANT governs *whether the role can
-- touch the table at all*. Grant CRUD to `authenticated` explicitly so the table is
-- reachable deterministically regardless of Supabase default-privilege state. Do NOT
-- grant to `anon` — unauthenticated access to flashcard data is not permitted.

grant select, insert, update, delete on public.flashcards to authenticated;

-- Row-Level Security -----------------------------------------------------------

alter table public.flashcards enable row level security;

create policy "flashcards_select_own"
on public.flashcards
for select
to authenticated
using (auth.uid() = user_id);

create policy "flashcards_insert_own"
on public.flashcards
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "flashcards_update_own"
on public.flashcards
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "flashcards_delete_own"
on public.flashcards
for delete
to authenticated
using (auth.uid() = user_id);
