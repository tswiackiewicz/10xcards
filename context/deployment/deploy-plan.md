# Deploy Plan — 10xCards on Cloudflare Workers

> Lesson 5 deliverable & audit trail. Source plan: `context/changes/deployment/deployment-plan.md`.
> Platform decision: `context/foundation/infrastructure.md` (Cloudflare Workers).
> This file carries the live execution checkboxes. Tick boxes as each step completes.

## Decisions (locked)

- Deploy trigger: **manual, human-gated first deploy**, then **CI auto-deploy on push to master**.
- OpenRouter: **deferred** to the AI-feature milestone — no env/secret/code touched this round.

## Deployment facts (fill during execution)

| Field                  | Value                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker name            | `10x-cards`                                                                                                                                                       |
| Live URL               | https://10x-cards.tommy-swiacek-1fb.workers.dev/                                                                                                                  |
| Deployed version id    | `f158486c-40f0-41c2-944a-324e7af7cc56` (2026-06-22 16:58:38 UTC, CI auto-deploy). First manual: `d9c71452-bc81-4e54-92fc-61f55d5eb38e` (2026-06-17 20:14:06 UTC). |
| Edge-case-1 resolution | **`astro:env/server` works** — no fallback needed. Secrets resolve at runtime on `workerd`; homepage shows no unconfigured banner. Phase 3 skipped.               |

## Phase 0 — Scaffold the deployment context

- [x] Create `context/deployment/` and write this `deploy-plan.md`.
- [x] `.dev.vars.example` present (mirrors `.env.example`: `SUPABASE_URL=`, `SUPABASE_KEY=`). `.dev.vars` stays gitignored.

## Phase 1 — Manual, human-gated first deploy

Commands the **user runs** (interactive auth can't be automated); agent prepares and verifies.

- [x] `npx wrangler login` (one-time, interactive) — already done.
- [x] Worker name set to `10x-cards` in `wrangler.jsonc`.
- [x] Set production secrets (write-only, human-only): `SUPABASE_URL`, `SUPABASE_KEY` (set via `wrangler secret put`).
- [x] `npm run build` → `npx wrangler deploy` (ships `./dist`). Registered `workers.dev` subdomain on first publish.
- [x] Capture deployed version id + `*.workers.dev` URL above.

## Phase 2 — Verify the live deployment

- [x] Homepage shows **NO** "Supabase nie jest skonfigurowany" banner (proves secrets resolved at runtime; edge case 1 cleared).
- [x] Auth E2E against live Supabase: `signup` → email confirm (confirmation is **on**) → `signin` → `signout` all returned `Ok`; unauth `/dashboard` correctly redirects to `/auth/signin` (middleware guard works on `workerd`).
- [x] `npx wrangler tail` during the auth test: **no runtime errors** — every request (`/`, `/auth/*`, `POST /api/auth/{signup,signin,signout}`, `/dashboard`) returned `Ok`. No `node:*`/CPU/subrequest issues.

## Phase 3 — Apply edge-case-1 fallback ONLY IF Phase 2 fails on config

Trigger: homepage shows Supabase unconfigured despite secrets set, or `tail` shows `SUPABASE_*` undefined.

- [ ] Add `src/lib/env.ts`: chokepoint reading `import { env } from "cloudflare:workers"` with fallback to `astro:env/server`.
- [ ] Repoint `src/lib/supabase.ts` and `src/lib/config-status.ts` to import secrets from `@/lib/env`.
- [ ] Rebuild, redeploy, re-run Phase 2. Record which path won above.

## Phase 4 — CI auto-deploy on push to master

- [x] Add gated `deploy` job to `.github/workflows/ci.yml`: `needs: ci`, `if: github.ref == 'refs/heads/master'`, `npm ci` → `npm run build` → `wrangler deploy` via `cloudflare/wrangler-action@v3` (`command: deploy`).
- [x] Document required GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (scoped to **Workers Scripts: Edit** for this project only) and `CLOUDFLARE_ACCOUNT_ID`. `SUPABASE_*` are runtime Workers Secrets (set in Phase 1), but the deploy job's `npm run build` still passes them as env (mirrors the `ci` job). All four secrets confirmed present in GitHub repo secrets.
- [x] Push a trivial change to master; confirm the job deploys and the live URL updates. Run `27969591304` (commit `621521f`): `ci` ✓ → `deploy` ✓; CI shipped version `f158486c…`, live URL returns HTTP 200.

## Phase 5 — Close out

- [x] Tick every box above; fill version id, URL, edge-case-1 resolution.
- [x] Record: OpenRouter secrets **deferred** to AI-feature milestone; rollback is `npx wrangler rollback` (code only — Supabase data is forward-only); log retention beyond live `tail` is an open decision (Workers Logs paid / external sink).

## Notes / open threads

- OpenRouter not integrated this round — subrequest/CPU risks in the risk register don't apply until then.
