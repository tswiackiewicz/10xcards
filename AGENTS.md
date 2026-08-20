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
- CI (`@.github/workflows/ci.yml`) runs on push/PR to **`master`** — which is also the repository's default branch. The `ci` job: `npm ci` → `astro sync` → `actionlint` (validates everything under `.github/workflows/`, and local composite actions transitively through their `uses:`) → lint → start a local Supabase stack → `npm test` (Vitest) → `npm run test:e2e` (Playwright) → build → Supabase migration dry-run (`supabase db push --dry-run`, catches migrations that fail against prod before merge).
- On push to `master`, the `deploy` job additionally pushes pending Supabase migrations for real (`supabase db push`) before `wrangler deploy`, so prod schema stays in sync with the repo. Requires repo secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`.
- Commit style: Conventional Commits.
- **CI covers the root app plus one package.** A second job, `code-review-package`, installs `packages/code-review` and runs its lint, typecheck and tests in parallel with `ci`. Nothing else under `packages/` is touched by the pipeline. Two limits worth internalizing: the job is **not a required check** and `deploy` does not depend on it, so a green `ci` — and a merge — still says nothing about the package; and no package is ever *built* by CI (the code-review package runs from source via `tsx`).
- AI code review (`@.github/workflows/ai-code-review.yml`) runs on every non-draft, same-repo PR to `master`: it posts one sticky comment and applies exactly one of `ai-cr:passed` / `ai-cr:failed`. It is **advisory** — it never blocks a merge. Re-run it by adding the `ai-cr:review` label. A PR whose reviewable diff is empty, or whose review could not run, gets a comment and **no** verdict label, so a green label never certifies an unreviewed change. Needs the `OPENROUTER_API_KEY` repo secret; the three `ai-cr:*` labels are provisioned by a one-off `workflow_dispatch` run of `ai-review-labels.yml`.

## Standalone packages

`packages/*` are **not npm workspaces**. Each carries its own `package.json`, lockfile, `node_modules`, `tsconfig.json`, `eslint.config.js` and `.prettierrc.json`, and is installed and verified from inside its own directory:

```bash
cd packages/<name> && npm ci && npm run lint && npm run typecheck
```

Consequences worth knowing before you touch one:

- Root `eslint .` ignores everything under `packages/` **on purpose**: root lint is type-aware, and the root `npm ci` does not install package dependencies, so every import there resolves to an error type and the `no-unsafe-…` rules fail the build. Don't "fix" this by removing the ignore — either install the package's deps in CI first, or convert the repo to workspaces.
- **A package needs its own `.prettierrc.json`.** Without one, `eslint-plugin-prettier` walks up to the root config, which loads `prettier-plugin-astro` and `prettier-plugin-tailwindcss` — resolvable only from the root `node_modules`. It passes locally and fails in a package-only CI job with `Cannot find package 'prettier-plugin-astro'`.
- Root `npm ci` does not touch them. **Run `npm install` from inside the package directory** — a stray install at the root silently rewrites the root manifest and lockfile instead.
- `code-review` is the exception to the line above: it is load-bearing (its failure breaks AI review on every PR), so it now has its own non-required CI job. Every other package's `lint`/`typecheck` is still wired into nothing.
- **`packages/code-review` also carries a hand-run eval suite.** `npm run eval`, from inside the package, sweeps the reviewer prompt across three models with promptfoo. It **spends real money every run**, needs `OPENROUTER_API_KEY`, and pulls 500–825 transitive packages through `npx` on first use — which is why it sits outside CI and outside the package's dependencies. `evals/**` is excluded from vitest so a keyless CI job can never collect it. Read `packages/code-review/evals/README.md` first.
- **Fork PRs get no AI review.** This repository is PUBLIC, so a fork PR receives a read-only token and no secrets — the review cannot run, and even a "skipped" comment would 403 and read as a bot failure. The job skips silently by design, which makes this line the only record of the limitation. Dependabot PRs skip for the same reason (same-repo branches, but still no secrets).

## Don't touch

`CLAUDE.md` lines between `<!-- BEGIN @przeprogramowani/10x-cli -->` and `<!-- END -->` are generated by the 10x-cli and get regenerated — edit `AGENTS.md` instead. Skills must not write to `context/archive/` (immutable).
