# 10xCards

Paste your notes, get AI-generated flashcards, study them with spaced repetition.

## What it is

Manually turning notes into good flashcards is slow enough that most self-directed
learners never get around to spaced repetition in the first place. 10xCards removes that
friction: paste text you already have (an article, a chapter, your own notes) and the app
proposes candidate question/answer flashcards. You review each candidate — accept, edit,
or reject it — and only accepted cards join your deck. From there, a spaced-repetition
schedule decides which card to show you next based on how well you've recalled it before.

It's built for a single self-directed learner managing their own study, not a
team/classroom tool — every user sees only their own deck.

## Core features

- **AI-generated flashcards** from pasted text, with per-card accept/edit/reject review
  before anything is saved
- **Manual flashcard authoring** for cards AI generation doesn't fit
- **Deck management** — view, edit, and delete your saved flashcards
- **Spaced-repetition study loop** (FSRS scheduling algorithm) that picks the next due card
- **Account** with email/password sign-up and sign-in, and self-service account deletion
  with a 30-day recovery window before permanent erasure

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v24.17.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/tswiackiewicz/10xcards.git
cd 10xcards
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

> **Reach it as `localhost`, not as a LAN address.** Session cookies are set with `secure: true`,
> and a browser only treats `localhost` as a secure context — so opening the dev server as
> `http://192.168.x.x:4321` from a phone or another machine silently drops every auth cookie, with
> no error to explain it. Put a TLS-terminating tunnel in front if you need real-device testing.

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier

## Project Structure

```md
.
├── src/
│ ├── pages/ # Astro pages (SSR)
│ │ └── api/ # API endpoints
│ ├── layouts/ # Astro layouts
│ ├── components/ # UI components (Astro & React islands)
│ │ └── ui/ # shadcn/ui primitives
│ ├── lib/ # Domain logic, Supabase clients, helpers
│ ├── db/ # Generated Supabase types
│ ├── styles/ # Global stylesheet
│ └── middleware.ts # Auth gate + security headers
├── supabase/
│ ├── migrations/ # Schema, applied by `supabase start` and by CI
│ ├── seed.sql # Local seed data
│ └── config.toml # Local stack config (never pushed to production)
├── tests/
│ ├── unit/ # Vitest, hermetic
│ ├── integration/ # Vitest, against the local Supabase stack
│ ├── e2e/ # Playwright
│ ├── helpers/ # Shared test helpers
│ └── setup/ # Env population for both runners
├── packages/
│ └── code-review/ # Standalone AI code-review tool (own lockfile, not a workspace)
├── scripts/ # verify-rls.mjs — RLS regression guard
├── context/ # Planning and research documents
├── public/ # Static assets served as-is
├── astro.config.mjs # Astro config, incl. the CSP
└── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Start the local stack (downloads Docker images on first run, and applies every migration
   under `supabase/migrations/` to a fresh database):

```bash
npx supabase start
```

3. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

4. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

The schema lives in `supabase/migrations/` and is applied for you: `npx supabase start` runs every migration against the fresh local stack, and `npx supabase db reset` re-applies them from scratch. Production schema is **not** applied by a local command — the CI `deploy` job runs `supabase db push` on every push to `master`, so a migration is not live in production until that job has run.

### What `supabase/config.toml` does and does not govern

`supabase/config.toml` configures the **local** stack only. CI pushes `supabase/migrations/**` and
nothing else, so no value in that file has ever reached production. In particular
`minimum_password_length`, the empty `password_requirements`, `enable_confirmations = false`, the
disabled captcha and the whole `[auth.rate_limit]` block describe your laptop, not the deployed app.

Production auth policy lives in the Supabase dashboard (Authentication → Providers / Rate limits) and
**this repository does not attest to it**. Before treating password strength, email confirmation or
auth rate limiting as configured in production, read the real values there. If they turn out weaker
than the local config implies, that is a finding to raise, not something to quietly change — altering
production auth policy is its own decision.

One related fact that _is_ verified:

- `SITE_URL` is set as a GitHub Actions repository variable and is injected at build time
  (`ci.yml`, read by `astro.config.mjs` via `loadEnv`). It is what populates the `og:` tags; the guard
  in `src/layouts/Layout.astro` correctly suppresses them if it is ever unset.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                                                                         |
| `/auth/signup`        | Email/password sign-up form                                                                                         |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                                                                 |
| `/dashboard`          | Product hub — links to generate, create, browse, study and account (redirects to `/auth/signin` if unauthenticated) |

Route protection is enforced twice, deliberately: `src/middleware.ts` gates every path in its `PROTECTED_ROUTES` array, and each protected page independently redirects when `Astro.locals.user` is null. Add a new protected path to both — the middleware array and the page's own guard.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs on every push and PR to `master`:

- **`ci`** (the only required check) — `astro sync`, `actionlint`, lint, Vitest and Playwright against a local Supabase stack, and build. `supabase start` applies every migration to that fresh local stack, so a migration that cannot apply at all still fails the PR. `SUPABASE_URL` and `SUPABASE_KEY` are **not** repository secrets: the workflow reads them from `supabase status` into `$GITHUB_ENV`, so `ci` needs no repository secret of its own.
- **`migration-dry-run`** — `supabase db push --dry-run` against the **production** project. Runs on push to `master` only, never on a `pull_request`, so the production credentials (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`) are never in scope in a job built from a PR branch. **The trade, stated plainly:** divergence against production's actual schema state is now caught _post-merge_ on `master`, not pre-merge in the PR.
- **`code-review-package`** — lint, typecheck and tests for `packages/code-review`, in parallel with `ci` and not required.
- **AI code review** (`.github/workflows/ai-code-review.yml`) — reviews every non-draft, same-repo PR against a five-criterion rubric (defined in `packages/code-review/docs/criteria.md`), posts a sticky comment and applies `ai-cr:passed` / `ai-cr:failed`. Advisory; never blocks a merge. Needs the `OPENROUTER_API_KEY` repo secret.

On push to `master`, `deploy` waits for both `ci` and `migration-dry-run`, then pushes pending Supabase migrations and runs `wrangler deploy`. It needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## License

MIT
