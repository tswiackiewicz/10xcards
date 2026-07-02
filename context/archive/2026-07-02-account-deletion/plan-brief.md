# Account Deletion with 30-Day Retention — Plan Brief

> Full plan: `context/changes/account-deletion/plan.md`
> Research: `context/changes/account-deletion/research.md`

## What & Why

Let a signed-in user request permanent deletion of their account (roadmap S-05). The request
immediately soft-deletes them (data hidden, signed out), keeps data recoverable for a 30-day
self-service grace window, then permanently erases everything. Motivation: GDPR right-to-erasure —
the product currently has no way for a user to delete their account.

## Starting Point

Auth is anon-key + RLS only (no service-role credential anywhere). `flashcards` is the single
user-scoped table, FK'd `on delete cascade` to `auth.users`, and every read relies on RLS for
scoping. There is no account-state table and no `/account` page today.

## Desired End State

A `/account` page (linked from Topbar + dashboard) offers a type-to-confirm "Danger zone" delete.
Requesting it hides the user's cards instantly and signs them out; signing back in within 30 days
lands on a self-service reactivate panel. After 30 days, a daily GitHub Actions job hits a
secret-guarded purge route that `admin.deleteUser`s the account, and the cascade FK erases the rest.

## Key Decisions Made

| Decision                  | Choice                                                         | Why (1 sentence)                                                               | Source   |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Retention state model     | App-owned `account_deletions` table + service-role hard-delete | Native gotrue delete needs a service-role key that doesn't exist yet.          | Research |
| Soft-delete enforcement   | Extend `flashcards` RLS via a `SECURITY DEFINER` helper        | Blocks data with zero query-site changes; matches the lean-on-RLS house style. | Research |
| Purge mechanism           | Guarded `/api/cron/purge` route (not native `scheduled()`)     | Native cron is blocked on an unverified Astro-adapter question.                | Research |
| Purge trigger             | GitHub Actions daily cron                                      | Reuses existing GitHub CI/secrets; sidesteps the adapter question.             | Plan     |
| Phasing                   | Soft-delete first, purge phase gated on the new secret         | Ships user value fast; isolates the human-gated destructive job.               | Plan     |
| Cancellable window        | Self-service reactivate                                        | Makes the 30-day window a real safety net (no-loss guardrail spirit).          | Plan     |
| Access revocation         | Sign out on request + divert sign-in to `/account`             | Immediate on the requesting device with no per-request DB cost.                | Plan     |
| Deletion entry point / UX | New `/account` page, type-to-confirm dialog                    | Proper home for a destructive account action, proportionate friction.          | Plan     |
| Verification              | Extend `scripts/verify-rls.mjs`                                | Reuses the launch-gate RLS harness for the load-bearing guardrails.            | Plan     |
| PRD erasure FR gap        | Proceed now, track as risk                                     | Feature is clearly GDPR-motivated; don't block delivery.                       | Plan     |

## Scope

**In scope:** `account_deletions` table + RLS helper; `flashcards` RLS extension; `/account` page +
`AccountView` island; delete/reactivate endpoints; sign-in divert; service-role admin client; guarded
purge route; daily GitHub Actions cron; `verify-rls.mjs` extensions.

**Out of scope:** PRD edit (tracked follow-up); native Cloudflare `scheduled()`/Cron Trigger; admin
recovery UI; email notifications; S-06 review-flow files.

## Architecture / Approach

Split along the credential seam. Phases 1–2 deliver the full user-visible soft-delete on the existing
anon+RLS plane (no new secret): a new table marks pending accounts, an RLS helper hides their data, and
a `/account` page drives request/reactivate. Phase 3 adds the new service-role plane and a
GitHub-Actions-triggered guarded route that permanently deletes eligible accounts, relying on the
`on delete cascade` FK to erase flashcards. The `account_deletions` table is the shared contract
between the phases.

## Phases at a Glance

| Phase                                 | What it delivers                                         | Key risk                                                          |
| ------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Data model + soft-delete RLS       | Table, helper, `flashcards` RLS extension, types, tests  | RLS-on-subquery pitfall (mitigated by `SECURITY DEFINER` helper). |
| 2. Request/cancel/divert + `/account` | Endpoints, `/account` page + island, sign-in divert, nav | Reconciling "signed out" with "reactivatable" sign-in flow.       |
| 3. Purge + GitHub Actions cron        | Admin client, guarded purge route, daily workflow, tests | Human-gated secret; silent purge failure = GDPR liability.        |

**Prerequisites:** F-01 (done). Phase 3 also needs you to provision `SUPABASE_SERVICE_ROLE_KEY` and
`CRON_PURGE_SECRET` (human-only: `wrangler secret put` + GitHub repo secrets).
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- **PRD gap:** no right-to-erasure FR yet — proceeding on the GDPR NFR by intent; follow-up `/10x-prd`
  should add it and confirm 30 days is product policy.
- **Adapter/env open question:** the purge route is a normal `fetch` handler so `astro:env/server`
  should work, but the known astro#16790 runtime-env bug is a watch item (fallback: `cloudflare:workers`).
- **Service-role key is a new trust surface** — confined to `src/lib/supabase-admin.ts` and the purge route.
- **GitHub Actions cron timing is loose** (±minutes) — acceptable for a daily retention boundary.

## Success Criteria (Summary)

- A user can delete their account: data hidden immediately, recoverable via reactivation for 30 days.
- After 30 days the account and all its flashcards are permanently and verifiably gone.
- `scripts/verify-rls.mjs` proves soft-delete blocking, reactivation restore, and post-purge erasure.
