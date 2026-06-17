---
project: 10xCards
researched_at: 2026-06-17
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR, output: server)
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

For an Astro 6 SSR + TypeScript app whose hot path is a server-side `fetch` to OpenRouter (with Supabase reached over HTTP/PostgREST), Cloudflare Workers is the only candidate that scored a clean Pass on all five agent-friendly criteria while costing **$0** at MVP scale (free tier: 100k requests/day). Decisively, Cloudflare **meters CPU time, not wall-clock** — the seconds spent awaiting a slow OpenRouter generation do not count against the 10 ms free-tier CPU limit and have no duration cap, so generations never time out and never force a tier upgrade. It's also the runtime the chosen starter already targets (`@astrojs/cloudflare`, `output: server`), so the best-scored option and the path of least resistance coincide. Every interview answer (cost-minimize, single-region, no familiarity, external Supabase + OpenRouter) reinforces this pick; none pulls against it.

## Platform Comparison

| Platform               | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Score              |
| ---------------------- | --------- | ------------------ | ------------------- | ----------------- | ----------------- | ------------------ |
| **Cloudflare Workers** | Pass      | Pass               | Pass                | Pass              | Pass              | **5 Pass**         |
| **Netlify**            | Pass      | Pass               | Pass                | Pass              | Pass              | **5 Pass**         |
| **Vercel**             | Pass      | Pass               | Pass                | Pass              | Partial           | **4P / 1 Partial** |
| **Render**             | Pass      | Partial            | Pass                | Pass              | Pass              | **4P / 1 Partial** |
| **Railway**            | Pass      | Partial            | Pass                | Pass              | Pass              | **4P / 1 Partial** |
| **Fly.io**             | Pass      | Partial            | Pass                | Pass              | Partial           | **3P / 2 Partial** |

**Per-platform notes:**

- **Cloudflare Workers** — `wrangler` covers deploy / rollback / `tail`; docs are native markdown with `llms.txt` (best agent-readability in the pool); `wrangler deploy` is deterministic; official **GA** MCP servers (Docs, Workers Bindings, Builds, Observability). Fully managed/serverless with auto TLS, routing, scale-to-zero. The `@astrojs/cloudflare` v13.7 adapter is GA and Workers-only (Pages dropped). MCP Pass.
- **Netlify** — `@astrojs/netlify@7` (GA, peer `astro@^6`) runs SSR on Netlify Functions; `netlify` CLI (deploy is draft-by-default, `--prod` for production), instant rollback by publishing a prior atomic deploy. Official MCP server (maintained, but no formal versioned releases — young). **60s synchronous function timeout** (fixed, all plans) comfortably clears OpenRouter; bandwidth is the silent cost driver on the credit-based free tier (300 credits/mo).
- **Vercel** — `@astrojs/vercel` v10 unified adapter (GA) on Node Serverless Functions; excellent DX, mature CLI (`vercel`, `--prod`, `rollback`, `logs`). **Fluid Compute now gives Hobby 300s max duration (GA)** — the historical ~10s timeout dealbreaker for LLM calls is gone. Two demerits keep it at third: **MCP is public beta** (Partial), and **Hobby is non-commercial-only** — a $20/seat/mo Pro tripwire the moment a study app monetizes — plus Hobby **hard-pauses on overage** (a spike = downtime, not a bill).
- **Render** — Native Astro SSR Web Service via `@astrojs/node` (must set `HOST=0.0.0.0`); CLI (GA v2.20), REST API, and `render.yaml` Blueprints all GA; **GA** MCP server. Partial on managed/serverless because it runs a persistent container whose **free tier spins down (~50s cold start)** — usable always-on costs **$7/mo Starter**.
- **Railway** — `@astrojs/node` standalone via Railpack auto-build (no Dockerfile; declare the start command since Railpack's static auto-detect skips `output: server`); scriptable `railway` CLI (`--ci`, `--json`), though **rollback is dashboard-only**. Official **GA** MCP (remote `mcp.railway.com`). Partial on serverless (persistent container). **No free tier — ~$5/mo floor**; Hobby image retention 72h limits rollback window.
- **Fly.io** — `@astrojs/node` in an auto-generated Dockerfile; `flyctl` is excellent (`deploy`, `releases` rollback, `logs`). Partial on managed (you own the container image + base-image patching) and Partial on MCP (`fly mcp server` is **experimental**). **No free tier for new orgs** — ~$2/mo always-on, or accept ~5s cold starts on auto-stopped machines. No function timeout (always-on VM).

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Won on a clean 5/5, true $0 cost at MVP scale, and the best agent-readable docs in the pool (`llms.txt` + markdown-native). The CPU-time billing model is uniquely suited to an app whose hot path awaits an external OpenRouter call — that wait is neither metered nor duration-capped, so generation latency never forces a paid tier or trips a timeout. Aligns with the starter's existing `@astrojs/cloudflare` setup, and Supabase-over-HTTP needs no Hyperdrive.

#### 2. Netlify

Also 5/5 Pass with an official MCP server and a genuinely no-strings free tier (unlike Vercel Hobby's non-commercial restriction). Its 60s function timeout clears typical OpenRouter generations. The gap vs. Cloudflare: the wait itself _is_ metered function compute (not free as on Workers), bandwidth silently burns the credit budget, and the MCP server is young (no formal releases). A strong, safe second choice.

#### 3. Vercel

The most polished DX, and **Fluid Compute's 300s Hobby duration removes the old timeout dealbreaker** for LLM calls — a genuine change since this stack was last evaluated. Drops to third only on cost/agent axes: **MCP is still beta**, and the **Hobby tier is non-commercial-only with hard-pause-on-overage**, both of which cut against the top-priority "minimize cost" constraint for a product that could earn revenue.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Free-tier subrequest cap is 50 `fetch` calls per request — and Supabase _and_ OpenRouter calls both count.** One generation is 1 OpenRouter call (fine), but retries, a fallback model, embeddings, plus every Supabase PostgREST round-trip in the same handler accumulate toward 50. Heavy handlers can fail on free tier; the paid cap (10,000) is another nudge to $5/mo.
2. **The 10 ms free-tier CPU cap bites on the work that isn't the fetch.** Awaiting OpenRouter is free, but parsing a large completion + Zod-validating dozens of candidate cards + serializing the response _is_ CPU — a big generation can intermittently throw `Exceeded CPU Limit`, only in production.
3. **`nodejs_compat` is a partial shim, not Node.** `@supabase/ssr` and OpenRouter `fetch` work, but any future dep reaching for `node:net`/`node:tls`, raw `pg`, or native crypto fails at the edge — and surfaces at runtime, not at `npm install` or build.
4. **`tech-stack.md` still says `deployment_target: cloudflare-pages`, which is deprecated for new SSR.** The current `@astrojs/cloudflare` v13.7 adapter dropped Pages entirely; following the stale hint produces a wrong deploy target.
5. **`wrangler tail` is real-time only — no historical log retention** on the base plan. Diagnosing an intermittent production generation failure after the fact needs paid Workers Logs or an external sink.

### Pre-Mortem — How This Could Fail

Six months in, 10xCards is flaky in production but never locally. The team shipped on Workers because the starter defaulted to it and "100k requests/day free" sounded limitless. Two things they hadn't modelled bit them. First, the OpenRouter integration grew — a retry, a fallback model, a couple of Supabase reads per request — and on heavy generations the per-request subrequest count, plus the synchronous parse-and-validate of many candidate cards, intermittently tripped the free-tier limits. The errors were non-deterministic and invisible in `astro dev` (which runs workerd but enforces neither the production CPU cap nor the subrequest budget), so evenings vanished chasing ghosts. Second, when a generation failed mid-review a user lost their in-progress candidates, and because `wrangler tail` keeps no history they couldn't reconstruct what happened — bruising the PRD's no-loss guardrail in spirit. They upgraded to paid ($5/mo, trivial) which fixed the limits, but the real cost was weeks of not trusting their own platform. Workers was right for the MVP as _specified_; the trouble was the MVP as it _grew_.

### Unknown Unknowns

- **`astro dev` runs on workerd but does NOT enforce the production CPU limit or subrequest budget** — the dev/prod fidelity gap is narrower than it looks, and limit-related failures appear only in production.
- **Every Supabase PostgREST call and every OpenRouter call counts as a subrequest** against the per-request cap — it's the combined total, not just "external API calls."
- **`compatibility_date` ≥ 2024-09-23 + `compatibility_flags: ["nodejs_compat"]` are load-bearing config**, not boilerplate; a wrong/old date yields cryptic `node:*` import errors that look like dependency bugs.
- **Official Cloudflare MCP servers are remote OAuth services querying your live account** — scope a read-only observability token before connecting an agent, never an account-wide key.
- **`wrangler tail` ≠ log search** — decide log retention (paid Workers Logs or an external sink) _before_ the first production incident.

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a non-production **preview URL** (a `*.workers.dev` version preview) without shifting production traffic; promote with `wrangler versions deploy`. Wire branch/PR previews via GitHub Actions on push. Preview URLs are public — don't rely on obscurity for unreleased features; no special access protection needed for this MVP.
- **Secrets**: `SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY` live in **Workers Secrets** — set with `npx wrangler secret put <NAME>` (encrypted at rest, write-only via CLI/dashboard, never readable back). Local dev reads `.dev.vars`; CI reads them from **GitHub repo secrets**. Never commit secrets or put them in `wrangler.jsonc`. Rotation = `wrangler secret put` again (overwrites) then redeploy.
- **Rollback**: `npx wrangler rollback [version-id]` reverts to a prior deployed version near-instantly (list with `wrangler deployments list`). Code rolls back cleanly; **Supabase data/schema changes do not roll back with the Worker** — treat any future DB migration as a separate, forward-only concern.
- **Approval**: an agent may deploy previews and tail logs unattended. **Human-only**: promoting to production (`wrangler versions deploy` / `wrangler deploy` to the live route), rotating the Supabase or OpenRouter key, and any destructive Supabase operation (done by hand in the Supabase dashboard, not by the agent).
- **Logs**: `npx wrangler tail` streams live runtime logs (read-only) — the agent's primary observability tool. For historical search, enable **Workers Logs** (paid) or ship to an external sink; the official **Workers Observability MCP server** (GA, OAuth, read-only-scoped token) exposes logs/metrics/errors as structured tools when CLI tailing isn't enough.

## Risk Register

| Risk                                                                                                             | Source                              | Likelihood | Impact | Mitigation                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-request subrequest count (OpenRouter + Supabase + retries/fallbacks) approaches the 50/request free-tier cap | Devil's advocate / Unknown unknowns | M          | M      | Keep one OpenRouter call + minimal Supabase round-trips per request; avoid fan-out. If hit, upgrade to paid ($5/mo, cap 10,000). Count Supabase calls as subrequests when budgeting.   |
| Parse + Zod-validate of large generations exceeds the 10 ms free-tier CPU cap                                    | Devil's advocate / Pre-mortem       | M          | M      | Cap input size and generated-card count (PRD Open Question Q1); keep per-request CPU lean. On `Exceeded CPU Limit`, move to the $5/mo tier (30s default, up to 5 min CPU).             |
| A future dependency pulls in a Node TCP/native module that breaks at the edge                                    | Devil's advocate / Pre-mortem       | M          | H      | Vet new deps against the Workers/`nodejs_compat` surface before adding; prefer HTTP-based clients (Supabase + OpenRouter already are). Test the deployed Worker, not just `astro dev`. |
| Stale `cloudflare-pages` hint in tech-stack.md leads to a wrong (Pages) deploy config                            | Research finding                    | M          | M      | Deploy to **Workers** (not Pages); Pages is deprecated for new SSR and dropped by the adapter. Update `deployment_target` in `tech-stack.md` to `cloudflare-workers`.                  |
| Intermittent production-only failures with no log history to diagnose                                            | Pre-mortem / Unknown unknowns       | M          | M      | Decide log retention up front: enable Workers Logs (paid) or an external sink before the first prod incident; don't rely on real-time `wrangler tail` alone.                           |
| Wrong/old `compatibility_date` causes cryptic `node:*` import errors                                             | Unknown unknowns                    | L          | M      | Pin `compatibility_date` ≥ 2024-09-23 and set `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc`; treat as load-bearing config.                                              |
| Cloudflare MCP server (remote OAuth) over-scoped, exposing the live account to the agent                         | Unknown unknowns                    | L          | H      | If connecting MCP, mint a **read-only, observability-scoped** API token for one project — never an account-wide key; keep destructive actions human-only.                              |
| OpenRouter generation latency degrades UX (PRD NFR: progress visible after ~2s)                                  | Research finding                    | M          | M      | Workers don't time out or meter the OpenRouter `fetch` wait, so generation completes; surface continuous progress in the UI per the NFR.                                               |

## Getting Started

The starter already ships the Cloudflare wiring (`@astrojs/cloudflare`, `output: server`, `wrangler`). Concrete first steps:

1. **Confirm the adapter + config** — `astro.config.mjs` uses `@astrojs/cloudflare` with `output: "server"`; `wrangler.jsonc` has `compatibility_date` ≥ `2024-09-23` and `compatibility_flags: ["nodejs_compat"]`. Deploy to **Workers**, not Pages (the v13 adapter dropped Pages).
2. **Local dev needs no separate platform command** — Astro 6's `astro dev` already runs on the real `workerd` runtime via the Cloudflare Vite plugin, so `npm run dev` suffices; `wrangler dev` is redundant for app development. Keep both `.env` and `.dev.vars` populated (Wrangler reads `.dev.vars`).
3. **Authenticate Wrangler** — `npx wrangler login` (one-time, interactive; run it yourself with `! npx wrangler login`).
4. **Set production secrets** — `npx wrangler secret put SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY`. Add the same as GitHub repo secrets for CI.
5. **Build and ship** — `npm run build` then `npx wrangler deploy` (ships `./dist` to Workers). Verify the live route, then `npx wrangler tail` to watch runtime logs. Roll back with `npx wrangler rollback` if needed.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
