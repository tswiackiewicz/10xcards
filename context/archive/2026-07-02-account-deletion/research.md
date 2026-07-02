---
date: 2026-07-02T14:14:05Z
researcher: tswiackiewicz
git_commit: 2981322a50958c0334fcad09cc274bf6a6f04fcc
branch: master
repository: tswiackiewicz/10xcards
topic: "Account deletion with 30-day retention (S-05): auth model, purge cascade, and scheduled-job feasibility"
tags: [research, codebase, account-deletion, gdpr, rls, supabase, cloudflare-workers, cron]
status: complete
last_updated: 2026-07-02
last_updated_by: tswiackiewicz
---

# Research: Account deletion with 30-day retention (S-05)

**Date**: 2026-07-02T14:14:05Z
**Researcher**: tswiackiewicz
**Git Commit**: 2981322a50958c0334fcad09cc274bf6a6f04fcc
**Branch**: master
**Repository**: tswiackiewicz/10xcards

## Research Question

For roadmap slice **S-05** — "user can request account deletion; the account is immediately
marked deleted and sign-in blocked, all data stays recoverable for a 30-day window, then is
permanently erased across every user-scoped store" — establish the codebase-grounded evidence a
plan needs:

1. How the current auth/account model works and where a "deleted" state can live.
2. What a hard-delete must cascade over, and how soft-delete blocking should be enforced.
3. Whether a scheduled purge is feasible on Cloudflare Workers under the Astro adapter.
4. Which retention **state model** and **purge mechanism** to recommend (user asked: explore both, recommend; feasibility deep-dive).

## Summary

The feature is tractable but has **one hard blocker and two design forks** the plan must close.

- **Hard blocker — no service-role credential.** The app holds only the anon/publishable
  `SUPABASE_KEY`; there is no `SUPABASE_SERVICE_ROLE_KEY` anywhere (`src/lib/supabase.ts`,
  `astro.config.mjs:17-23`, `.dev.vars`, `.env.example`). The _permanent_ hard-delete requires
  the Supabase Admin API (`auth.admin.deleteUser`), which needs a service-role key. So a new
  server-only secret must be provisioned (human-gated) before the purge phase can exist. The
  _soft-delete_ phase (window + access revocation) does **not** need it.
- **State-model recommendation → hybrid, app-owned soft-delete + service-role hard-delete.**
  Native gotrue ban/`app_metadata` and native delete are both Admin-API-only (blocked today).
  The lowest-friction window mechanism is a **new app-owned `account_deletions` (or `profiles`)
  table** keyed on `user_id → auth.users(id) on delete cascade`, readable by the user's own anon
  client under RLS. The eventual purge still calls service-role `deleteUser(userId)`, and the
  existing `on delete cascade` FK on `flashcards.user_id` erases all user data automatically.
- **Purge-mechanism recommendation → external-scheduler-hits-authenticated-route (Option C).**
  A native Cron Trigger `scheduled()` handler is blocked on an unverified adapter question (the
  Astro Cloudflare adapter owns the Worker entrypoint). A guarded `POST /api/cron/purge` route is
  a normal `fetch` route the adapter already supports, triggerable by GitHub Actions cron or
  Cloudflare Cron hitting the URL. Purge-on-access alone is **GDPR-insufficient** (dormant
  accounts never purge).
- **Enforce soft-delete blocking in RLS, not app code.** Every read already relies on RLS
  (`auth.uid() = user_id`); extending the policy `using` clauses to also require "not
  soft-deleted" blocks access with **zero changes to the 3 SELECT query sites**.
- **PRD gap (Open Q3).** No right-to-erasure FR exists; S-05 anchors to the GDPR NFR (source-text
  handling) by intent only. Resolve before/alongside planning.
- **AGENTS.md is stale.** It claims "only `auth.users`, no migrations" — false: `supabase/migrations/`
  has a real `flashcards` table + `src/db/database.types.ts`. Don't trust that note for this plan.

## Detailed Findings

### A. Auth & account model

- **Single client factory, anon key only.** `src/lib/supabase.ts:1-25` builds a cookie-based SSR
  client (`createServerClient` from `@supabase/ssr`) with `SUPABASE_URL` + `SUPABASE_KEY` from
  `astro:env/server`; returns `null` if either is missing (`src/lib/supabase.ts:7-9`). The key is
  declared `access: "secret"` in `astro.config.mjs:19-20`. `.dev.vars` uses a `sb_publishable_...`
  (anon) key. **No service-role key exists** — repo-wide grep for `service.?role`, `auth.admin`,
  `app_metadata`, `user_metadata` returns zero hits in `src/`.
- **Session resolution.** `src/middleware.ts:7-16` builds the client per request, calls
  `await supabase.auth.getUser()` (JWT-validated, network round-trip), attaches
  `context.locals.user`. `PROTECTED_ROUTES = ["/dashboard","/generate","/create","/cards","/study"]`
  (`src/middleware.ts:4`); guard redirects to `/auth/signin` when unauthenticated
  (`src/middleware.ts:18-22`).
- **`App.Locals` shape** (`src/env.d.ts:1-5`): `{ user: User | null }`. Reading a deletion flag in
  middleware without an extra query would mean extending this — but the underlying value still
  needs a source (a query, or `app_metadata` which requires service-role to write).
- **Sign-in block insertion point.** `src/pages/api/auth/signin.ts:13` calls
  `signInWithPassword`; success → `redirect("/")` at `:19`. A deleted-account check goes between
  `:13` and `:19`: on success, inspect account state; if flagged, `signOut()` + redirect back with
  an error. Signup (`signup.ts:13` → `/auth/confirm-email`) and signout (`signout.ts:6-8`) follow
  the same formData→client→redirect shape.
- **No account state today** beyond `auth.users`. No `profiles` table, no metadata usage.

### B. Data layer & purge cascade

- **One user-scoped table.** `public.flashcards` is the only app-owned table
  (`supabase/migrations/20260624185919_create_flashcards.sql:11-19`, SRS columns added in
  `20260701213238_add_srs_state.sql:14-23`; `src/db/database.types.ts:37-93`). Its only FK:
  **`user_id → auth.users(id) ON DELETE CASCADE`** (`create_flashcards.sql:13`).
- **Cascade is the purge.** Hard-deleting the `auth.users` row deletes all that user's flashcards
  in the same transaction. No separate app-level delete is needed — `admin.auth.admin.deleteUser(id)`
  suffices. This is already exercised by the RLS test's cleanup (`scripts/verify-rls.mjs:174-178`).
  Convention: any _future_ user-scoped table must also declare `ON DELETE CASCADE` (or the purge
  must delete it explicitly).
- **RLS scopes every query; no app-code `user_id` filter exists.** Four owner policies, all
  `to authenticated`, `auth.uid() = user_id` (`create_flashcards.sql:52-75`); `anon` gets no policy
  and no grant (`:44-46`). Query sites all rely on RLS: `src/pages/cards.astro:12` (list — there is
  no GET list API route), `src/lib/flashcards/study.ts:14-21` (feeding `study/next.ts:31`),
  `src/pages/api/flashcards/[id]/review.ts:54` (read), plus mutations in `index.ts:49`,
  `manual.ts:42`, `[id].ts:51,84`.
- **Soft-delete enforcement — prefer RLS.** `auth.uid()` scoping does not know about a "pending
  purge" state. To block a soft-deleted user's own reads, either (a) **extend the `using` clause**
  of the flashcards policies to also require the account is not soft-deleted → **zero query-site
  changes** (matches the codebase's lean-on-RLS style), or (b) filter in app code → must edit all
  3 SELECT sites and keep them in sync. (a) is strongly preferred.
- **Migration house style** (for a new `account_deletions`/`profiles` table): `YYYYMMDDHHMMSS_snake.sql`;
  header `-- <slice-id>: <title>` + why-paragraph cross-referencing `verify-rls.mjs`; section banners
  (`-- Table`, `-- Table privileges`, `-- Row-Level Security`); GRANT explicitly to `authenticated`,
  never `anon`; one `<table>_<cmd>_own` policy per command; reuse the existing `public.set_updated_at()`
  trigger function (`create_flashcards.sql:25-38`), don't redefine it.

### C. Scheduled-purge feasibility (Cloudflare Workers)

- **The adapter owns the Worker entrypoint.** `wrangler.jsonc:4` → `main: "@astrojs/cloudflare/entrypoints/server"`;
  `astro.config.mjs:16` calls `cloudflare()` with **zero options**. No `_worker.js`, no custom entry,
  no `scheduled()` handler in `src/`. The generated entry exports `fetch` only. `wrangler.jsonc` has
  **no `triggers.crons` key**. Adapter version `@astrojs/cloudflare@^13.5.0`, wrangler `^4.90.0`
  (`package.json:16,58`).
- **Secrets to a non-fetch handler is an open risk.** Secrets are read via `astro:env/server`
  (`src/lib/supabase.ts:3`). A `scheduled()` handler runs outside the Astro request pipeline and
  likely cannot use `astro:env/server`; it would need the `scheduled(event, env, ctx)` `env` arg or
  `cloudflare:workers`. This interacts with a **known adapter bug (withastro/astro#16790)** noted in
  the archived deploy plan (`context/archive/2026-07-02-deployment/deployment-plan.md:29-38`) where
  `access: "secret"` vars may not reach `astro:env/server` at runtime; documented fallback is
  `import { env } from "cloudflare:workers"`.
- **Observability is partially on.** `wrangler.jsonc:14-16` sets `observability.enabled: true`
  (Workers Logs ingestion), which is better than the roadmap's "absent" framing — but Open Q2 leaves
  retention-beyond-live-tail open roadmap-wide. **A silent purge failure = GDPR liability**
  (`roadmap.md:153`); the mechanism must emit an explicit success/failure signal.

#### Mechanism options (grounded)

| Option                                                   | Feasibility here                                                                                                                                                                              | Tradeoffs                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Cron Trigger + `scheduled()`**                      | Blocked on the adapter-entry open question. If a `workerEntryPoint`/custom-entry path exists in v13.5, add `triggers.crons` + a thin entry re-exporting adapter `fetch` plus `scheduled`.     | Native, unattended, no external dep. Needs service-role key in Worker env + resolution of the env-to-scheduled-handler question.                                                                                                            |
| **B. Purge-on-access (lazy)**                            | Fully feasible, no new infra (hook `middleware.ts` / sign-in).                                                                                                                                | **GDPR-insufficient alone** — dormant accounts that never make a request are never purged. Weak as sole mechanism.                                                                                                                          |
| **C. External scheduler → guarded `/api/cron/purge`** ⭐ | Highest feasibility given the adapter constraint — it's a normal `fetch` route (fits `src/pages/api/` convention). Trigger via GitHub Actions `schedule:` or Cloudflare Cron hitting the URL. | Needs a shared-secret guard (new `envField`), the service-role key, and idempotency. External scheduler is one more moving part; CI cron timing is loose.                                                                                   |
| **D. Supabase pg_cron / Scheduled Edge Function**        | No Supabase scheduling infra configured (`supabase/config.toml` has no `[functions]`/`schedule`/pg_cron).                                                                                     | Keeps service-role inside Supabase's trust boundary (key never leaves to the Worker) — compliance-attractive. But net-new infra this project has never used; observability lives apart from `wrangler tail`. Needs plan-availability check. |

### D. Historical & foundational context

- **GDPR/PRD.** `context/foundation/prd.md:123-124` GDPR NFR covers _source-text handling_ only.
  Account FRs are FR-001/FR-002 (`prd.md:77-84`). **No erasure FR** → roadmap Open Q3
  (`roadmap.md`), which gates clean traceability for S-05.
- **F-01 explicitly chose hard delete, no soft delete** ("no-loss guardrail targets accidental/
  cross-user loss, not user-initiated deletion" — `context/archive/2026-06-24-flashcard-store-rls/plan.md:61-62`).
  The `on delete cascade` rationale and the anon-key RLS verification method live in the same plan
  (`:112`, `:165-215`).
- **Secret-wiring precedent (OpenRouter).** `context/archive/2026-06-25-ai-card-generation/plan.md`
  - `context/archive/2026-07-02-deployment/deployment-plan.md`: declare in `astro.config.mjs`
    env schema → `.dev.vars` (local) → `npx wrangler secret put` (prod) → GitHub repo secret (CI).
    Wire `SUPABASE_SERVICE_ROLE_KEY` identically. **Destructive Supabase ops and key rotation are
    human-gated** (`deployment-plan.md:80`).
- **Bootstrap baseline:** `has_background_jobs: false` — the starter integrates no scheduled-job
  mechanism (`context/archive/2026-07-02-bootstrap-verification/verification.md`).
- **Infra caps:** free-tier subrequest cap 50/request (paid 10k); `wrangler tail` real-time only
  (`context/foundation/infrastructure.md:57-61,81`). A purge deleting N users issues N admin calls
  — mind batching against the subrequest budget.

## Code References

- `src/lib/supabase.ts:1-25` — sole client factory; anon key; returns null if unconfigured
- `astro.config.mjs:16-23` — adapter called with no options; env schema (SUPABASE_URL/KEY, OPENROUTER)
- `src/middleware.ts:4,7-22` — user resolution + PROTECTED_ROUTES guard
- `src/env.d.ts:1-5` — `App.Locals = { user: User | null }`
- `src/pages/api/auth/signin.ts:13-19` — sign-in; the block-deleted-account insertion point
- `supabase/migrations/20260624185919_create_flashcards.sql:13` — `user_id … references auth.users(id) on delete cascade`
- `supabase/migrations/20260624185919_create_flashcards.sql:25-38,52-75` — `set_updated_at` trigger + 4 RLS policies
- `supabase/migrations/20260701213238_add_srs_state.sql:8-23` — SRS columns inherit table-level RLS
- `src/db/database.types.ts:37-93` — `flashcards` is the only public table
- `scripts/verify-rls.mjs:174-178` — cleanup deletes users via `admin.auth.admin.deleteUser` (= the cascade purge)
- `wrangler.jsonc:4,14-16` — adapter-owned `main`; `observability.enabled: true`; no `triggers.crons`
- `supabase/config.toml` — no `[functions]`/cron/pg_cron configured

## Architecture Insights

- The codebase **leans on RLS for all data scoping** — no app-code `user_id` filters. Any
  access-control change (including soft-delete blocking) should extend RLS rather than app queries;
  this is both the house style and the minimal-diff path.
- **Two privilege planes:** the anon-key SSR client (acts as the user, under RLS) covers everything
  today; account deletion is the first feature needing the **service-role plane** (unattended,
  RLS-bypassing) — a genuinely new capability, not a variation of existing code.
- **Cascade-by-FK is the erasure primitive.** Deleting the auth user is the single source of truth
  for "erase this user"; keeping every user-scoped table `ON DELETE CASCADE` keeps the purge a
  one-call operation.
- The **soft phase and hard phase have different credential needs** — soft = anon+RLS (available
  now), hard = service-role (must be provisioned). This split naturally maps to: ship the
  request/soft-delete/window UX first, then the purge job once the secret is wired.

## Historical Context (from prior changes)

- `context/archive/2026-06-24-flashcard-store-rls/plan.md:61-62,112,165-215` — hard-delete + cascade
  decision, anon-key RLS verification method (the launch-gate proof to extend).
- `context/archive/2026-06-25-ai-card-generation/plan.md` — external-secret wiring precedent for Workers.
- `context/archive/2026-07-02-deployment/deployment-plan.md:29-38,80` — astro#16790 runtime-env caveat;
  human-gated destructive ops / key rotation.
- `context/archive/2026-07-01-manage-saved-flashcards/plan.md` — existing user-initiated delete goes
  through the RLS anon path with row-count confirmation; 0-row delete reported as success.

## Related Research

- None yet — this is the first research artifact under `context/changes/`. (Priors above are archived
  plans/reviews, not research docs.)

## Open Questions

**External verification needed (out of scope for internal research — resolve via Context7 / current docs):**

1. Does `@astrojs/cloudflare` v13.5 expose a supported custom-entry / `workerEntryPoint` mechanism to
   attach a `scheduled()` handler alongside the adapter's `fetch`? (Decides whether Option A is viable.)
2. How does env/secrets reach a non-`fetch` handler under this adapter — `scheduled(event, env, ctx)`,
   `cloudflare:workers`, or not at all? (Interacts with astro#16790.)
3. Current Cloudflare Cron Trigger availability/limits on the account's Workers plan.
4. pg_cron / Scheduled Edge Function availability on the project's Supabase plan (decides Option D).

**Product/planning decisions (owner: user):**

5. **Open Q3** — add a right-to-erasure FR to the PRD (re-run `/10x-prd`) and confirm the 30-day
   window is product policy, not an arbitrary default.
6. Is the 30-day window **cancellable** (grace period the user can undo) or final?
7. **Open Q2** — log retention for purge success/failure signals (compliance-load-bearing).
8. Whether to provision `SUPABASE_SERVICE_ROLE_KEY` now (unblocks the hard-delete phase) or ship the
   soft-delete/window UX first and defer the purge job.
