-- S-05 follow-up: fold the pending-deletion check into a single InitPlan.
--
-- The four flashcards policies from 20260702145938 called
-- `not public.is_pending_deletion(auth.uid())` inline, so Postgres re-evaluated the
-- SECURITY DEFINER function once per candidate row (the documented Supabase RLS perf
-- pitfall). Wrapping it in a scalar subselect lets the planner evaluate it once per
-- statement. Behaviour is identical; this is a performance-only recreation.
-- Re-verified by scripts/verify-rls.mjs.

drop policy "flashcards_select_own" on public.flashcards;
drop policy "flashcards_insert_own" on public.flashcards;
drop policy "flashcards_update_own" on public.flashcards;
drop policy "flashcards_delete_own" on public.flashcards;

create policy "flashcards_select_own"
on public.flashcards
for select
to authenticated
using (auth.uid() = user_id and not (select public.is_pending_deletion(auth.uid())));

create policy "flashcards_insert_own"
on public.flashcards
for insert
to authenticated
with check (auth.uid() = user_id and not (select public.is_pending_deletion(auth.uid())));

create policy "flashcards_update_own"
on public.flashcards
for update
to authenticated
using (auth.uid() = user_id and not (select public.is_pending_deletion(auth.uid())))
with check (auth.uid() = user_id and not (select public.is_pending_deletion(auth.uid())));

create policy "flashcards_delete_own"
on public.flashcards
for delete
to authenticated
using (auth.uid() = user_id and not (select public.is_pending_deletion(auth.uid())));
