# Certification Readiness Implementation Plan

## Overview

Make this public repo read as a classic product application and close the security findings the audit surfaced — without rewriting git history and without dismantling `context/`.

Two independent goals share one change:

1. **Security.** Patch the one advisory that reaches the deployed Worker, stop a 400-day refresh token being readable from `document.cookie`, remove the class where a manual deploy would publish the service-role key, add security headers, and close the CI paths that expose production credentials to PR-triggered jobs.
2. **Provenance.** Delete the six public artifacts that are unmistakably course output, fix the one starter literal left in a live config, and finish the repo-hygiene gaps (`LICENSE`, three inaccurate README sections, missing `package.json` fields) that make the repo read as unfinished.

## Current State Analysis

Grounded in `context/changes/certification-readiness/research.md` (same commit, `ffdef9d`).

**The shipped application is already clean.** No user-visible string, image, or meta tag in `src/**` or `public/**` mentions the course, a lesson, a module, or the starter. `10xCards` is the product's own brand (`src/layouts/Layout.astro:14`, `src/components/Logo.astro:27`); `public/og.png` and the three favicons are hand-authored. Research §A verified this surface by surface. **De-course-ification is documentation and config surgery — it touches no application logic.**

**Visibility is inverted from intuition.** The ~1.1 MB of obvious course machinery — 26 `10x-*` skills, 30 lesson-numbered prompts — is entirely gitignored (`.gitignore:43-53`) and has never been tracked. The public leak is six artifacts plus one config literal, none with mechanical coupling (research §B): removing all of them breaks no build, test, hook, or workflow.

**No secret was ever committed** — verified positively, not by absence of effort: 845 blobs = 100% of history (791 reachable + 54 unreachable via `git fsck`), scanned binary-safe against 11 credential patterns, with a positive control proving the regexes fire on the live `.env`. `.gitignore` carried `.env`, `.env.production`, `.dev.vars` from its first version, so there was never a gap window. **No rotation is warranted.**

**Three security findings are live and small:**

- `astro@6.4.7` is installed (verified: `npm ls astro`) and is the _only_ 6.x release affected by GHSA-vj59-8hwv-xxmv (CVSS 8.2, authorization bypass via path-canonicalization mismatch). This app's only page-level auth gate is exactly the decoded-`pathname` prefix matcher the advisory targets (`src/middleware.ts:4,19`), and none of the six protected pages re-checks the session.
- `src/lib/supabase.ts:18-22` forwards `@supabase/ssr` 0.10.3 defaults verbatim into `AstroCookies.set` — `httpOnly: false`, no `secure` key at all, `maxAge: 400 days`.
- `wrangler.jsonc:11` declares `"directory": "./dist"`, and `dist/server/.dev.vars` holds live keys including the service role.

**Two config-vs-reality mismatches share one root cause:** the checked-in config is not the config that ships. `wrangler.jsonc` says `./dist` while the actual deploy uses `dist/client` via an indirection; `supabase/config.toml` is local-dev only while production auth policy lives in a dashboard.

### Key Discoveries:

- **`cookieOptions` is a first-class `createServerClient` option** — confirmed in the installed types at `node_modules/@supabase/ssr/dist/main/createServerClient.d.ts:9,65` as `CookieOptionsWithName`. The fix is one option object, not a wrapper around `setAll`.
- **`setAll` takes a second parameter the current code drops.** Verified at `node_modules/@supabase/ssr/dist/main/cookies.js:328,376-380` — `applyServerStorage`, the server-client path this app uses, calls `setAll` with `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache`, explicitly so a CDN cannot serve one user's session token to another. `src/lib/supabase.ts:18` ignores it. **This is beyond the research findings and matters specifically here**, because the app sits behind Cloudflare. `src/lib/supabase.ts` is not the fix site though — it has no response object, and `createClient` is called from 16 files with only `requestHeaders` and `cookies`; middleware keyed on `locals.user` is (see Phase 1 change 4).
- **Astro 6 has a stable, hash-based CSP.** `security.csp` (`node_modules/astro/dist/types/public/config.d.ts:660,699` — `@version 6.0.0`, default `false`) emits `sha256` hashes for Astro's own bundled scripts and styles, which removes the need for `'unsafe-inline'` — a combination Astro's docs state is **incompatible** with its implementation. It ships as a `<meta http-equiv>` element, so it cannot be report-only and ignores `frame-ancestors`, and it does not work under `astro dev`. Both of its documented incompatibilities are verified absent here: no Shiki / `<Code>` usage and no `ClientRouter` / `transition:*` (0 hits each).
- **`SITE_URL` comes from a GitHub Actions repo _variable_, not from Cloudflare.** `ci.yml:50` and `ci.yml:101` both inject `${{ vars.SITE_URL }}` at build time, and `astro.config.mjs:13` reads it via `loadEnv` before `astro:env` exists. Research §H said "must exist in Cloudflare" — the actual verification target is GitHub repo variables. The `og:` guard at `src/layouts/Layout.astro:40-47` is deliberate and correct; only the variable is in question.
- **`packages/code-review` already carries zero course vocabulary.** Verified across every tracked file in the package except the frozen eval corpus: no `lesson`, `10xdevs`, `przeprogramowani`, `10x-astro-starter`, or `module N` hits. The "trim the lesson framing" decision collapses to a verification step.
- **`.gitignore` is load-bearing beyond ignoring.** `eslint.config.js:88` feeds it into `includeIgnoreFile()`, so `.gitignore:52` (`.github/**/10x-*`) also shapes lint scope — which is why `.github/actions/ai-code-review/action.yml:4-6` warns the directory must not start with `10x-`. This is why the rules stay even though 10x-cli use stops.
- **Defence in depth bounds the Astro advisory.** Every API route independently re-verifies the session and RLS is the actual data boundary, so a page-level bypass leaks an empty page shell, not user data. That is why the durable fix — a per-page session check — closes the class regardless of Astro version.
- **`ci.yml` and `purge.yml` have no `permissions:` block**, while `ai-code-review.yml`, `ai-review-labels.yml` and `ai-review-smoke.yml` all declare least privilege correctly. The workflow set is internally inconsistent, and the two without are the two with production credentials.

## Desired End State

A fresh `git clone` and a visit to the GitHub repo page show a coherent Astro + Supabase flashcards product: an accurate README, a real `LICENSE`, a populated `package.json`, no course or starter reference in any tracked file, patched dependencies, security headers on every response, and auth cookies that a browser script cannot read.

`context/` stays where it is, git history stays untouched, and the 10xCards brand stays.

Verify by: `git grep -iE 'przeprogramowani|10xdevs|10x-astro-starter|lesson' -- ':!context/' ':!packages/code-review/evals/corpus'` returns nothing; `npm ls astro` reports `6.4.8`; a production response carries `Set-Cookie: …HttpOnly; Secure`, and the served HTML carries a hash-based `<meta http-equiv="content-security-policy">` alongside HSTS / `nosniff` / `Referrer-Policy` / `frame-ancestors` headers; `npm test && npm run test:e2e && npm run build` all pass.

## What We're NOT Doing

Decided during questioning — recorded so the implementer does not drift into them:

- **No git history rewrite.** No squash, no `filter-repo`, no message rewriting. The repo has been public ~10 weeks, all 17 PRs stay reachable under `refs/pull/N/head` with change-id vocabulary in their titles, orphaned commits stay reachable by SHA, and code-search indexes are out of reach — a rewrite changes only what a fresh clone shows.
- **No relocation or untracking of `context/`.** The 23 change folders stay in place. Only the two B-class artifacts inside it are deleted.
- **No product or repo rename.** `10xCards`, `10xcards`, and the Worker name `10x-cards` all stay. Renaming the Worker creates a _new_ Worker with no secrets and no routes while the old one keeps serving (`context/archive/2026-08-22-start-page-redesign/reviews/plan-review.md:106`).
- **No changes to `context/domain/` or `context/deployment/`.** The Module 4 architect report, the 50 lines of Polish event-storming, and the "Lesson 5 deliverable" line all stay as-is.
- **No rename of the `risk1-`…`risk10-` test files or the `F-01`/`S-04`/`S-05` migration slice IDs**, and **no CI grep gate** to enforce the cleanup. This change is a one-time cleanup with no regression guard.
- **No `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, or issue/PR templates**, and no version bump off `0.0.1`.
- **G4 (rate limiting on auth and the paid AI endpoint) and G7 (the `:free` model vs the stated paid-model GDPR intent) are out of scope** — see Open Risks, both are real.
- **G8 (`is_pending_deletion` as a PostgREST RPC) and G10 (`set_updated_at` search_path) are out of scope** — both LOW, and G8 costs a migration touching all four flashcards policies.
- **No Astro 7 major.** The three residual XSS advisories require it, and research verified none of the three attack surfaces exists here (0 spread attributes, 0 `transition:*` directives, 0 `ClientRouter` imports). They are the _expected_ residual after the fix — do not chase them with `--force`.
- **No secret rotation.** History is verified clean.
- **No PR title edits.** GitHub-side work is limited to the repo About box.

## Implementation Approach

Five phases, security first. The only part with active risk is the live deployed app, so it ships before any documentation work. CSP lands late (Phase 4) because it is the single change that can visibly break island hydration, and it should not sit in front of four one-line fixes.

Phases 1, 2 and 4 touch code, config and workflows and are verified by the suite. Phases 3 and 5 are documentation and deletions, verified by `git grep` and a read-through.

**Branch:** work continues on `feat/start-page-redesign` (the user's decision). See Critical Implementation Details — this branch is based on a `master` that predates PR #17's merge, and that must be resolved before the first push.

## Critical Implementation Details

**Fetch before pushing anything.** `git ls-remote` shows real remote `master` is `6048585`, an object not present locally; local `master` is `4cb3683`, behind, because PR #17 was squash-merged server-side after the last fetch. The working branch `feat/start-page-redesign` carries 2 unpushed `context/`-only commits and branches off the stale local `master`. Run `git fetch origin` and rebase onto `origin/master` **before** the first commit of Phase 1 — otherwise the eventual PR reverts PR #17's merge.

**`Secure` cookies and the local e2e suite.** `playwright.config.ts:5` pins `baseURL` to `http://localhost:4321`. Chromium treats `localhost` as a trustworthy origin, so `Secure` cookies are accepted there and the suite should pass unchanged — but this is the one plausible break in Phase 1. If the e2e auth flows fail, gate the flag (`secure: import.meta.env.PROD`) rather than dropping it.

**The CSP is split across two mechanisms, deliberately.** Astro 6 ships a **stable** `security.csp` option (`node_modules/astro/dist/types/public/config.d.ts:660,699` — `@version 6.0.0`, default `false`). Enabling it makes Astro emit `sha256` hashes for its own bundled scripts and styles into a `<meta http-equiv="content-security-policy">` element, which is exactly the island-hydration problem that would otherwise force `'unsafe-inline'`. Astro's own docs state `'unsafe-inline'` is **incompatible** with its CSP implementation — browsers reject it when a hash or nonce appears in the same directive — so `'unsafe-inline'` is not a fallback here, it is a dead end.

Two consequences the implementer must not fight:

- A `<meta http-equiv>` CSP **cannot** express report-only, and **ignores** `frame-ancestors`. So `script-src`/`style-src` ship **enforcing** via `security.csp`, and the directives meta cannot carry — `frame-ancestors`, plus HSTS, `X-Content-Type-Options` and `Referrer-Policy` — are set as real headers around `next()` in `src/middleware.ts`. Not in a `_headers` file: that applies only to responses from Cloudflare's asset worker, and every HTML page here is SSR.
- `security.csp` **does not work under `astro dev`** (Vite dev server). `playwright.config.ts:33` deliberately runs `npm run dev`, so the e2e suite cannot verify the CSP at all — it must be checked against `npm run build && npx astro preview`.

Both of Astro CSP's documented incompatibilities are verified absent here: no Shiki / `<Code>` usage anywhere in `src/`, and no `ClientRouter` or `transition:*` directives (0 hits each).

**`sameSite: "lax"` is load-bearing and must be preserved.** It is a second, independent CSRF defence alongside `astro.config.mjs:21`'s `checkOrigin: true`, and it matters most for `POST /api/account/delete`, which reads no body at all. Do not tighten it to `strict` (it would break the OAuth-style redirect-back flows) and do not loosen it.

**Deleting the `CLAUDE.md` 10x-cli block is only durable if 10x-cli use stops.** The CLI keys off the `<!-- BEGIN … -->` / `<!-- END -->` marker comments and re-appends the block on the next `10x-cli get`. `.gitignore:43-53` stays regardless — `eslint.config.js:88` feeds it into `includeIgnoreFile()`, so removing those rules would both start tracking the 26 local `10x-*` skills and silently change lint scope.

**`packages/code-review/evals/corpus/pr-1.diff:66` must not be edited.** It contains the frozen starter README tagline inside a byte-reproducible eval fixture. It is the one place a course-vocabulary grep will legitimately hit, and it stays.

---

## Phase 1: Critical Security

### Overview

Close the two classes with active exploitability on the live app, plus the latent deploy hazard. Five changes, all small, all independently verifiable.

### Changes Required:

#### 1. Astro patch bump

**File**: `package.json`, `package-lock.json`

**Intent**: Patch GHSA-vj59-8hwv-xxmv (CVSS 8.2). `astro@6.4.7` is the only 6.x release affected, and this app's sole page-level auth gate is exactly the surface the advisory describes.

**Contract**: Installed `astro` resolves to `6.4.8`. `package.json:34` already reads `^6.3.1`, which `6.4.8` satisfies, so the manifest range need not change — the lockfile does. Non-breaking; do not take the v7 major.

#### 2. Auth cookie hardening

**File**: `src/lib/supabase.ts`

**Intent**: Stop the `sb-<ref>-auth-token[.N]` cookie pair — which carries both the access _and_ refresh token, with a 400-day lifetime — from being readable by any script via `document.cookie`, and from travelling in cleartext over an `http://` navigation. Cheap here specifically because the app never instantiates a browser-side Supabase client (`createBrowserClient` → 0 hits); every island talks to `/api/*`, so nothing in the browser needs to read that cookie.

**Contract**: `createServerClient` gains a `cookieOptions` object setting `httpOnly: true`, `secure: true`, `path: "/"`, and preserving `sameSite: "lax"`. The option is typed `CookieOptionsWithName` on the third argument (`node_modules/@supabase/ssr/dist/main/createServerClient.d.ts:9,65`), so it sits alongside `cookies`, not inside it.

`setAll`'s second parameter is left as-is — see change 4 for why it is not the fix site.

#### 3. Page-level session guards

**File**: `src/pages/dashboard.astro`, `generate.astro`, `create.astro`, `cards.astro`, `study.astro`, `account.astro`

**Intent**: Make the auth gate independent of the middleware's `pathname` matcher, so the bypass class is closed regardless of the Astro version. Currently each page just reads `Astro.locals.user` without acting on its absence (`src/pages/dashboard.astro:4`).

**Contract**: Each of the six pages returns `Astro.redirect("/auth/signin")` when `Astro.locals.user` is null, before rendering. Redirect target and behaviour must match `src/middleware.ts:22` exactly so the e2e auth-redirect assertions keep passing. This is defence in depth — the middleware guard stays.

#### 4. Cache headers on authenticated responses

**File**: `src/middleware.ts`

**Intent**: `@supabase/ssr` passes `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0` and `Pragma: no-cache` as the second argument to `setAll` — verified at `node_modules/@supabase/ssr/dist/main/cookies.js:328,376-380`, inside `applyServerStorage`, the server-client path this app uses. `src/lib/supabase.ts:18` discards it. Without those headers an intermediary can serve one user's session token to another, and this app sits behind Cloudflare.

**Contract**: The three headers are set in middleware on the response returned from `next()` whenever `context.locals.user` is non-null — the check already exists at `src/middleware.ts:13`.

Deliberately **not** conditioned on "an auth cookie was actually written". `createClient` is called from 16 files and receives only `requestHeaders` and `cookies`, with no route to `locals` or the response; routes build their own clients _after_ middleware has entered `next()`, so middleware cannot observe a downstream write without widening the signature across all 16 call sites. Keying on `locals.user` is both simpler and the correct caching posture for a per-user SSR page regardless — the cost is that authenticated pages become uncacheable at the edge even when no cookie was rewritten, which is acceptable because they are per-user anyway. Anonymous responses stay cacheable.

#### 5. Wrangler asset root

**File**: `wrangler.jsonc`

**Intent**: Remove the class where an explicit `wrangler deploy -c wrangler.jsonc`, or a deploy after `.wrangler/` is cleaned but `dist/` is not, publishes `dist/server/.dev.vars` — 309 B containing `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `CRON_PURGE_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`. `AGENTS.md:14` and `README.md:184` both advertise `npx wrangler deploy` as a supported manual path, so a human will run this by hand.

**Contract**: `"directory"` changes from `"./dist"` to `"./dist/client"`, matching what the deploy indirection already resolves to (`dist/server/wrangler.json` sets `"directory": "../client"`). The `binding` and `not_found_handling` keys are unchanged. Worker `name` stays `10x-cards`.

`AGENTS.md:14` currently reads "`npx wrangler deploy` — ship `./dist` to Cloudflare Workers manually" and goes stale with this edit; update it to `./dist/client` in the same commit.

### Success Criteria:

#### Automated Verification:

- `npm ls astro` reports `astro@6.4.8`
- `npm audit --json` no longer reports GHSA-vj59-8hwv-xxmv
- Lint and types pass: `npx astro sync && npm run lint`
- Unit/integration suite passes: `npm test`
- E2E suite passes, including the auth-redirect specs: `npm run test:e2e`
- Build passes: `npm run build`
- `npx wrangler deploy --dry-run -c wrangler.jsonc` reports files read from `dist/client` and no `.dev.vars` in the list. The `-c` is **required**: a bare dry-run resolves through `.wrangler/deploy/config.json` to `dist/server/wrangler.json` (`"directory": "../client"`) and reports `dist/client` whether or not the fix landed

#### Manual Verification:

- On a deployed preview, `Set-Cookie` for `sb-*-auth-token` carries both `HttpOnly` and `Secure`
- `document.cookie` in the browser console shows no `sb-*-auth-token` entry while signed in
- Signing in still works end to end, and the pending-deletion diversion to `/account` still fires
- Visiting each of the six protected pages while signed out redirects to `/auth/signin`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Dependencies and CI Hardening

### Overview

Resolve the dependency cluster on stable releases, and bring `ci.yml` and `purge.yml` up to the least-privilege standard the three `ai-review-*` workflows already meet.

### Changes Required:

#### 1. Wrangler and its transitive cluster

**File**: `package.json`, `package-lock.json`

**Intent**: Resolve the `wrangler` / `miniflare` / `undici` / `ws` advisory cluster without pulling a prerelease. A plain `npm audit fix` was shown to pull `miniflare 4.20260616.0 → 5.20260801.0-alpha`.

**Contract**: `wrangler` devDependency bumped to `4.125.0` explicitly (`npm i -D wrangler@4.125.0`), then re-audit. Every remaining advisory must be either build/dev/CLI-only or one of the three Astro-v7 XSS advisories. No prerelease may appear in `package-lock.json`. Record the residual count.

#### 2. Least-privilege workflow permissions

**File**: `.github/workflows/ci.yml`, `.github/workflows/purge.yml`

**Intent**: Both workflows currently fall back to the repo/org default `GITHUB_TOKEN` scope. `ci.yml` reaches `deploy` with `CLOUDFLARE_API_TOKEN` and the Supabase production secrets.

**Contract**: Each workflow declares an explicit top-level or per-job `permissions:` block granting only what its steps need — `contents: read` for `ci` and `code-review-package`, and whatever `deploy` genuinely requires. Match the style already used in `ai-code-review.yml`. `actionlint` runs inside `ci` and must stay green.

#### 3. Pin third-party actions to commit SHAs

**File**: `.github/workflows/ci.yml`

**Intent**: Four third-party actions float on mutable tags on every PR: `raven-actions/actionlint@v2` (`:26`), `supabase/setup-cli@v2` (`:30`, `:103`), `cloudflare/wrangler-action@v4` (`:120`). A tag repoint gets whatever the default token grants.

**Contract**: Each third-party `uses:` is pinned to a full 40-character commit SHA with the human-readable version retained as a trailing comment. `actions/checkout` and `actions/setup-node` are first-party GitHub actions — pin them too for consistency, or leave them; state which and be consistent. The existing explanatory comment at `ci.yml:24-25` about `raven-actions` vs `rhysd` must be preserved.

#### 4. Move the production migration dry-run off PR triggers

**File**: `.github/workflows/ci.yml`

**Intent**: `ci.yml:52-59` links the **production** Supabase project and runs `supabase db push --dry-run` on every PR, with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and `SUPABASE_PROJECT_ID` in the step env — in the same job that already ran `npm ci`, tests, build and e2e from the PR branch. For a same-repo `pull_request`, the workflow definition comes from the PR, so anyone with push access can edit `ci.yml` in a PR and print the production DB password.

**Contract**: The "Check Supabase migrations apply cleanly" step (`ci.yml:52-59`) moves into a `push`-only job. Production secrets must no longer be reachable from a `pull_request` event. `deploy`'s own `supabase db push` and its "Verify migrations fully applied" step are unchanged.

**State the loss plainly — do not paper over it.** `ci.yml:33` already runs `supabase start`, which applies every migration to a fresh local stack, so _local-apply_ failures are still caught pre-merge and no extra `supabase db reset` step is needed. But what the dry-run uniquely catches is **divergence against production's actual schema state**, and no local run can see that. After this change, prod-divergence surfaces on `master`, not in the PR. That is the failure mode `context/foundation/lessons.md`'s "Migrations aren't shipped until CI pushes them" was written about, so it must be recorded, not assumed away:

- `README.md:193` currently describes `ci` as including the migration dry-run — update it here, not in Phase 5.
- `AGENTS.md`'s CI section says the dry-run "catches migrations that fail against prod before merge" — that becomes false; update it to say post-merge and name the trade.

If the approval friction is acceptable later, a GitHub Environment with required reviewers would restore pre-merge coverage behind a gate. That is explicitly not this change.

### Success Criteria:

#### Automated Verification:

- `npm audit --json` residual set contains only build/dev/CLI advisories plus the three Astro-v7 XSS advisories
- No prerelease version string in `package-lock.json` beyond the pre-existing `eslint-plugin-react-compiler` pin
- `actionlint` passes (runs inside `ci`)
- Full CI passes on the branch: lint, `npm test`, `npm run test:e2e`, `npm run build`
- No `pull_request`-triggered job references `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, or `SUPABASE_PROJECT_ID`
- `supabase start` still applies all five migrations in the `ci` job (unchanged behaviour, asserted so the remaining pre-merge coverage is explicit)

#### Manual Verification:

- Every third-party `uses:` in `ci.yml` shows a 40-char SHA with a version comment
- A push to `master` still deploys: migrations pushed, then `wrangler deploy`
- `README.md`'s CI description matches the reorganised jobs

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: Provenance Surgery

### Overview

Delete the six public course artifacts and fix the one starter literal in a live config. Research verified all six have zero mechanical coupling — no build, test, hook, or workflow reads any of them.

### Changes Required:

#### 1. Delete the committed course-skill snapshot

**File**: `context/foundation/.claude/` (15 tracked files, 260 KB)

**Intent**: The single highest-leverage deletion in the repo — roughly 110 of the tracked `10x` hits. It escapes the root-anchored `.gitignore` rules that hide the real `.claude/`, and its manifest is dispositive: `"package": "@przeprogramowani/10x-cli"`, `"course": "10xdevs3"`, `"lessonId": "m1l2"`. It includes `10x-tech-stack-selector/references/starter-registry.yaml:86,92` with the starter clone URL. Touched by exactly one commit in ten weeks; nothing reads it.

**Contract**: `git rm -r context/foundation/.claude/`. Confirm no tracked file references the path afterwards.

#### 2. Delete the second committed lesson handout

**File**: `context/foundation/CLAUDE.md` (7.1 KB)

**Intent**: A verbatim "Module 1, Lesson 2" handout — `:3` names the module, `:5` says "Pick a starter and a stack for the PRD you wrote in Lesson 1". Nothing reads it.

**Contract**: `git rm context/foundation/CLAUDE.md`. Note the root `CLAUDE.md` is a different file and is handled next. `context/foundation/README.md` must not be left pointing at the deleted file — check and fix if it does.

#### 3. Remove the generated 10x-cli block

**File**: `CLAUDE.md`

**Intent**: The loudest front-page signal. GitHub renders `CLAUDE.md` in the root file listing, and `:7` reads "## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)" in plain text, with "Lesson 5" cross-references at `:30,33`. `@przeprogramowani/10x-cli` is not a dependency (0 hits in `package.json` and `package-lock.json`) — it is a globally installed CLI. Nothing mechanical breaks. The E2E rules inside (locators, no `waitForTimeout`, test independence) are already duplicated at `AGENTS.md:27`, so no guidance is lost.

**Contract**: Lines 5–35 are removed, markers included, leaving `CLAUDE.md` as the `@AGENTS.md` import plus its comment. Line 1's comment is also stale — it claims the hand-maintained guidance lives "outside the 10x-cli block **above**" when the block is below — so rewrite or drop it. Before deleting, confirm every rule in the block is genuinely present in `AGENTS.md`; the `/10x-e2e` skill reference points at a gitignored skill absent from a fresh clone, so it should not be carried over verbatim.

This deletion is durable **only because 10x-cli use in this repo stops**. `.gitignore:43-53` stays.

#### 4. Delete the orphaned skills lockfile

**File**: `skills-lock.json` (root, 527 B)

**Intent**: `"source": "przeprogramowani/10x-cli"` at `:5,11`, locking two skills that live only in the gitignored `.agents/skills/` — a public lockfile for content no visitor can see. Zero coupling. Its sibling `packages/code-review/skills-lock.json` is already gitignored, so this is also an inconsistency.

**Contract**: `git rm skills-lock.json`. Consider adding it to `.gitignore` so it is not re-committed if the CLI regenerates it locally.

#### 5. Drop the 10x-cli clause from the agent doc

**File**: `AGENTS.md`

**Intent**: The `## Don't touch` section (`:69`) names the `@przeprogramowani/10x-cli` markers, which no longer exist after change 3. Everything else in `AGENTS.md` is a strong, ordinary agent-onboarding doc.

**Contract**: The 10x-cli sentence is removed from `## Don't touch`; the `context/archive/` immutability sentence stays. If the section is left with only that one sentence, keep it — it is still a real rule.

#### 6. Reword the methodology leak in the smoke workflow

**File**: `.github/workflows/ai-review-smoke.yml`

**Intent**: The comment at `:3` reads "Kept in the repo after **Phase 3**: it is the cheapest way to reproduce the `error` path on demand." "Phase 3" is plan-phase vocabulary from `context/changes/*/plan.md` — the only workflow leaking the methodology. No workflow leaks the course by name.

**Contract**: The comment keeps its substance (why the workflow is retained) and loses the phase reference. Do not delete the comment — it explains a non-obvious retention decision. Also check `purge.yml:3` ("S-05 Phase 3") — that carries the same vocabulary and should get the same treatment.

#### 7. Fix the starter literal in the live Supabase config

**File**: `supabase/config.toml`

**Intent**: `:5` reads `project_id = "10x-astro-starter"` — the only literal starter name left in a live config, and the loudest remaining provenance outside `context/`.

**Contract**: `project_id` becomes `"10xcards"`, matching `package.json:2`. This is the local-stack project identifier only; `supabase/config.toml` is never pushed to production (CI pushes `supabase/migrations/**` only), so production is unaffected. It does change the local Docker project namespace, so a `supabase stop` before and a `supabase start` after is expected, and the e2e suite must be re-run against the renamed stack.

#### 8. Fix the starter name left in the lockfile

**File**: `package-lock.json`

**Intent**: `:2` and `:8` still read `"name": "10x-astro-starter"`. `package.json` was renamed in `1c51e90` but the lockfile's `name` field was never regenerated, so this is the **last** literal starter name outside `context/` — in a root-level file GitHub indexes. Research §A missed it; without this step Phase 3's own cleanliness criterion fails.

**Contract**: Both occurrences read `10xcards`, matching `package.json:2`. npm rewrites this field from `package.json` on any lockfile write, so Phase 1's `astro` bump and Phase 2's `wrangler` bump have most likely already fixed it — check first, and only run `npm install --package-lock-only` if they did not. Nothing else in the lockfile should change; a diff touching dependency entries means something else happened and should be reverted.

#### 9. Verify `packages/code-review` needs no reframing

**File**: `packages/code-review/**` (verification only)

**Intent**: The decision was to keep the package and trim its lesson framing. Verification during planning found **zero** `lesson`, `module N`, `10xdevs`, `przeprogramowani`, or `10x-astro-starter` hits across every tracked file in the package outside the eval corpus. Confirm this still holds and make no edits.

**Contract**: `git ls-files packages/code-review | grep -v evals/corpus | xargs grep -inE 'lesson|10xdevs|przeprogramowani|10x-astro-starter|module [0-9]'` returns nothing. `packages/code-review/evals/corpus/pr-1.diff:66` holds the frozen starter README tagline and **must not be edited** — it is a byte-reproducible fixture.

### Success Criteria:

#### Automated Verification:

- `git grep -iE 'przeprogramowani|10xdevs|10x-astro-starter' -- ':!context/' ':!packages/code-review/evals/corpus'` returns nothing — this covers `package-lock.json`, so run it after the Phase 1/2 installs
- `node -e "console.log(require('./package-lock.json').name)"` prints `10xcards`
- `git grep -inE 'lesson|module [0-9]' -- ':!context/' ':!packages/code-review/evals/corpus'` returns nothing
- No tracked file references `context/foundation/.claude/` or `context/foundation/CLAUDE.md`
- Lint passes: `npx astro sync && npm run lint` (confirms the `.gitignore`-driven `includeIgnoreFile()` lint scope is unchanged)
- `actionlint` passes after the workflow comment edits
- Local stack comes up under the new project id: `npx supabase stop && npx supabase start`
- `npm test` and `npm run test:e2e` pass against the renamed local stack
- `npm run build` passes

#### Manual Verification:

- `CLAUDE.md` reads as a short, ordinary agent-instructions file with no course reference
- Every E2E rule that was in the deleted block is genuinely present in `AGENTS.md`
- The root file listing on GitHub shows no course reference in any rendered markdown
- `context/foundation/README.md` has no dangling reference to the deleted `CLAUDE.md`

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Security Headers and Error Hygiene

### Overview

The riskiest phase for visible breakage, which is why it lands after the one-liners. The CSP ships **enforcing** — Astro's hash-based implementation has no report-only mode — so the build-and-preview island check is the real gate, not the e2e suite.

### Changes Required:

#### 1. Script and style CSP via Astro's own hashes

**File**: `astro.config.mjs`

**Intent**: Give `script-src` and `style-src` a real, enforcing CSP without `'unsafe-inline'`. Astro computes `sha256` hashes for its own bundled scripts and styles, which is what makes this possible at all — hand-rolling would require `'unsafe-inline'` to let islands hydrate, and Astro rejects that combination outright.

**Contract**: `security.csp` is enabled on the existing `security` object at `astro.config.mjs:21`, alongside `checkOrigin: true` — the same key, not a new one. Start with `security.csp: true` and only reach for the object form (`algorithm`, `directives`, `styleDirective`) if a directive genuinely needs customising. This emits a `<meta http-equiv="content-security-policy">` into each page's `<head>`, **enforcing** — there is no report-only variant for a meta element.

#### 2. Header-only security directives

**File**: `src/middleware.ts`

**Intent**: The app sends no CSP, no HSTS, no `X-Content-Type-Options`, no `Referrer-Policy`, no frame-ancestors restriction (verified: 0 hits for those header names in `src/` and `public/`). Combined with the Phase 1 cookie fix, CSP is what turns "any injected script steals the session permanently" into "any injected script is blocked" — it is the other half of G1, not a separate nicety. This change carries the directives change 1 structurally cannot.

**Contract**: Set on the response returned from `next()` in `src/middleware.ts` — **not** in a `_headers` file, which applies only to responses from Cloudflare's asset worker while every HTML page here is SSR. Ship `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a `frame-ancestors` restriction (`Content-Security-Policy: frame-ancestors 'none'` — `frame-ancestors` is ignored in a meta element, so it must come from a header, and `X-Frame-Options` is the legacy equivalent if a header pair is preferred).

Must not disturb the `Cache-Control` work from Phase 1, and must not emit a second `script-src`/`style-src` — those belong to change 1, and duplicating them across a meta element and a header intersects the two policies rather than merging them.

#### 3. Generic auth error messages

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Both routes put Supabase's verbatim `error.message` into a query string (`signin.ts:16`, `signup.ts:17`), rendered by `src/components/auth/ServerError.tsx:13`. With confirmations off, signing up with an existing address returns `"User already registered"` — an account-existence oracle. Auth detail also lands in Referer headers, browser history, and Cloudflare logs. There is no XSS here (React escapes it, no `dangerouslySetInnerHTML` anywhere in the repo) and no open redirect (the target is hardcoded).

**Contract**: Supabase error codes map to a small set of fixed generic strings before reaching the query string — matching the enum discipline the flashcards endpoints already use (`generate.ts:58-63` swallows the OpenRouter status into a flat `502`). Signin and signup failures must be indistinguishable from an existence standpoint. The `"Supabase is not configured"` branch (`signin.ts:11`, `signup.ts:11`) is a developer-facing misconfiguration message and may stay. `ServerError.tsx` needs no change.

**There is no existing test coverage to update, and that is the problem.** Verified: zero specs across `tests/e2e/` reference auth error copy — the five files are `landing-smoke`, `risk1-…`, `risk3-…`, `risk8-…`, `seed`. So the enumeration oracle could regress silently. Put the mapping in a small exported helper rather than inline in the two route handlers, and add a unit test asserting that no Supabase error code — `"User already registered"` in particular — yields a message distinguishable from a generic credentials failure. The helper is what makes this testable at all; inline `if` blocks in two API routes are not.

### Success Criteria:

#### Automated Verification:

- Lint and types pass: `npx astro sync && npm run lint`
- `npm test` passes, including the **new** unit test on the auth-error mapping asserting no Supabase code yields a distinguishable "user exists" message
- `npm run test:e2e` passes — in particular every auth spec, since error copy changed. Note it says **nothing** about the CSP: the suite runs `astro dev` (`playwright.config.ts:33`) and Astro's CSP is inert there
- `npm run build` passes
- Against `npm run build && npx astro preview` (**not** the dev server): the served HTML contains a `<meta http-equiv="content-security-policy">` with `sha256-` hashes in `script-src` and `style-src`, and no `'unsafe-inline'`
- Against the same preview server, `curl -sI` shows `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, and a `frame-ancestors` directive

#### Manual Verification:

- **On the `astro preview` build**, every interactive page loads with zero CSP violations in the browser console — landing, signin, dashboard, generate, create, cards, study, account. Checking this on `astro dev` proves nothing; the CSP is not emitted there
- On that same preview build, all React islands still hydrate and respond to interaction (the CSP failure mode is silent non-hydration)
- Signing up with an already-registered address returns the same message as an unknown-credentials signin
- No Supabase error text appears in any URL

**Implementation Note**: Pause for manual confirmation after automated verification passes. This phase's failure mode is silent — islands that fail to hydrate render fine but do nothing — so the manual island check is not optional, and it **must** be done against `astro preview`, since the e2e suite and the dev server cannot see the CSP at all.

---

## Phase 5: Repo Hygiene

### Overview

The gaps that make the repo read as unfinished. All documentation and manifest work, plus the two verifications that cannot be done from inside the repo.

### Changes Required:

#### 1. Add the license text

**File**: `LICENSE` (new)

**Intent**: `README.md:200` declares MIT and there is no license file and no `package.json` license field — a stated license with no license text is the most visible omission in the repo, and it makes the license legally ineffective.

**Contract**: Standard MIT text, correct copyright holder and year. Must match what `README.md` claims.

#### 2. Fix the false setup claim

**File**: `README.md`

**Intent**: `README.md:134` states verbatim: _"No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only."_ This is contradicted by five migrations in `supabase/migrations/` and by `README.md:193,197` in the same file. It reads as an unedited starter paragraph, and a first-time reader following setup gets a broken app.

**Contract**: The line is replaced with an accurate description: the local stack applies the migrations under `supabase/migrations/` via `npx supabase start` / `db reset`, and production schema is pushed by the CI `deploy` job. `context/foundation/lessons.md` already records "Migrations aren't shipped until CI pushes them" — the corrected text must not reintroduce the opposite impression.

#### 3. Fix the two remaining starter-shaped README sections

**File**: `README.md`

**Intent**: `:167` describes `/dashboard` as _"Example protected page"_ when it is the real product hub with five nav tiles (`src/pages/dashboard.astro`). `:79-91` "Project Structure" lists `src/assets/`, which does not exist, and omits `src/lib`, `src/db`, `src/middleware.ts`, `supabase/`, `tests/` and `packages/`.

**Contract**: `/dashboard` is described as the product hub. The structure block reflects the real tree — every listed path exists and every significant directory is listed. Verify each path with `ls` rather than transcribing.

#### 4. Complete the package manifest

**File**: `package.json`

**Intent**: Missing `license`, `repository`, `author`, `private` and `engines`. `private: true` is correct for a non-published app; `engines` makes the `.nvmrc` pin enforceable — `.nvmrc` says `24.17.0` while all four CI `setup-node` steps use a floating `node-version: 24`.

**Contract**: `license: "MIT"` (matching the new `LICENSE`), `repository` pointing at the real remote, `author`, `private: true`, and `engines: { "node": ">=24" }`. `name`, `description` and `version` are unchanged — `version` stays `0.0.1` by decision.

#### 5. Set the GitHub repo About box

**File**: none (GitHub repo settings)

**Intent**: The About description and topics are the first thing a visitor reads, and they currently say nothing about the product.

**Contract**: Description matches `package.json:3` ("AI-generated flashcards with spaced repetition study"); topics name the real stack (astro, supabase, cloudflare-workers, typescript, flashcards, spaced-repetition). No PR titles are edited and visibility is unchanged. This is a manual step with no in-repo artifact — record that it was done.

#### 6. Verify the two facts the repo cannot attest to

**File**: `README.md` or a short `docs/` note (implementer's call — keep it to one place)

**Intent**: Two findings sit outside the repo. First, `SITE_URL` — `ci.yml:50` and `:101` inject `${{ vars.SITE_URL }}` at build time and `astro.config.mjs:13` reads it via `loadEnv`; if the GitHub repo variable is unset, `site` is undefined, the `og:` guard at `src/layouts/Layout.astro:40-47` correctly suppresses the tags, and every shared link unfurls bare in production. Second, production auth policy — `supabase/config.toml` is local-dev only and is never pushed, so `minimum_password_length = 6` (`:175`), empty `password_requirements` (`:178`), `enable_confirmations = false` (`:209`), the disabled captcha (`:198`) and the whole `[auth.rate_limit]` block (`:180-194`) say **nothing** about production. Nothing in this change attests to prod password policy, email confirmation, or auth rate limits.

**Contract**: Confirm `vars.SITE_URL` exists in GitHub repo variables and set it if not. Read the real auth settings from the Supabase dashboard and record them in the repo, with an explicit note that `supabase/config.toml` governs the local stack only and never reaches production. If the dashboard values are weaker than the local config implies (password length, confirmations, rate limits), record that as a finding rather than silently fixing it — changing production auth policy is a separate decision.

### Success Criteria:

#### Automated Verification:

- `LICENSE` exists and `node -e "console.log(require('./package.json').license)"` prints `MIT`
- `package.json` has `license`, `repository`, `author`, `private`, `engines`
- Every path in the README "Project Structure" block resolves: check each with `ls`
- `git grep -n 'No database tables or migrations are required'` returns nothing
- `git grep -n 'Example protected page'` returns nothing
- Lint and format pass: `npm run lint && npx prettier --check README.md LICENSE package.json`
- Full suite passes: `npm test && npm run test:e2e && npm run build`

#### Manual Verification:

- The GitHub repo page shows a product description and stack topics
- `vars.SITE_URL` is confirmed present in GitHub repo variables (or has been set)
- A shared production URL unfurls with the `og.png` card
- Production auth policy is recorded in the repo, with the local-only caveat stated
- A read-through of `README.md` from a cold start describes a working setup path with no starter residue

**Implementation Note**: Pause for manual confirmation. Two of these items require dashboard access outside the repo and cannot be automated.

---

## Testing Strategy

No new test _types_ are needed — the existing Vitest and Playwright suites already cover the surfaces these phases touch. What matters is which existing specs must be re-run and which will need updating.

### Unit / integration tests:

- No new unit tests are required by Phases 1–3. Phase 4's error-message mapping is the one change with genuinely new logic — if the mapping lives in a helper, it deserves a table-driven test asserting that no Supabase error code leaks a distinguishable message for "user exists" vs "bad credentials".
- `scripts/verify-rls.mjs` is the existing RLS regression guard and is unaffected, but should be run after the Phase 3 Supabase project rename since the local stack namespace changes.

### E2E tests:

- **Phase 1** — every auth spec, since cookie flags change. The specific risk is `Secure` on `http://localhost:4321`; Chromium treats localhost as trustworthy so this should pass, but it is the plausible break.
- **Phase 1** — the six protected-page redirect specs, since each page gains its own guard. Behaviour must be identical to the middleware's, so these should pass unchanged; a failure means the redirect target drifted.
- **Phase 3** — the full suite, against the renamed local Supabase project.
- **Phase 4** — every auth spec again, since error copy changes. Any spec asserting on a verbatim Supabase message will need updating. Per `AGENTS.md`, navigate only via `gotoAndWaitForHydration` / `reloadAndWaitForHydration`.

### Manual testing steps:

1. Sign in on a deployed preview; inspect `Set-Cookie` for `HttpOnly` and `Secure`; confirm `document.cookie` shows no `sb-*-auth-token`.
2. Visit each of `/dashboard`, `/generate`, `/create`, `/cards`, `/study`, `/account` signed out — each redirects to `/auth/signin`.
3. After Phase 4, load every page with the console open and confirm zero CSP violations, then interact with each React island — a CSP failure renders fine and silently does nothing.
4. Sign up with an already-registered address and confirm the message is indistinguishable from a bad-credentials signin.
5. `npx wrangler deploy --dry-run` and confirm the file list is from `dist/client` with no `.dev.vars`.
6. Confirm `vars.SITE_URL` in GitHub repo variables, then check a shared production link unfurls with the og card.

## Performance Considerations

Negligible. Phase 1 adds a null check per protected page render. Phase 4 adds a handful of response headers per request — bytes, not compute. Nothing here touches a query path, and the Astro patch bump is within a minor.

The one thing to watch is the Phase 1 `Cache-Control` work: applying no-store headers too broadly would make otherwise-cacheable pages uncacheable at the edge. Scope it to responses that actually set auth cookies.

## Migration Notes

- **No database migration is introduced.** G8, the only finding that would need one, is out of scope.
- **Phase 3's `project_id` rename changes the local Docker project namespace.** Run `npx supabase stop` before and `npx supabase start` after; the local database is recreated, so any local test data is lost. Production is unaffected — `supabase/config.toml` is never pushed; CI pushes `supabase/migrations/**` only.
- **On Colima**, `supabase start` on CLI `2.109.x`+ can fail to start the `vector` sidecar (`AGENTS.md`). If the Phase 3 restart hits this, it is a Colima/Docker-socket incompatibility, not a project bug.
- **Rollback** is per-phase and cheap: every phase is a small, independent commit set with no data migration and no irreversible step. The one exception is the Phase 3 deletions — recoverable from git history, which this plan deliberately leaves intact.

## Open Risks & Assumptions

- **The working branch is based on a stale `master`.** Remote `master` is `6048585`, absent locally; local `master` is `4cb3683`. Continuing on `feat/start-page-redesign` — the chosen delivery path — means the branch predates PR #17's server-side squash merge. `git fetch origin` and rebase onto `origin/master` before the first commit, or the PR reverts that merge. This is the single most likely way this change causes real damage.
- **The branch name is misleading.** `feat/start-page-redesign` names unrelated work that was already archived and closed (`eb12578`), and it carries 2 unpushed `context/`-only commits. The eventual PR title should describe this change, not the branch.
- **G4 is unaddressed and is a direct billing risk.** `src/pages/api/auth/signup.ts` allows unlimited account creation with captcha disabled, and `src/pages/api/flashcards/generate.ts:57` has no per-user quota with `MAX_INPUT_CHARS = 10000`. Sign up N accounts, loop generations, burn the OpenRouter balance. A `SESSION` KV namespace is already bound if this is picked up later.
- **G7 is unaddressed and is a GDPR subprocessor gap.** `src/lib/flashcards/generation.ts:13` pins `"nvidia/nemotron-3-super-120b-a12b:free"` while the comment two lines above states the intent is a paid model with provider training disabled _for a stated GDPR NFR_. Free OpenRouter endpoints default to prompt logging and may route to providers that train on inputs; users paste up to 10k characters of their own notes. This is a compliance gap, not a code bug, and the repo's own comment documents the intended behaviour — which makes the divergence worse, not better, if anyone reads it.
- **The CSP ships enforcing, with no report-only stage available.** Astro's hash-based CSP is a `<meta http-equiv>` element and meta CSP has no report-only variant, so there is no soft-launch: it either works or islands silently stop hydrating. This is why Phase 4's verification must run against `astro preview` and why the manual island check is mandatory. The mitigating factor is that Astro computes the hashes for its own bundles, so the common failure cause — an un-hashed inline script — mostly cannot arise here.
- **Pre-merge detection of production schema divergence is being given up** (Phase 2 change 4). `supabase start` still catches local-apply failures on every PR, but a migration that conflicts with production's actual state will now surface on `master` rather than in the PR. `context/foundation/lessons.md` records that this exact class already bit once. A GitHub Environment with required reviewers would restore it behind an approval gate if the trade turns out wrong.
- **No regression guard.** By decision there is no CI grep gate, so nothing prevents a future `10x-cli get`, a copied skill, or a pasted plan from reintroducing exactly what Phase 3 removes. The `CLAUDE.md` block in particular returns automatically if 10x-cli is ever run here again.
- **Phase 3's cleanliness greps will hit `packages/code-review/evals/corpus/pr-1.diff:66`.** That is expected and correct — the fixture is byte-reproducible and must not be edited. Every grep in this plan excludes it explicitly; a future ad-hoc grep will not.
- **`context/` stays, and it is still the bulk of the provenance surface** — 134 tracked files whose folder shape (`plan.md`, `plan-brief.md`, `frame.md`, `reviews/`) reads as a methodology, plus `context/domain/`'s Module 4 title and 50 lines of Polish, and `context/deployment/`'s "Lesson 5 deliverable" line. This was a deliberate trade for keeping the strongest evidence of engineering rigour. It is the largest known residual.
- **Git history is untouched**, so the 64 `(pN)` phase markers, 19 epilogues, 23 archive closures, 170 AI co-author trailers and the 41%-pure-paperwork commit ratio all remain visible, as do all 17 PR titles.
- **Assumption:** the `og:` tags are absent in production only because `vars.SITE_URL` may be unset, not because of a code defect. `src/layouts/Layout.astro:40-47`'s guard is verified correct; Phase 5 tests the assumption directly.

## References

- Research: `context/changes/certification-readiness/research.md`
- Prior art on product identity and branding: `context/archive/2026-08-22-start-page-redesign/research.md`
- Why the Worker name must not change: `context/archive/2026-08-22-start-page-redesign/reviews/plan-review.md:106`
- Prior authorization-boundary work, relevant to the page-level guards: `context/archive/2026-07-05-testing-authorization-input-boundary-hardening/plan.md`
- The starter bootstrap record: `context/archive/2026-07-02-bootstrap-verification/verification.md:60,64`
- Applicable lessons: `context/foundation/lessons.md` — "Migrations aren't shipped until CI pushes them" (Phase 5 change 2), "UI copy is English-only" (Phase 4's error strings)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Critical Security

#### Automated

- [x] 1.1 `npm ls astro` reports `astro@6.4.8` — 21fa208
- [x] 1.2 `npm audit --json` no longer reports GHSA-vj59-8hwv-xxmv — 21fa208
- [x] 1.3 Lint and types pass: `npx astro sync && npm run lint` — 21fa208
- [x] 1.4 Unit/integration suite passes: `npm test` — 21fa208
- [x] 1.5 E2E suite passes, including the auth-redirect specs: `npm run test:e2e` — 21fa208
- [x] 1.6 Build passes: `npm run build` — 21fa208
- [x] 1.7 `npx wrangler deploy --dry-run` reads from `dist/client` and excludes `.dev.vars` — 21fa208

#### Manual

- [x] 1.8 `Set-Cookie` for `sb-*-auth-token` carries both `HttpOnly` and `Secure` — 21fa208
- [x] 1.9 `document.cookie` shows no `sb-*-auth-token` entry while signed in — 21fa208
- [x] 1.10 Sign-in works end to end; pending-deletion diversion to `/account` still fires — 21fa208
- [x] 1.11 All six protected pages redirect to `/auth/signin` while signed out — 21fa208

### Phase 2: Dependencies and CI Hardening

#### Automated

- [x] 2.1 `npm audit` residual is only build/dev/CLI advisories plus the three Astro-v7 XSS advisories — 593f38c
- [x] 2.2 No new prerelease version string in `package-lock.json` — 593f38c
- [x] 2.3 `actionlint` passes — 593f38c
- [x] 2.4 Full CI passes on the branch: lint, `npm test`, `npm run test:e2e`, `npm run build` — 593f38c
- [x] 2.5 No `pull_request`-triggered job references the production Supabase secrets — 593f38c
- [x] 2.6 `supabase start` still applies all five migrations in the `ci` job — 593f38c

#### Manual

- [x] 2.7 Every third-party `uses:` in `ci.yml` shows a 40-char SHA with a version comment — 593f38c
- [ ] 2.8 A push to `master` still deploys: migrations pushed, then `wrangler deploy`
- [x] 2.9 `README.md:193` and `AGENTS.md`'s CI section both state that prod-divergence detection is now post-merge — 593f38c

### Phase 3: Provenance Surgery

#### Automated

- [x] 3.1 `git grep -iE 'przeprogramowani|10xdevs|10x-astro-starter'` (excluding `context/` and the eval corpus) returns nothing — 7355a65
- [x] 3.2 `node -e "console.log(require('./package-lock.json').name)"` prints `10xcards` — 7355a65
- [x] 3.3 `git grep -inE 'lesson|module [0-9]'` (same exclusions) returns nothing — 7355a65
- [x] 3.4 No tracked file references `context/foundation/.claude/` or `context/foundation/CLAUDE.md` — 7355a65
- [x] 3.5 Lint passes, confirming `includeIgnoreFile()` lint scope is unchanged — 7355a65
- [x] 3.6 `actionlint` passes after the workflow comment edits — 7355a65
- [x] 3.7 Local stack comes up under the new project id: `npx supabase stop && npx supabase start` — 7355a65
- [x] 3.8 `npm test` and `npm run test:e2e` pass against the renamed local stack — 7355a65
- [x] 3.9 `npm run build` passes — 7355a65

#### Manual

- [x] 3.10 `CLAUDE.md` reads as an ordinary agent-instructions file with no course reference — 7355a65
- [x] 3.11 Every E2E rule from the deleted block is present in `AGENTS.md` — 7355a65
- [x] 3.12 GitHub's root file listing shows no course reference in rendered markdown — 7355a65
- [x] 3.13 `context/foundation/README.md` has no dangling reference to the deleted `CLAUDE.md` — 7355a65

### Phase 4: Security Headers and Error Hygiene

#### Automated

- [x] 4.1 Lint and types pass: `npx astro sync && npm run lint` — d1c012c
- [x] 4.2 `npm test` passes, including the new auth-error-mapping unit test — d1c012c
- [x] 4.3 `npm run test:e2e` passes, in particular every auth spec (says nothing about the CSP — dev server) — d1c012c
- [x] 4.4 `npm run build` passes — d1c012c
- [x] 4.5 On `astro preview`, HTML carries a `<meta http-equiv="content-security-policy">` with `sha256-` hashes and no `'unsafe-inline'` — d1c012c
- [x] 4.6 On `astro preview`, `curl -sI` shows `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` — d1c012c

#### Manual

- [x] 4.7 Zero CSP violations in the console across all eight pages, on the `astro preview` build — d1c012c
- [x] 4.8 All React islands still hydrate and respond to interaction on that preview build — d1c012c
- [x] 4.9 Signup with an existing address is indistinguishable from a bad-credentials signin — d1c012c
- [x] 4.10 No Supabase error text appears in any URL — d1c012c

### Phase 5: Repo Hygiene

#### Automated

- [x] 5.1 `LICENSE` exists and `package.json` reports `license: "MIT"`
- [x] 5.2 `package.json` has `license`, `repository`, `author`, `private`, `engines`
- [x] 5.3 Every path in the README "Project Structure" block resolves
- [x] 5.4 `git grep 'No database tables or migrations are required'` returns nothing
- [x] 5.5 `git grep 'Example protected page'` returns nothing
- [x] 5.6 Lint and format pass on the touched files
- [x] 5.7 Full suite passes: `npm test && npm run test:e2e && npm run build`

#### Manual

- [x] 5.8 GitHub repo page shows a product description and stack topics
- [x] 5.9 `vars.SITE_URL` confirmed present in GitHub repo variables (or set)
- [x] 5.10 A shared production URL unfurls with the `og.png` card
- [x] 5.11 Production auth policy recorded in the repo with the local-only caveat stated
- [x] 5.12 Cold read-through of `README.md` describes a working setup path with no starter residue
