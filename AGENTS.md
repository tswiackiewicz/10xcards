# Repository Guidelines

Project onboarding for AI coding agents. This is the source of truth; `CLAUDE.md` imports it via `@AGENTS.md`.

## Stack

Astro 6 (server-first, `output: server` on Cloudflare) · React 19 islands · TypeScript 5.9 (strict) · Tailwind 4 · shadcn/ui (new-york) · Supabase (auth + Postgres) · deploys to Cloudflare Workers via Wrangler. Package manager: **npm**. Node: **24.17.0** (`.nvmrc`) — `type: module` (ESM).

## Commands

Standard scripts (`dev`, `lint`, `lint:fix`, `format`, `build`): see `@package.json`. The non-obvious ones:

- **`npx astro sync`** — regenerate `.astro/` types after touching `astro.config.mjs`, content collections, or env schema. CI runs this before lint; run it locally if types look stale. (Or `/verify` to mirror CI: sync → lint → build.)
- `npx wrangler deploy` — ship `./dist` to Cloudflare Workers manually (ad-hoc/local); CI also runs this automatically on every push to `master` (see Git & CI).

`npm test` runs the Vitest unit/integration suite; `npm run test:e2e` runs the Playwright e2e suite. Both are wired into CI (see Git & CI).

## Conventions

- **Imports use the `@/*` alias** → `src/*` (e.g. `@/lib/supabase`, `@/components/ui/button`). Defined in both `tsconfig.json` and `components.json`. Don't write deep relative paths.
- **Formatting (enforced, do not fight it):** double quotes, 2-space indent, `printWidth: 120`, semicolons, `trailingComma: "all"`. Config: `@.prettierrc.json`.
- **ESLint is strict + type-checked** (`typescript-eslint` strict + stylistic, react-compiler as error, astro plugin). `no-console` warns. Unused vars error unless prefixed `_`. Config: `@eslint.config.js`. **Exception:** everything under `packages/` is ignored — see Standalone packages.
- shadcn/ui components live in `src/components/ui/`; add new ones via the shadcn CLI, don't hand-roll. Auth UI in `src/components/auth/`.
- Make React interactive only with explicit `client:*` directives.
- **Tailwind class merging:** use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names — don't concatenate class strings manually.
- **API routes validate input with zod** (e.g. `src/pages/api/flashcards/generate.ts`, `[id].ts`) before touching Supabase.
- **E2E: navigate via the hydration-safe helpers.** `client:load` islands render server-side first and hydrate asynchronously; clicking before hydration completes can silently no-op. Always call `gotoAndWaitForHydration`/`reloadAndWaitForHydration` from `tests/e2e/navigate.ts` — never call `page.goto()`/`page.reload()` directly in `tests/e2e/**`.

## Architecture notes

- API endpoints live under `src/pages/api/` (e.g. `auth/signin.ts`).
- **Auth & route protection:** `src/middleware.ts` guards routes listed in its `PROTECTED_ROUTES` array and attaches the user to `context.locals.user`. Supabase SSR client (cookie-based, `@supabase/ssr`) lives in `src/lib/supabase.ts`.
- **DB migrations** live in `supabase/migrations/`, named `YYYYMMDDHHmmss_short_description.sql` (flashcards, SRS state, account deletions). Apply locally with `npx supabase db reset` or `start`; pushed to production automatically by the `deploy` job in CI (see Git & CI).

## Environment

- Required, **server-only secrets**: `SUPABASE_URL`, `SUPABASE_KEY` (see `@.env.example`). Never expose them to client code — the Astro env schema marks both `context: "server", access: "secret"`.
- Local dev needs both a `.env` and a `.dev.vars` (Wrangler reads the latter). Local Supabase: `npx supabase start` (requires Docker). Production secrets: `npx wrangler secret put <NAME>`; CI needs them as GitHub repo secrets.
- On Colima (not Docker Desktop): `supabase start` on CLI `2.109.x`+ can fail to start the `vector` sidecar container (`mkdir .../docker.sock: operation not supported`), aborting the whole local stack — a Colima/Docker-socket-mount incompatibility, not a project bug. CI (real Docker) is unaffected. If hit, try a different Colima VM type or Docker Desktop for local `supabase start`.

## Git & CI

- Pre-commit (`.husky/pre-commit` → lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`. A lint failure blocks the commit.
- CI (`@.github/workflows/ci.yml`) runs on push/PR to **`master`**: `npm ci` → `astro sync` → lint → start a local Supabase stack → `npm test` (Vitest) → `npm run test:e2e` (Playwright) → build → Supabase migration dry-run (`supabase db push --dry-run`, catches migrations that fail against prod before merge). Note the default branch here is `main` but CI targets `master` — confirm the intended branch before relying on CI.
- On push to `master`, the `deploy` job additionally pushes pending Supabase migrations for real (`supabase db push`) before `wrangler deploy`, so prod schema stays in sync with the repo. Requires repo secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`.
- Commit style: Conventional Commits.
- **CI covers the root app only.** Nothing under `packages/` is installed, linted, type-checked, built or tested by the pipeline — a green CI says nothing about those packages (see Standalone packages).

## Standalone packages

`packages/*` are **not npm workspaces**. Each carries its own `package.json`, lockfile, `node_modules`, `tsconfig.json` and `eslint.config.js`, and is installed and verified from inside its own directory:

```bash
cd packages/<name> && npm ci && npm run lint && npm run typecheck
```

Consequences worth knowing before you touch one:

- Root `eslint .` ignores everything under `packages/` **on purpose**: root lint is type-aware, and the root `npm ci` does not install package dependencies, so every import there resolves to an error type and the `no-unsafe-…` rules fail the build. Don't "fix" this by removing the ignore — either install the package's deps in CI first, or convert the repo to workspaces.
- Root `npm ci` does not touch them. **Run `npm install` from inside the package directory** — a stray install at the root silently rewrites the root manifest and lockfile instead.
- Their own `lint`/`typecheck` are not wired into the pipeline. If a package stops being throwaway, it needs its own CI job.

## Don't touch

`CLAUDE.md` lines between `<!-- BEGIN @przeprogramowani/10x-cli -->` and `<!-- END -->` are generated by the 10x-cli and get regenerated — edit `AGENTS.md` instead. Skills must not write to `context/archive/` (immutable).
