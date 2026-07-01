-- S-04: Spaced-repetition study — per-card FSRS scheduling state
--
-- Adds the scheduling state ts-fsrs persists between reviews to the existing
-- `flashcards` store (F-01). All columns are nullable: a row with a NULL `due` has
-- never been studied and is treated as due-now by the study queue (lazy-init model —
-- the first grade runs createEmptyCard() and writes full state). Existing rows are
-- untouched; no backfill.
--
-- RLS is inherited: the four owner-scoped policies from F-01 are table-level
-- (auth.uid() = user_id), so these columns are visible and mutable only by the owner
-- with no new policy. Cross-user isolation on the new columns is re-verified by
-- scripts/verify-rls.mjs.

alter table public.flashcards
  add column due timestamptz,
  add column stability double precision,
  add column difficulty double precision,
  add column scheduled_days integer,
  add column learning_steps integer,
  add column reps integer,
  add column lapses integer,
  add column state smallint,
  add column last_review timestamptz;

-- Supports the study queue's next-card lookup: order by due (NULLs first), limit 1.
create index idx_flashcards_due on public.flashcards (due);
