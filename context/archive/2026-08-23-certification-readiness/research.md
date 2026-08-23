---
date: 2026-08-23T10:17:21Z
researcher: tswiackiewicz
git_commit: ffdef9d1ec5986ad1906d1a444b3869da15c0d5e
branch: feat/start-page-redesign
repository: 10xcards
topic: "De-course-ification and security readiness: make the repo read as a classic product app"
tags: [research, provenance, security, secrets, dependencies, git-history, ci]
status: complete
last_updated: 2026-08-23
last_updated_by: tswiackiewicz
---

# Research: De-course-ification and security readiness

**Date**: 2026-08-23 12:17 CEST
**Researcher**: tswiackiewicz
**Git Commit**: `ffdef9d1ec5986ad1906d1a444b3869da15c0d5e`
**Branch**: `feat/start-page-redesign`
**Repository**: `github.com/tswiackiewicz/10xcards` (**PUBLIC**, 0 forks, 0 stars, `isFork: false`)

## Research Question

The app in this repo was built during the 10xDevs course as the base for its certification. Some parts were course-supplied scaffolding, hence references to "10x" / "przeprogramowani" (e.g. `github.com/przeprogramowani/10x-astro-starter`). Find every such reference. Also audit security — hardcoded credentials (including in git history) and dependencies with open vulnerabilities. Goal: the repo should read as a typical, classic application, not as course output.

Scope agreed before research: course residue **plus** the AI-toolkit machinery (`context/`, `.claude/`, `packages/`, generated `CLAUDE.md` blocks, AI-review workflows); git history **audited with the rewrite option costed** but not assumed; security **including the application surface**, not just secrets and dependencies.

## Summary

Five findings reframe the task:

1. **The shipped application is already clean.** No user-visible string, image, or meta tag in `src/**` or `public/**` mentions the course, a lesson, a module, or the starter. `10xCards` is the product's own brand (`src/layouts/Layout.astro:14`, `src/components/Logo.astro:27`), `public/og.png` and the favicons are hand-authored, and the starter's `LibBadge.astro` / `template.png` were already deleted in `1c51e90`. **Nothing in the product needs de-branding.**

2. **Visibility is inverted from intuition.** The ~1.1 MB of obvious course machinery — 26 `10x-*` skills, 30 lesson-numbered prompts `m1l5-*`…`m5l4-*`, `m5l4-github-packages-*` templates — is **entirely gitignored** (`.gitignore:43-53`) and has never been tracked. Meanwhile `context/` is fully committed (134 files), and it contains the loudest artifacts: `context/foundation/.claude/.10x-cli-manifest.json` with `"course": "10xdevs3"` / `"lessonId": "m1l2"`, and `context/foundation/CLAUDE.md` — a verbatim "Module 1, Lesson 2" handout. **Trimming `.claude/` buys nothing publicly; the public leak is in `context/` and four root files.**

3. **Only six public artifacts are unmistakably course output, and none has mechanical coupling.** `context/foundation/.claude/` (15 files), `context/foundation/CLAUDE.md`, the `CLAUDE.md` 10x-cli block, `skills-lock.json`, `AGENTS.md:69`, and the "Phase 3" comment in `ai-review-smoke.yml`. Removing all six breaks no build, test, hook, or workflow.

4. **No secret was ever committed.** Verified as a positive result, not an absence of effort: **845 blobs** (791 reachable + 54 unreachable via `git fsck`) — 100% of history — scanned binary-safe against 11 credential patterns, with a positive control proving the regexes fire on the live `.env`. `.gitignore` carried `.env`, `.env.production`, `.dev.vars` from its very first version, so there was never even a gap window. **No rotation is warranted.**

5. **Two real security findings, both one-line fixes**, plus one genuinely urgent dependency bump:
   - **Astro 6.4.7 is the single version affected by GHSA-vj59-8hwv-xxmv** (CVSS 8.2, authorization bypass via path-canonicalization mismatch) — and this app's only page-level auth gate is exactly the `pathname` prefix matcher that advisory targets (`src/middleware.ts:4,19`). Fix: `6.4.7 → 6.4.8`, non-breaking.
   - **Auth cookies ship without `httpOnly` and without `Secure`** (`src/lib/supabase.ts:18-22` forwards `@supabase/ssr` defaults verbatim), so a 400-day refresh token is readable from `document.cookie`.
   - **`wrangler.jsonc:11` declares `"directory": "./dist"`**, and `dist/server/.dev.vars` holds live keys including the service role. Not exposed today (an indirection redirects the asset root to `dist/client`), but one explicit `wrangler deploy -c wrangler.jsonc` publishes it.

The strategic tension worth deciding before planning: **`context/` is simultaneously the biggest provenance surface and the strongest evidence of engineering rigor.** See Open Questions.

## Detailed Findings

### A. Product identity — already coherent

| Surface                  | Value                                                                                    | Verdict                                            |
| ------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `<title>`                | `src/layouts/Layout.astro:14` — `"10xCards — AI flashcards you'll actually remember"`    | coherent                                           |
| Wordmark                 | `src/components/Logo.astro:27`                                                           | coherent                                           |
| Footer / repo link       | `src/components/Landing.astro:142,144` — `© 10xCards`, correct remote URL                | coherent                                           |
| `og:image`               | `public/og.png` — custom 1200×630 branded asset                                          | coherent                                           |
| Favicons                 | `public/favicon.svg`, `favicon.png`, `apple-touch-icon.png` — hand-authored, theme-aware | coherent (not a starter default)                   |
| `README.md:1`            | `# 10xCards` — **zero** course references in the whole file                              | coherent (fixed in `f706268`)                      |
| `package.json:2`         | `"name": "10xcards"`                                                                     | coherent (renamed in `1c51e90`)                    |
| `wrangler.jsonc:3`       | `"name": "10x-cards"`                                                                    | drift — **do not rename**, see below               |
| `supabase/config.toml:5` | `project_id = "10x-astro-starter"`                                                       | **the only literal starter name in a live config** |

Every `10x` hit in `src/**` and `public/**` is the product brand. Pattern counts, shipped-app scope (`src public tests supabase scripts` + root configs + `.github .husky`): `przeprogramowani` 5 hits / 3 files, all developer-visible; `10xdevs` 1; `10x-astro-starter` 1; `lesson` 3 (all `CLAUDE.md`); `kurs`/`certyfikacja`/`certification`/`boilerplate` **0**; Polish diacritics in `src`/`public`/`tests`/`supabase`/`.github` **0**.

Whole-repo counts tell the real story: `10x` 545 hits / 94 files, `10x-astro-starter` 43, `przeprogramowani` 14. The ~512-hit gap between the two scopes is almost entirely `context/**` plus the gitignored trees.

### B. The six public course artifacts (zero coupling)

**B1. `context/foundation/.claude/` — 15 tracked files, 260 KB.** A committed snapshot of course skills, sitting inside `context/` and therefore escaping the root-anchored `.gitignore` rules that hide the real `.claude/`. The manifest is dispositive:

```json
{
  "package": "@przeprogramowani/10x-cli",
  "version": "1.8.0",
  "lessonId": "m1l2",
  "course": "10xdevs3",
  "tool": "claude-code"
}
```

Includes `10x-tech-stack-selector/references/starter-registry.yaml:86,92` with `git clone https://github.com/przeprogramowani/10x-astro-starter`, and — ironically — `10x-prd/SKILL.md:437`, the course skill's own instruction that output must carry _"No 10xDevs / cohort / certification references"_. Touched by exactly **1 commit** in 10 weeks. Nothing reads it. `git rm -r` is the single highest-leverage deletion in the repo (~110 of the `10x` hits).

**B2. `context/foundation/CLAUDE.md` — 7.1 KB.** A second, older committed lesson block: `## 10xDevs AI Toolkit — Module 1, Lesson 2` (`:3`), _"Pick a starter and a stack for the PRD you wrote in Lesson 1"_ (`:5`), and at `:72` the self-defeating sentence claiming the shipped skill carries no cohort references. Nothing reads it.

**B3. `CLAUDE.md:5-35` — the generated block.** `<!-- BEGIN @przeprogramowani/10x-cli -->` at `:5`, `## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)` at `:7`, "Lesson 5" cross-references at `:30,33`. This is **the loudest front-page signal** — GitHub renders `CLAUDE.md` in the root file listing and line 7 says "10xDevs AI Toolkit" in plain text.

- `@przeprogramowani/10x-cli` is **not a dependency**: 0 hits in `package.json`, 0 in `package-lock.json`. It is a globally-installed CLI.
- Nothing mechanical breaks on deletion — no script, hook, workflow, or build step reads it.
- But deletion is **non-durable**: the CLI keys off the marker comments and the next `10x-cli get` re-appends it. Removing it permanently means stopping 10x-cli use in this repo.
- The rules inside (locators, no `waitForTimeout`, test independence) are load-bearing for `tests/e2e/**` and **already duplicated in `AGENTS.md:27`**, so no guidance is lost.
- `CLAUDE.md:1` is also stale: it says the hand-maintained guidance lives "outside the 10x-cli block **above**", but the block is below it.

**B4. `skills-lock.json` — 527 B, tracked, root.** `"source": "przeprogramowani/10x-cli"` at `:5,11`, locking two skills that live only in the gitignored `.agents/skills/`. A public lockfile for content no visitor can see. Zero coupling. Note the inconsistency: the sibling `packages/code-review/skills-lock.json` **is** gitignored.

**B5. `AGENTS.md:69`.** Under `## Don't touch`: names the `@przeprogramowani/10x-cli` markers. Trivially removable once B3 is gone. Everything else in `AGENTS.md` is a strong, ordinary agent-onboarding doc.

**B6. `.github/workflows/ai-review-smoke.yml`.** Comment: _"Kept in the repo after **Phase 3**: it is the cheapest way to reproduce the `error` path on demand."_ "Phase 3" is plan-phase vocabulary from `context/changes/*/plan.md` — the only workflow leaking the methodology. No workflow leaks the course by name.

### C. Course machinery — classification

Class **A** = defensible infrastructure any serious repo might carry; **B** = unmistakably course artifact; **C** = defensible but currently framed as course output.

| Artifact                                                                                                       | Class | Public?            | Coupling                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ----- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context/archive/` — 23 change folders, 104 files, 1.4 MB                                                      | **A** | yes                | `roadmap.md` links every folder; plans cross-reference; immutable by convention (`AGENTS.md:69`)                                                                                                                                       |
| `context/foundation/{prd,roadmap,test-plan,infrastructure,shape-notes,tech-stack,lessons,idea-notes}.md`       | **A** | yes                | `lessons.md` header names 6 skills; `test-plan.md:143` says "configured in Lesson 3"                                                                                                                                                   |
| `context/foundation/.claude/` (15)                                                                             | **B** | yes                | **none**                                                                                                                                                                                                                               |
| `context/foundation/CLAUDE.md`                                                                                 | **B** | yes                | **none**                                                                                                                                                                                                                               |
| `context/domain/` — 5 files, 124 KB (DDD artifacts)                                                            | **C** | yes                | `architect-report.md:2` — `title: "10xArchitect — Module 4 Summary Report"`, _"spanning two different repositories"_, `BRAK artefaktu`; `04-event-storming.md` is **50 lines of Polish** and references a `board.json` not in the repo |
| `context/deployment/deploy-plan.md:3`                                                                          | **C** | yes                | _"Lesson 5 deliverable & audit trail"_ + a **dangling ref** to a path that moved to `archive/`                                                                                                                                         |
| `context/{archive,changes,foundation}/README.md`                                                               | **C** | yes                | describe the `/10x-*` slash-command workflow                                                                                                                                                                                           |
| `context/archive/…/uncommitted-fixture-edit.patch`                                                             | B     | yes                | none — a committed raw `git diff`, reads as scratch output                                                                                                                                                                             |
| `packages/code-review` — 58 files, 9 tests, eval suite                                                         | **C** | yes                | **highest in repo**: `ci.yml:66-78` job, `.github/actions/ai-code-review/action.yml:59,63,71`, `README.md`, `AGENTS.md`. **Not imported by `src/`**                                                                                    |
| `.claude/skills/10x-*` (26), `.claude/prompts/` (30, `m1l5-*`…`m5l4-*`), `.claude/config-templates/m5l4-*` (5) | **B** | **no**             | local only — already invisible                                                                                                                                                                                                         |
| `.claude/skills/verify`                                                                                        | **A** | no                 | cited by `AGENTS.md:13`; genuinely useful                                                                                                                                                                                              |
| `.claude/skills/{setup-cicd,tf-registry,pack-init}`                                                            | **B** | no                 | generically named but their descriptions say _"Model 2 AWS CodeArtifact"_ — m5l4 output, unrelated to this app                                                                                                                         |
| `.claude/settings.json`                                                                                        | **A** | no                 | drives the format hook + a `git push` gate on `npx astro check`. The one hidden thing arguably worth exposing                                                                                                                          |
| `.github/workflows/{ci,purge}.yml`                                                                             | **A** | yes                | core CI/CD + GDPR purge cron                                                                                                                                                                                                           |
| `.github/workflows/ai-code-review.yml` + composite action                                                      | **C** | yes                | drives `packages/code-review`; documented in `README.md` as ordinary CI                                                                                                                                                                |
| `context/changes/certification-readiness/`, `context/team/`                                                    | **B** | **no** (untracked) | none — **do not commit**                                                                                                                                                                                                               |
| `stryker.conf.json`                                                                                            | dead  | yes                | no `stryker` script in `package.json` — orphaned config, unrelated to the course                                                                                                                                                       |

**Absent, which is good news:** no `.cursor/`, no `.mcp.json`, no `copilot-instructions.md`, no lesson-numbered root files, no stray screenshots. Root markdown is exactly `AGENTS.md`, `CLAUDE.md`, `README.md`.

Two internal-naming patterns read as exercise-shaped without being course-branded: `tests/{unit,integration,e2e}/risk1-…risk10-…` (17 files keyed to `test-plan.md`) and migration headers using slice IDs `F-01`/`S-04`/`S-05` plus `-- Risk #10 test-plan refresh` (`supabase/migrations/20260709190500_…:1`). Neither is referenced by any config — `playwright.config.ts` matches `testDir`, `vitest.config.ts` matches `tests/**/*.test.ts` — so renaming is mechanically free but costs traceability.

### D. Git history

**Shape.** 226 commits reachable from `HEAD` (217 on local `master`, 9 on the current branch); 228 across all refs (the extra 2 are a stash pair). Span 2026-06-16 → 2026-08-23, ~10 weeks. No tags. 2316 loose objects, never `gc`'d.

**Origin — not a fork; the starter was copied in.** `isFork: false`, no parent, no upstream remote, no merge from upstream.

- `3ebf120` (2026-06-16) — 2 files: `CLAUDE.md`, `CLAUDE.md.scaffold`
- `1da1b99` — **"Initail file structure - module 1 lesson 4"**, 66 files / 19,968 insertions: the whole starter in one commit, with `README.md` beginning `# 10x Astro Starter`, `package.json` name `10x-astro-starter`, `skills-lock.json`, and `context/foundation/.claude/skills/10x-*/`.
- The starter identity survived in-tree for **two months**: README rewritten `f706268` (2026-07-10, _"lead with the 10xCards product, not the starter"_), `package.json` renamed `1c51e90` (2026-08-22).
- `context/archive/2026-07-02-bootstrap-verification/verification.md:60,64` is the definitive in-repo record: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold`.

**Authors — only the user.** 213 commits `tswiackiewicz <tommy.swiacek@gmail.com>`, 15 `Tomasz Świacko-Świackiewicz <…@users.noreply.github.com>` (the PR merges). No third-party author, **no corporate email in history**.

**Fingerprints in commit metadata.** Keyword hits are the _minor_ signal: `10x` 43, `lesson` 22, `przeprogramowani` 2, `starter` 4, `10xDevs`/`kurs`/`certification` **0**. The loud signal is workflow vocabulary: `(pN)` phase markers **64** commits, `close out plan (epilogue)` **19**, `chore(archive): close <change-id>` **23**, impl-review **12**. Telling examples: `1da1b99` "Initail file structure - module 1 lesson 4", `9a7a0be` "chore(10x-cli): sync generated block to Module 2 Lesson 2", `188989c` "docs(claude-md): regenerate 10x-cli Lesson 4 (E2E Tests) content", `2792ea4` "docs(domain): add DDD analysis and Module 4 architect report".

**`Co-authored-by` an AI: 170 of 226 commits (75%)** — 166 `Claude <noreply@anthropic.com>`, 3 `Claude Opus 4.8 (1M context)`. This is a _different_ disclosure than course origin: it reads as AI-assisted development. The 3 model-named trailers are tooling exhaust.

**Process-paperwork ratio.** Of 211 commits that touch files: 164 touch `context/**`, and **87 (41%) touch nothing else**. Two commits in five are pure paperwork (`epilogue`, `chore(archive): close X`, `record implementation review`). This texture — not the `10x` keyword — is what makes the log read as a methodology exercise.

**Rewrite feasibility.**

- **Squash to one commit:** blast radius 226/226. Technically low-risk — 0 forks, 0 stars, 0 open PRs, no tags, and **no hardcoded SHAs anywhere** (`git grep -oE '\b[0-9a-f]{7}\b' -- '*.md'` → zero). But it destroys the 17-PR reviewed trail, the phase decomposition, and blame archaeology. A single "initial commit" containing a full Astro+Supabase+Playwright app arguably reads _worse_ than an honest log.
- **Targeted `filter-repo` dropping `context/**`:** the 87 pure-`context`commits become empty and are pruned, the other 77 are rewritten, and everything after commit #2 gets a new SHA anyway → effective blast radius **225/226**, ending at ~139 commits. It also does **not** remove the`(pN)`/`epilogue` subject lines on product commits. Rewriting messages is the same 225-commit radius and is the only variant that actually removes the §D signals.
- **Root `.claude/**` needs no filtering\*\* — never tracked, 0 commits.

**What a rewrite cannot undo.** The repo has been public ~10 weeks. All **17 PRs remain** — GitHub retains PR commits and diffs under `refs/pull/N/head` after any force-push, and PR titles alone carry the change-id vocabulary. Orphaned commits stay reachable by SHA. Search-engine and code-search indexes are out of reach. The one lucky fact: **0 forks**, so nothing is pinned in a fork network. A rewrite changes what a _new_ `git clone` shows, and nothing else.

**Operational warning for any plan touching history or `master`:** `git ls-remote` shows the real remote `master` is **`6048585`**, an object not present locally — PR #17 was squash-merged server-side after the last fetch. Local `master` (`4cb3683`) is behind. Fetch before any force-push, or PR #17's merge gets clobbered. The current branch has 2 unpushed commits (`ffdef9d`, `eb12578`), both `context/`-only.

### E. Secrets — clean, in tree and in history

**No secret has ever been committed.** Coverage: **845 blobs = 100% of history** (791 reachable across all refs + 54 unreachable from `git fsck`, catching anything orphaned by amend/rebase), each scanned in full, binary-safe (`grep -a`). Patterns: JWT (`eyJ…`), `sk-or-v1-`, `sk-…{40,}`, `sk-ant-`, `sbp_`, `sb_secret_`, `ghp_`, `gho_`, `github_pat_`, `AKIA[0-9A-Z]{16}`, `-----BEGIN … PRIVATE KEY`. **All zero hits.** Positive control: the same patterns matched the live key in `.env` and the JWT in `.claude/settings.local.json`, so the zero is trustworthy.

Pickaxe hits, each adjudicated: `eyJ` in `1da1b99` is a `sha512-` integrity hash in `package-lock.json`, not a JWT; `sk-or-v1-` hits are `sk-or-v1-xxxxxxxx` placeholders; `sb_publishable_` hits are truncated prose; `service_role` hits are SQL `GRANT`s. `sbp_`, `ghp_`, `AKIA`, `-----BEGIN`, `sb_secret_` — zero.

**No env file was ever tracked.** `git log --all --diff-filter=A` over `.env*`, `*.dev.vars`, `*credentials*`, `*secret*`, `*.pem`, `*.key`, `id_rsa*` returns exactly two additions, both templates: `.dev.vars.example` (`621521f`) and `.env.example` (`8472058`). **And there was no gap window** — the first version of `.gitignore` already carried `.env`, `.env.production`, `.dev.vars`, `.wrangler/`.

Live secrets exist on disk and every one is correctly ignored and untracked: `.env` (live 73-char `OPENROUTER_API_KEY`; `SUPABASE_SERVICE_ROLE_KEY=###` is still a placeholder, so the real key is not on disk), `.dev.vars` (live 64-hex `CRON_PURGE_SECRET`), `packages/code-review/.env`, `dist/server/.dev.vars` (build copy — `npm run clean` removes it). `.claude/settings.local.json:18` holds a service-role JWT whose payload decodes to `{"iss":"supabase-demo","role":"service_role"}` — the **universally published Supabase local-dev demo key**, identical for every developer, zero value to an attacker.

Tracked tree is clean: `supabase/config.toml` uses `env(...)` indirection throughout, `supabase/seed.sql` is 0 bytes, `wrangler.jsonc` has no `vars`, all five workflows reference secrets only via `${{ secrets.* }}` (and `ci.yml:112-119` even redacts the Postgres URL out of dry-run output). `ai-review-smoke.yml:48` passes `sk-or-deliberately-invalid` — a deliberate error-path fixture.

**Test credentials are hardcoded but structurally cannot reach production.** `tests/helpers/auth.ts:39` and `scripts/verify-rls.mjs:48-50` use `Password123!`; `tests/setup/env.ts:26-42` sources `SUPABASE_URL` and the service-role key _exclusively_ from `execSync("npx supabase status -o env")` and **throws** if the local stack is down — it deliberately does not read `.dev.vars` (documented at `:51-53`). `playwright.config.ts:5` pins `baseURL` to `http://localhost:4321`. Emails are `test-${Date.now()}-${rand}@example.com` with teardown.

**No rotation is warranted.**

### F. Dependencies

Root `npm audit`: **20 advisories (13 high, 6 moderate, 1 low)** over 1090 deps. Every one reports `fixAvailable: true`, none `isSemVerMajor`. `packages/code-review`: **0 vulnerabilities**.

**F1 — the one that matters. Astro 6.4.7 → GHSA-vj59-8hwv-xxmv, CVSS 8.2, CWE-647:** "Authorization Bypass via Decode Iteration Limit and Rewrite Path Canonicalization Mismatch". Affected range `>=6.4.7 <6.4.8` — **the installed version is the only 6.x release affected** (verified: `npm ls astro` → `astro@6.4.7`; `package.json:36` is `^6.3.1`).

Why it lands here specifically: the app's only page-level auth gate is a decoded-`pathname` string match, exactly the surface the advisory describes.

```
src/middleware.ts:4   const PROTECTED_ROUTES = ["/dashboard", "/generate", "/create", "/cards", "/study", "/account"];
src/middleware.ts:19  ... pathname === route || pathname.startsWith(`${route}/`)
```

None of the six protected pages re-checks the session — `src/pages/dashboard.astro:4` just reads `Astro.locals.user`. **Exploitability: real but bounded.** Every API route verifies independently (`supabase.auth.getUser()` in `index.ts:23`, `[id].ts:26,72`, `review.ts:31`, `generate.ts:34`, `manual.ts:23`, `study/next.ts:26`) behind RLS, so a bypass leaks the _page shell_, not user data. Fix: `npm audit fix` → `6.4.8`, satisfies `^6.3.1`, non-breaking.

**F2 — three Astro XSS advisories requiring the v7 major** (GHSA-f48w-9m4c-m7f5, GHSA-4g3v-8h47-v7g6, GHSA-7pw4-f3q4-r2p2; fixed in 7.0.6/7.0.10/7.0.4). **None of the three attack surfaces exists here**: no `{...}` spread attributes in any `.astro` file (0 hits), no `transition:*` directives (0), no `ClientRouter`/`ViewTransitions` import (0). These will survive `npm audit fix` and are the _expected_ residual — do not chase them with `--force`. Astro 7 is routine maintenance, not a security fix.

**F3 — the other 17 are build/dev/CLI only.** The deployed Worker is fully self-contained: `dist/server` is 2.3 MB with **zero external `import`/`require`**, so Astro is the only advisory reaching the runtime. The rest: `wrangler` 4.101.0→4.125.0, `undici` (12 advisories, miniflare/local dev), `ws`, `sharp` (build-time image service, unused on Workers), `js-yaml`, `brace-expansion`, `fast-uri`, `nanoid`, `postcss`, `svgo`, `esbuild` (low, **Windows-only** path read — N/A on macOS/Linux CI), plus editor tooling.

**Caveat before running the fix:** the dry run pulls `miniflare 4.20260616.0 → 5.20260801.0-alpha` — a **prerelease** into the tree. Prefer `npm audit fix` then re-audit; if the alpha is unwelcome, bump `wrangler` alone (`npm i -D wrangler@4.125.0`), which resolves the wrangler/miniflare/undici/ws cluster on stable releases.

**Supply chain is clean.** All 1090 deps resolve to `registry.npmjs.org` (zero git-URL, tarball, or alternate-registry entries). No deprecated packages in the installed tree. One prerelease pin: `eslint-plugin-react-compiler: ^19.1.0-rc.2` (devDependency, lint-only). One override: `vite: ^7.3.2` — pins _forward_, so it masks nothing. Nothing is on an EOL major. `.nvmrc` is `24.17.0` while all four CI setups use floating `node-version: 24`, and the root `package.json` has **no `engines` field** — adding `"engines": { "node": ">=24" }` makes the `.nvmrc` contract enforceable.

### G. Application security surface

**G1 — HIGH: auth cookies without `httpOnly`, without `Secure`.** `src/lib/supabase.ts:18-22` forwards `@supabase/ssr`'s options verbatim into `AstroCookies.set` (verified in the file). Those defaults (`@supabase/ssr` 0.10.3) are `{ path: "/", sameSite: "lax", httpOnly: false, maxAge: 400*24*60*60 }` — **no `secure` key at all**. Astro's `serializeOptions` adds nothing. Net production `Set-Cookie` for `sb-<ref>-auth-token[.N]`, which carries both the access **and** refresh token: no `HttpOnly`, no `Secure`, 400-day lifetime.

Any XSS anywhere — including in a dependency of a `client:load` island — reads `document.cookie` and takes the refresh token: full account takeover that survives a password change, because the attacker rotates the token first. No `Secure` + no HSTS means one `http://` navigation puts it on the wire in cleartext.

Cheap to fix _here specifically_: the app **never** instantiates a browser-side Supabase client (`createBrowserClient` → 0 hits; every island talks to `/api/*`), so nothing in the browser needs to read that cookie. Fix at `src/lib/supabase.ts:10` — add `cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" }`. Keep `sameSite: "lax"`; it is load-bearing for CSRF.

**G2 — MEDIUM: `wrangler.jsonc:11` asset root would publish the service-role key.** Verified in the file: `"assets": { "binding": "ASSETS", "directory": "./dist", … }`. `./dist` contains `dist/server/`, and a local build writes a real `dist/server/.dev.vars` (309 B: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `CRON_PURGE_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`). There is no `dist/.assetsignore` — Wrangler reads `.assetsignore` only from the assets-directory root, and does not skip dotfiles.

**Not exposed today**, confirmed three ways: `.wrangler/deploy/config.json` redirects to `dist/server/wrangler.json`, which sets `"assets": { "directory": "../client" }`; a dry run reported `Read 31 files from … /dist/client`; and built HTML references `/_astro/…` rather than `/client/_astro/…`. `dist/client/.assetsignore` also lists `.dev.vars`.

It goes live if the indirection is bypassed — an explicit `wrangler deploy -c wrangler.jsonc`, or a deploy after `.wrangler/` is cleaned but `dist/` is not (`npm run clean` deletes `dist` only; `clean:all` is the only script touching `.wrangler`). `AGENTS.md:14` and `README.md:184` advertise `npx wrangler deploy` as a supported manual path, so a human _will_ run this by hand. Fix: `"directory": "./dist/client"` — one line, removes the class.

**G3 — MEDIUM: no security headers.** No CSP meta in `src/layouts/Layout.astro`, and `headers.set|Content-Security-Policy|Strict-Transport|X-Frame` → 0 hits in `src/`/`public/`. Missing CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors. Combined with G1, the absent CSP is what turns any injected script into a permanent takeover. **Mechanical detail for the fix:** `_headers` applies only to responses from Cloudflare's asset worker, and every HTML page here is SSR — so headers must be set around `next()` in `src/middleware.ts`. Astro island hydration emits inline `<script type="module">` and inline JSON props, so a first CSP needs `'unsafe-inline'` for `script-src` or Astro's `experimental.csp` hashes; start report-only.

**G4 — MEDIUM: no rate limiting on auth or on the paid AI endpoint.** `src/pages/api/auth/signin.ts:13` — unlimited password attempts; `signup.ts:13` — unlimited account creation, `[auth.captcha]` commented out (`supabase/config.toml:198-201`), no Turnstile; `src/pages/api/flashcards/generate.ts:57` — no per-user quota, `MAX_INPUT_CHARS = 10000`. Chain: sign up N accounts → loop 10k-char generations → burn the OpenRouter balance. `src/lib/flashcards/generation.ts:6-9` says prod is meant to run a **paid** model, which makes this a direct billing loss. `wrangler.jsonc` declares no `ratelimits` binding, but a `SESSION` KV namespace is already bound.

**G5 — MEDIUM: `ci.yml`/`purge.yml` have no `permissions:` block, third-party actions float on tags.** `ai-code-review.yml`, `ai-review-labels.yml`, `ai-review-smoke.yml` all declare least-privilege permissions correctly; `ci.yml` and `purge.yml` do not, so their `GITHUB_TOKEN` falls back to the repo/org default. `ci.yml` runs `raven-actions/actionlint@v2` (:26), `supabase/setup-cli@v2` (:30,:103), `cloudflare/wrangler-action@v4` (:120) — all mutable tags on third-party repos, on every PR. A tag repoint gets whatever the default token grants; push to `master` then reaches `deploy` with `CLOUDFLARE_API_TOKEN` and the Supabase prod secrets.

**G6 — MEDIUM: production Supabase credentials are exposed to every PR run.** `ci.yml:52-59` links the **production** project and runs `supabase db push --dry-run` on every PR, with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` in the step env — in the same job that already ran `npm ci`, tests, build, and e2e from the PR branch. For same-repo `pull_request`, the workflow definition comes from the PR, so anyone with push access can edit `ci.yml` in a PR and print the prod DB password. Fork PRs get no secrets. The secrets _are_ step-scoped, which correctly stops a malicious `postinstall`. Fix: move the prod dry-run to a `push`-only job or behind an Environment with required reviewers; `supabase db reset` against the local stack the job already starts catches the same breakage class.

**G7 — MEDIUM: the AI path ships user text to a `:free` model.** `src/lib/flashcards/generation.ts:13` — `"nvidia/nemotron-3-super-120b-a12b:free"`, while the comment two lines above states the intent is _"a cheap PAID quality model with provider training disabled (GDPR NFR)"_. Free OpenRouter endpoints default to prompt logging and may route to providers that train on inputs. Users paste up to 10k chars of notes — a GDPR subprocessor issue, not a code bug. Fix: pin the paid model and set provider `data_collection: "deny"`.

**G8 — LOW: a deletion-status oracle.** `supabase/migrations/20260702145938_create_account_deletions.sql:61-71` — `public.is_pending_deletion(uuid)` is `SECURITY DEFINER` with `EXECUTE` granted to `authenticated`, and `supabase/config.toml:13` exposes `public` through PostgREST. Any authenticated JWT + anon key answers whether an arbitrary user id requested deletion — data that user's own RLS policy (`:36-40`) keeps private. Held to LOW because the anon key never reaches a browser here and the attacker needs a target UUID. Its `search_path` hardening is correct (`set search_path = ''`, schema-qualified body). Fix: move to a `private` schema and repoint the four flashcards policies.

**G9 — LOW: raw auth errors reflected into the URL; signup enumeration.** `src/pages/api/auth/signin.ts:16` and `signup.ts:17` put Supabase's verbatim `error.message` into a query string, rendered by `src/components/auth/ServerError.tsx:13`. With confirmations off, signing up with an existing address returns `"User already registered"` — an account-existence oracle. Auth detail also lands in Referer headers, history, and Cloudflare logs. **No XSS** (React escapes it, no `dangerouslySetInnerHTML` anywhere) and **no open redirect** (hardcoded target). Fix: map codes to fixed generic strings, matching the enum discipline the flashcards endpoints already use.

**G10 — LOW: `public.set_updated_at()` has no pinned `search_path`** (`20260624185919_create_flashcards.sql:25-33`). `SECURITY INVOKER`, body only calls `now()`; an attacker would need `CREATE` on an earlier schema, which `authenticated` lacks. Noted for rule completeness only.

**G11 — INFORMATIONAL: production auth policy is not in the repo.** `supabase/config.toml` is local-dev only; CI pushes `supabase/migrations/**`, never the config. So `minimum_password_length = 6` (:175), empty `password_requirements` (:178), `enable_confirmations = false` (:209), disabled captcha (:198), the whole `[auth.rate_limit]` block (:180-194), `jwt_expiry = 3600` (:158) say **nothing** about production. Stated plainly: nothing in this review attests to prod password policy, email confirmation, or auth rate limits — those live in the dashboard as invisible drift.

**What is clean, with evidence** — so it is not re-audited:

- **Route guard coverage is complete.** Every one of the 6 protected pages and all 15 API routes was enumerated; no route is unguarded. API routes are deliberately absent from `PROTECTED_ROUTES` (a redirect is wrong for an XHR) and each re-verifies the session itself. Bypasses ruled out: trailing slash (`trailingSlash: "ignore"` → `startsWith("/dashboard/")` covers it), case (route regexes carry no `i` flag, `/Dashboard` 404s), query string (guard matches `pathname`). Even a bypass leaks nothing from the DB: `anon` has **no** `GRANT` on either table. Fail-closed on misconfiguration — `createClient` returns `null` without env vars, so protected routes redirect and APIs 401.
- **Validation and authorization.** Every body-taking endpoint validates with zod _before_ Supabase (`index.ts:35`, `manual.ts:35`, `generate.ts:50`, `[id].ts:31,43`, `review.ts:36,47`); path params are `z.uuid()`; length caps mirror the DB CHECK constraints. **No endpoint trusts a client-supplied identity** — `user_id` on insert always comes from the verified session. Updates/deletes let RLS pin the row and map 0 rows to `404`, not a silent 200. Method gating is sound (one verb per file, `404` for others, no `ALL` export). **Zero error-detail leakage** — every failure returns a fixed enum; `generate.ts:58-63` swallows the OpenRouter status into a flat `502`.
- **RLS is properly built.** Both tables have RLS enabled with **no** `using (true)` anywhere. Every `flashcards` policy is `to authenticated` with `auth.uid() = user_id and not is_pending_deletion(auth.uid())` on **both** `using` and `with check` — the `with check` on UPDATE is present, the clause people forget, without which a user could reassign `user_id`. `account_deletions` has no UPDATE policy _and_ no UPDATE grant, so `requested_at` cannot be pushed forward to extend the retention window.
- **CSRF is closed on all three shapes.** `astro.config.mjs:21` sets `security: { checkOrigin: true }`. Cross-site form POST → 403 (and `sameSite: "lax"` withholds the cookie independently); cross-site JSON fetch → preflight, no CORS headers anywhere → blocked by the browser; no-`Content-Type` fetch → 403. This matters most for `POST /api/account/delete`, which reads no body at all.
- **No secret reaches the client.** All five vars are `context: "server", access: "secret"` in `astro.config.mjs:34-38` — **compiler-enforced**, not convention. `import.meta.env|process.env|PUBLIC_` in `src/` → exactly one hit, `import.meta.env.DEV`. No `PUBLIC_` var exists. Island props are all the user's own data. `SUPABASE_KEY` is the **anon** key; the service-role key is confined to `src/lib/supabase-admin.ts`, used only by the cron purge. Stronger than the typical Supabase app: since clients only call `/api/*`, the anon key never reaches a browser at all.
- **Per-request clients.** `createClient(...)` is called fresh in `middleware.ts:7` and again per route; no module-level client anywhere, so no session bleeds between requests sharing a Workers isolate — the classic Workers footgun, avoided. Admin client is `{ autoRefreshToken: false, persistSession: false }`. Sign-out defaults to `scope: 'global'`, revoking refresh tokens on all devices, with `maxAge: 0` removals for every cookie chunk.
- **`ai-code-review.yml` is genuinely well built.** `pull_request`, not `pull_request_target`; explicit least-privilege permissions; fork + Dependabot guards; **PR title and body written to files and passed by path**, never through `${{ }}` — the correct defence against script injection via a PR title, and the most commonly botched thing in review bots; the API key goes through `env:`, never a `run:` body; `empty`/`error` actively _remove_ both labels so a green label can never certify an unreviewed diff; concurrency keyed on PR number; 10-minute timeout.
- **No XSS sinks** (`dangerouslySetInnerHTML|set:html|innerHTML` → 0 hits), **no open redirects** (every `context.redirect()` takes a hardcoded path; no `next`/`returnUrl` read anywhere), **prompt injection genuinely low** (separate system message, `json_schema` with `strict: true`, every card re-validated with zod server-side, no tool calls, no cross-user data path).
- **Cron purge auth and account deletion are the most careful code in the repo.** Constant-time bearer compare with a length pre-check, failing closed when the secret is unset. `admin.auth.admin.deleteUser` cascades both FKs, so flashcards and the tracking row are physically erased; the failure path re-inserts the tracking row so a failed delete cannot silently unblock RLS and lose the retry; a non-zero error count returns 500 so `curl -fsS` fails the Action rather than masking a GDPR miss.

### H. Gaps that read as unfinished for a normal repo

| Gap                                                                                                                                                                                                                                         | Evidence                                                                                                    | Severity                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **No `LICENSE` file** while `README.md:199-201` declares MIT, and `package.json` has **no `license` field** (both verified)                                                                                                                 | root markdown is only `AGENTS.md`, `CLAUDE.md`, `README.md`                                                 | **High** — a stated license with no license text is the most visible omission |
| **`README.md:134` is factually wrong** — verified verbatim: _"No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only."_ Contradicted by 5 migrations and by `README.md:193,197` | reads as an unedited starter paragraph; a first-time reader following setup gets a broken app               | **High**                                                                      |
| `package.json` missing `repository`, `author`, `license`, `private`, `engines` (`description` and `name` are present and good)                                                                                                              | `private: true` is right for a non-published app; `engines` would encode the `.nvmrc` pin                   | Medium                                                                        |
| No issue/PR templates                                                                                                                                                                                                                       | `.github/` has only workflows + the composite action — notable in a repo that runs an AI PR-review pipeline | Medium                                                                        |
| `README.md:167` starter phrasing — `/dashboard` described as _"Example protected page"_ when it is the real product hub                                                                                                                     | `src/pages/dashboard.astro` has 5 nav tiles                                                                 | Medium                                                                        |
| `og:` tags render only when `SITE_URL` is set (`src/layouts/Layout.astro:39-47`)                                                                                                                                                            | the guard is deliberate and correct; the **env var** must exist in Cloudflare or links unfurl bare          | Medium — verify prod                                                          |
| No `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`                                                                                                                                                                   | —                                                                                                           | Low–Medium                                                                    |
| `README.md:79-91` "Project Structure" lists `src/assets/` (nonexistent), omits `src/lib`, `src/db`, `src/middleware.ts`, `supabase/`, `tests/`, `packages/`                                                                                 | —                                                                                                           | Low                                                                           |
| `version: "0.0.1"` with 226 commits and a live deploy                                                                                                                                                                                       | —                                                                                                           | Low                                                                           |

`.env.example` / `.dev.vars.example` / `README.md` setup are **clean** — no `10x auth`, no `10x get mXlY`, no enrollment step, no course keys. The only setup-adjacent coupling is that `CLAUDE.md`'s block tells an agent to use `/10x-e2e`, a skill that is gitignored and therefore absent from a fresh clone.

## Code References

- `src/lib/supabase.ts:10,18-22` — `createServerClient` with no `cookieOptions`; forwards `httpOnly: false`, no `secure` (G1)
- `src/middleware.ts:4,19` — `PROTECTED_ROUTES` decoded-`pathname` matcher; the surface GHSA-vj59-8hwv-xxmv targets (F1)
- `wrangler.jsonc:3,11` — Worker name `10x-cards` (do not rename); assets `"./dist"` (G2)
- `supabase/config.toml:5` — `project_id = "10x-astro-starter"`, the only starter literal in a live config
- `CLAUDE.md:5-35` — the `@przeprogramowani/10x-cli` block; line 7 names the course on the repo front page
- `context/foundation/.claude/.10x-cli-manifest.json:2-8` — `"course": "10xdevs3"`, `"lessonId": "m1l2"`
- `context/foundation/CLAUDE.md:3,5,72` — verbatim "Module 1, Lesson 2" handout
- `skills-lock.json:5,11` — `"source": "przeprogramowani/10x-cli"`
- `AGENTS.md:69` — names the 10x-cli markers under `## Don't touch`
- `.gitignore:43-53` — the rules hiding `.claude/`; `:49` is the only Polish comment in the tracked non-`context` tree
- `.github/workflows/ai-review-smoke.yml` — "Kept in the repo after Phase 3" (methodology leak)
- `.github/actions/ai-code-review/action.yml:4-6` — comment explaining the directory must not start with `10x-` (real constraint, reword rather than delete)
- `ci.yml:52-59` — prod Supabase secrets in the PR-triggered job (G6); `:26,:30,:103,:120` — floating third-party action tags (G5)
- `src/lib/flashcards/generation.ts:6-9,13` — the paid-model intent vs the `:free` model actually pinned (G7)
- `supabase/migrations/20260702145938_create_account_deletions.sql:61-71` — `is_pending_deletion` as a PostgREST RPC (G8)
- `context/archive/2026-07-02-bootstrap-verification/verification.md:60,64` — the in-repo record of the starter clone
- `packages/code-review/evals/corpus/pr-1.diff:66` — frozen starter README tagline inside a byte-reproducible eval fixture (**do not edit**)
- `README.md:134,167` — the false "no migrations required" claim and the "Example protected page" phrasing

## Architecture Insights

- **The product/process split is unusually clean.** `packages/code-review` is not imported by `src/` at all; `context/` is documentation only; `.claude/` was never tracked. So the de-course-ification work is almost entirely documentation surgery — it can proceed without touching a line of application code.
- **Defence in depth is real here, and it is what bounds F1.** The middleware matcher is the _only_ page-level gate, but every API route independently re-verifies the session and RLS is the actual data boundary. That is why a CVSS 8.2 authz bypass degrades to "unauthenticated visitor sees an empty page shell" rather than a data breach. The durable fix is a page-level `if (!Astro.locals.user) return Astro.redirect(...)`, which closes the whole class independent of the Astro version.
- **RLS-only scoping is a deliberate, documented choice** (`src/lib/flashcards/study.ts:14-21`, `[id].ts:50-54`, `cards.astro:12` query without `.eq("user_id", …)`). Correct today, with one future-risk edge: `getNextCard(supabase, now)` accepts _any_ client, so handing it `createAdminClient()` would silently return other users' cards with no policy to stop it. `scripts/verify-rls.mjs` is the regression guard.
- **Two config-vs-reality mismatches share one root cause:** the checked-in config is not the config that ships. `wrangler.jsonc` says `./dist` while the deploy actually uses `dist/client` (G2), and `supabase/config.toml` is local-only while prod auth policy lives in a dashboard (G11). Both are latent-drift bugs, not present-tense breakage — and both get worse the longer they sit.
- **The `.gitignore` rules are load-bearing beyond ignoring.** `eslint.config.js:88` feeds `.gitignore` into `includeIgnoreFile()`, so `.gitignore:52` (`.github/**/10x-*`) also shapes lint scope — which is exactly why `.github/actions/ai-code-review/action.yml:4-6` warns that the directory must not start with `10x-`. Deleting those rules while 10x-cli is still in use would start tracking the course skills.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "UI copy is English-only": the starter shipped 6 Polish strings in the config-status banner that survived unnoticed because no test asserts copy language, and a diacritics-only grep misses words like `Uwaga`. **Directly applicable**: any language gate added here must grep for known non-English literals, not just diacritics.
- `context/foundation/lessons.md` — "Migrations aren't shipped until CI pushes them": relevant to `README.md:134`'s false claim, and a reminder that `supabase/config.toml` changes never reach prod at all.
- `context/archive/2026-07-02-bootstrap-verification/verification.md:60,64` — records the `git clone …/10x-astro-starter .bootstrap-scaffold` bootstrap. The definitive provenance record, and immutable by convention.
- `context/archive/2026-08-22-start-page-redesign/research.md:263` — already noted that "starter branding was never rewritten post-bootstrap".
- `context/archive/2026-08-22-start-page-redesign/reviews/plan-review.md:106` — already flagged the `wrangler.jsonc` name: renaming the Worker creates a **new** Worker with no secrets and no routes while the old one keeps serving. This is why `"10x-cards"` must stay.
- `context/archive/2026-07-02-deployment/deployment-plan.md:61-62` — records that `wrangler.jsonc` once said `10x-astro-starter`, producing a `10x-astro-starter.<subdomain>.workers.dev` URL.

## Related Research

- `context/archive/2026-08-22-start-page-redesign/research.md` — branding and landing-page work; the closest prior art on product identity
- `context/archive/2026-07-02-bootstrap-verification/verification.md` — the starter bootstrap record
- `context/archive/2026-08-19-code-review-evals/research.md` — `packages/code-review` eval suite context
- `context/archive/2026-07-05-testing-authorization-input-boundary-hardening/plan.md` — prior authorization-boundary work, relevant to F1's page-level guard

## Open Questions

1. **What happens to `context/`?** This is the central judgment call and it is genuinely two-sided. It is 134 tracked files and the bulk of remaining provenance — _and_ 23 change folders whose plans cite real files, line numbers, and WCAG math, closer to a well-run ADR archive than to homework. Options: (a) keep it, fix only the six B-class artifacts; (b) keep it but relocate to `docs/process/` so it stops dominating the root listing; (c) untrack it wholesale. Note (c) conflicts with `AGENTS.md:69` treating `context/archive/` as immutable, and it discards the artifact that makes the repo look most like real engineering.
2. **Is the 41%-paperwork commit log a liability or an asset?** 87 of 211 file-touching commits exist only to move `context/` files. A visitor scrolling the log sees `chore(archive): close X` and `(epilogue)` far more than anything about the product. No rewrite is needed to fix this going forward — but nothing fixes the existing 87 either, short of a 225-commit rewrite.
3. **Do the 170 AI co-author trailers (75%) stay?** A separate disclosure from course origin. Removing them means rewriting essentially all history; keeping them means every commit renders with a second avatar on GitHub.
4. **Is `packages/code-review` kept, and if so, is its `evals/` framing trimmed?** It is defensible (a self-hosted LLM PR reviewer with an eval harness) and load-bearing (its failure breaks AI review on every PR), but it is also traceable to three consecutive lesson changes. Highest coupling in the repo.
5. **Does 10x-cli use stop?** If not, `CLAUDE.md`'s block returns on the next `10x-cli get` and `.gitignore:50-53` must stay. If it stops, both can go permanently — but the E2E rules must be confirmed as fully mirrored in `AGENTS.md` first.
6. **Should the `risk1-…risk10-` test filenames and `F-01`/`S-04`/`S-05` migration slice IDs be renamed?** Mechanically free (no config matches on them), but it costs traceability to `test-plan.md` and `roadmap.md`.
7. **Is `SITE_URL` actually set in Cloudflare?** If not, every shared link unfurls bare in production. Not verifiable from the repo.
8. **What is production's actual auth policy?** Password length, email confirmation, and auth rate limits live in the Supabase dashboard and are invisible to this repo (G11). Worth capturing in `docs/` or via a `supabase config push` step.
