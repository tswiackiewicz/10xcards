# Cloudflare Workers Integration & First Deploy — 10xCards

## Context

`context/foundation/infrastructure.md` selected **Cloudflare Workers** as the MVP platform for this
Astro 6 SSR + TypeScript app (Supabase auth over HTTP; OpenRouter planned but not yet built). The
infra research is done; the **deploy step has not run** — `context/deployment/` doesn't exist yet.

This plan ships the **current app** (Astro SSR + Supabase cookie auth) to production on Workers and
produces the Lesson 5 deliverable `context/deployment/deploy-plan.md` as the audit trail. The starter
already carries ~90% of the wiring, so this is mostly a **runbook + two integration edge cases**, not
new infrastructure.

**Locked decisions (from user):**

- Deploy trigger: **manual, human-gated first deploy**, then **add CI auto-deploy on push to master**.
- OpenRouter: **left out entirely** — no env/secret/code touched this round.

## What already works (do NOT redo)

- `astro.config.mjs`: `@astrojs/cloudflare` v13.5, `output: "server"`, env schema for `SUPABASE_URL`/`SUPABASE_KEY` (`server`/`secret`/`optional`).
- `wrangler.jsonc`: `main: "@astrojs/cloudflare/entrypoints/server"` (correct v13 entrypoint), `compatibility_date: 2026-05-08` (≥ 2024-09-23 ✓), `compatibility_flags: ["nodejs_compat"]`, `assets` → `./dist`, `observability.enabled: true`.
- `src/lib/supabase.ts`: SSR cookie client; returns `null` if secrets absent (graceful).
- `src/lib/config-status.ts`: **already a runtime probe** — reports whether Supabase resolved. We reuse it as the post-deploy verification signal.
- `.gitignore` covers `.env`, `.dev.vars`, `dist/`. `.nvmrc` = 22.14.0.

## The two edge cases that need extra support

### Edge case 1 (HIGH RISK) — `astro:env/server` may not receive runtime secrets on Workers

`@astrojs/cloudflare` has an **open bug, [withastro/astro#16790](https://github.com/withastro/astro/issues/16790)**: runtime env isn't reliably forwarded to `astro:env/server`. Both `src/lib/supabase.ts` and
`src/lib/config-status.ts` read secrets exactly this way. If it bites, `createClient()` returns `null`
in production → **auth silently dies** (the exact pre-mortem in infrastructure.md). Build-time injection
won't save us: `access: "secret"` vars resolve at **runtime**, not build.

**Strategy:** deploy with the current code first, then probe the live site. Only if the probe shows
Supabase unconfigured-despite-secrets, apply the documented-to-work fallback: read env via
`import { env } from "cloudflare:workers"`. Conditional, minimal — don't pre-emptively rewrite working code.

### Edge case 2 — OpenRouter is not integrated

No deps, no code, no env entry. Per the locked decision it stays out. The only action is a one-line
note in `deploy-plan.md` recording that OpenRouter secrets are deferred to the AI-feature milestone,
so the next lesson's planning knows it's an open thread (and that the subrequest/CPU risks in the
risk register don't apply until then).

## Plan

### Phase 0 — Scaffold the deployment context (writes only docs)

- [ ] Create `context/deployment/` and write `context/deployment/deploy-plan.md` containing the phased
      checklist below (this is the Lesson 5 artifact; it carries the live checkboxes for execution tracking).
- [ ] Add `.dev.vars.example` (mirrors `.env.example`: `SUPABASE_URL=`, `SUPABASE_KEY=`) so local Workers
      dev is documented. `.dev.vars` itself stays gitignored.

### Phase 1 — Manual, human-gated first deploy (the infra.md "human-only production" gate)

Commands the **user runs** (interactive auth can't be automated); agent prepares and verifies.

- [ ] `! npx wrangler login` (one-time, interactive).
- [ ] (Optional, decide first) Worker name: `wrangler.jsonc` says `10x-astro-starter` → URL becomes
      `10x-astro-starter.<subdomain>.workers.dev`. Rename to `10x-cards` here if the URL matters. Cosmetic, non-blocking.
- [ ] Set production secrets (write-only, human-only per infra.md):
      `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`.
- [ ] `npm run build` → `npx wrangler deploy` (ships `./dist`).
- [ ] Capture the deployed version id + `*.workers.dev` URL into `deploy-plan.md`.

### Phase 2 — Verify the live deployment (external-integration smoke test)

- [ ] Load the homepage. The `config-status` banner must **NOT** show
      "Supabase nie jest skonfigurowany" — that absence proves secrets resolved at runtime (edge case 1 cleared).
- [ ] Exercise auth end-to-end against live Supabase: `/auth/signup` → `/auth/signin` → reach `/dashboard`
      (protected route) → `/api/auth/signout`. Confirm the cookie round-trip works on `workerd`.
- [ ] `npx wrangler tail` during the auth test to confirm no runtime errors (`node:*` import failures,
      CPU limit, subrequest cap).

### Phase 3 — Apply edge-case-1 fallback ONLY IF Phase 2 fails on config

Trigger: homepage shows Supabase unconfigured despite secrets set, or `tail` shows `SUPABASE_*` undefined.

- [ ] Add `src/lib/env.ts`: a single chokepoint reading `import { env } from "cloudflare:workers"` with a
      fallback to `astro:env/server` for non-Workers contexts.
- [ ] Repoint `src/lib/supabase.ts` and `src/lib/config-status.ts` to import `SUPABASE_URL`/`SUPABASE_KEY`
      from `@/lib/env` instead of `astro:env/server`. No other call sites exist (verified).
- [ ] Rebuild, redeploy, re-run Phase 2. Record in `deploy-plan.md` which path won (`astro:env` vs `cloudflare:workers`).

### Phase 4 — CI auto-deploy on push to master

- [ ] Add a `deploy` job to `.github/workflows/ci.yml`: `needs: ci`, `if: github.ref == 'refs/heads/master'`,
      runs `npm ci` → `npm run build` → `npx wrangler deploy` via `cloudflare/wrangler-action@v3`.
- [ ] Document required GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (scoped to **Workers Scripts: Edit**
      for this project only — not account-wide, per infra.md token posture) and `CLOUDFLARE_ACCOUNT_ID`.
      `SUPABASE_*` are runtime Workers Secrets (already set in Phase 1), not needed by the deploy job.
- [ ] Push a trivial change to master and confirm the job deploys; verify the live URL updates.

### Phase 5 — Close out

- [ ] Tick every box in `context/deployment/deploy-plan.md`; fill the version id, URL, and the
      edge-case-1 resolution.
- [ ] Note in `deploy-plan.md`: OpenRouter secrets **deferred** to the AI-feature milestone; rollback is
      `npx wrangler rollback` (code only — Supabase data is forward-only); log retention beyond live `tail`
      is an open decision (Workers Logs paid / external sink).

## Files

| File                                              | Action                                                        |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `context/deployment/deploy-plan.md`               | **create** — phased checklist artifact (Lesson 5 deliverable) |
| `.dev.vars.example`                               | **create** — documents local Workers secrets                  |
| `.github/workflows/ci.yml`                        | **modify** — add gated `deploy` job (Phase 4)                 |
| `wrangler.jsonc`                                  | **modify (optional)** — rename worker to `10x-cards`          |
| `src/lib/env.ts`                                  | **create — only if Phase 3 triggers**                         |
| `src/lib/supabase.ts`, `src/lib/config-status.ts` | **modify — only if Phase 3 triggers**                         |

## Verification

1. **Build parity with CI:** `npx astro sync && npm run lint && npm run build` clean locally (mirrors CI).
2. **Runtime config probe:** live homepage shows no "Supabase nie jest skonfigurowany" banner.
3. **Auth E2E on live Worker:** signup → signin → `/dashboard` → signout succeeds; `wrangler tail` clean.
4. **Rollback drill:** `npx wrangler deployments list` then `npx wrangler rollback` reverts cleanly.
5. **CI deploy:** a push to master triggers `ci` → `deploy`; live URL reflects the change.

## Out of scope (per infra.md + locked decisions)

OpenRouter wiring, Docker, multi-region/HA, DB migrations (app uses only `auth.users`), paid log retention.
