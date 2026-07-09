-- Risk #10 test-plan refresh: service_role needs read-only access to `flashcards` for
-- backend verification reads (e.g. confirming SRS state after a review) — it had no
-- grant at all on this table (only `authenticated` was granted in the original
-- create_flashcards migration). service_role already bypasses RLS and has no client
-- exposure, so a read-only grant carries no meaningful additional risk.

grant select on public.flashcards to service_role;
