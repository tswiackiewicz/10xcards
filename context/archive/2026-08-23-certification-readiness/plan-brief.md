# Certification Readiness — Plan Brief

> Full plan: `context/changes/certification-readiness/plan.md`
> Research: `context/changes/certification-readiness/research.md`

## What & Why

Make this public repo read as a classic product application rather than course output, and close the security findings the audit surfaced. The app was built during the 10xDevs course, so some parts were course-supplied scaffolding — but research found the _shipped application_ is already clean; the leak is six documentation artifacts, one starter literal in a live config, and a handful of unfinished-repo gaps. Alongside that, three security findings are live on a deployed public app and two of them are one-liners.

## Starting Point

`src/**` and `public/**` carry zero course references — `10xCards` is the product's own brand, and the favicons and og image are hand-authored. The ~1.1 MB of obvious course machinery in `.claude/` is gitignored and never was tracked. Meanwhile `context/` is fully committed (134 files) and holds the loudest artifacts, and four root-level files leak the course by name. On the security side: `astro@6.4.7` is installed and is the only 6.x release affected by a CVSS 8.2 authorization bypass whose exact target is this app's sole page-level auth gate; auth cookies ship without `HttpOnly` or `Secure` on a 400-day refresh token; and `wrangler.jsonc` declares an asset root that would publish the service-role key. No secret was ever committed — verified against 100% of history with a working positive control.

## Desired End State

A fresh clone and the GitHub repo page show a coherent Astro + Supabase flashcards product: accurate README, real `LICENSE`, populated `package.json`, no course or starter reference in any tracked file outside `context/`, patched dependencies, security headers on every response, and auth cookies no browser script can read. `context/`, git history, and the 10xCards brand all stay exactly as they are.

## Key Decisions Made

| Decision                       | Choice                                             | Why (1 sentence)                                                                                                            | Source   |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| `context/` disposition         | Keep in place; delete only its two B-class files   | Preserves 23 change records that read like a well-run ADR archive — the strongest evidence of real engineering.             | Plan     |
| Git history                    | No rewrite of any kind                             | 10 weeks public, 17 PRs retained under `refs/pull/N/head`; a rewrite changes only what a fresh clone shows.                 | Plan     |
| Product brand                  | Keep `10xCards`; fix only the starter literal      | The brand is coherent across every surface, and the Worker name `10x-cards` must not move.                                  | Plan     |
| 10x-cli                        | Stop using it; delete the block, keep `.gitignore` | The block at `CLAUDE.md:7` is the loudest front-page signal, and `eslint.config.js:88` makes the ignore rules load-bearing. | Plan     |
| Security depth                 | Tier 2 — critical fixes plus headers and errors    | CSP is the other half of the cookie fix; abuse/GDPR and DB-hardening findings are deferred, not resolved.                   | Plan     |
| Dependencies                   | Explicit `astro@6.4.8` + `wrangler@4.125.0`        | `npm audit fix` was shown to pull a `miniflare` prerelease into the tree.                                                   | Research |
| CI hardening                   | Fix both G5 and G6                                 | Anyone with push access can currently edit `ci.yml` in a PR and print the production DB password.                           | Plan     |
| `packages/code-review`         | Keep; no edits needed                              | Verified during planning to already carry zero course vocabulary outside the frozen eval corpus.                            | Plan     |
| `context/domain`, `deployment` | Leave as-is                                        | Explicitly accepted as residual provenance.                                                                                 | Plan     |
| Hygiene gaps                   | High + Medium (LICENSE, README, `package.json`)    | A declared-but-absent license and a factually wrong setup section undercut the goal more than any `10x` string does.        | Plan     |
| Internal naming / CI gate      | Keep names; no grep gate                           | Renames would sever traceability to `test-plan.md` and `roadmap.md`, both of which are being kept.                          | Plan     |
| GitHub-side surface            | Repo About box only                                | PR titles and history stay untouched.                                                                                       | Plan     |
| Prod blind spots               | Verify and document both                           | `SITE_URL` and production auth policy are the only two things this audit cannot attest to.                                  | Plan     |

## Scope

**In scope:** Astro `6.4.8`; `httpOnly`/`Secure` cookies; per-page session guards; `wrangler.jsonc` asset root; cache headers on authenticated responses; `wrangler@4.125.0`; workflow `permissions:` blocks and SHA pins; moving the prod migration dry-run off PR triggers; deleting the six course artifacts; `supabase/config.toml` `project_id`; hash-based CSP via Astro's `security.csp` + HSTS + `nosniff` + `Referrer-Policy` + `frame-ancestors`; generic auth error strings; `LICENSE`; three README corrections; five `package.json` fields; repo About box; verifying `vars.SITE_URL` and production auth policy.

**Out of scope:** any git history rewrite; relocating or untracking `context/`; renaming the product, repo, or Worker; `context/domain/` and `context/deployment/`; renaming the `risk1-`…`risk10-` tests or `F-01`/`S-04`/`S-05` slice IDs; a CI grep gate; community health files and issue templates; rate limiting (G4); the `:free`→paid model pin (G7); the two LOW database findings (G8, G10); Astro 7; secret rotation; PR title edits.

## Architecture / Approach

Almost none of this touches application logic. Research's key structural finding is that the product/process split is unusually clean — `packages/code-review` is not imported by `src/`, `context/` is documentation only, `.claude/` was never tracked — so de-course-ification is pure documentation and config surgery, and all six deletions have zero mechanical coupling.

The security work concentrates in three files: `src/lib/supabase.ts` (cookie options), `src/middleware.ts` (headers, alongside the existing route guard), and the six protected `.astro` pages (per-page session checks, closing the bypass class independent of Astro's version). Defence in depth already bounds the advisory — every API route re-verifies the session and RLS is the real data boundary — which is why a CVSS 8.2 bypass degrades to "visitor sees an empty page shell".

## Phases at a Glance

| Phase                          | What it delivers                                                                      | Key risk                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Critical security           | Astro 6.4.8, `HttpOnly`/`Secure` cookies, per-page guards, safe asset root            | `Secure` on `http://localhost:4321` could break the e2e auth suite (Chromium should accept it) |
| 2. Dependencies + CI hardening | Stable `wrangler` bump, least-privilege workflows, SHA pins, prod secrets off PR jobs | Moving the dry-run means schema drift surfaces on `master` rather than in the PR               |
| 3. Provenance surgery          | Six course artifacts deleted, `project_id` fixed, methodology comments reworded       | The `project_id` rename recreates the local Docker stack; Colima can fail `supabase start`     |
| 4. Headers + error hygiene     | Hash-based CSP, HSTS, `nosniff`, `Referrer-Policy`, `frame-ancestors`, generic auth errors | Silent failure mode, and no report-only stage — a bad CSP leaves islands rendering but not hydrating |
| 5. Repo hygiene                | `LICENSE`, three README fixes, `package.json` fields, prod verifications              | Two items need dashboard access and cannot be automated                                        |

**Prerequisites:** `git fetch origin` and a rebase onto `origin/master` **before the first commit** — remote `master` is `6048585`, absent locally, because PR #17 was squash-merged server-side; the working branch predates it. Docker/Colima running for the local Supabase stack. Dashboard access to GitHub repo settings/variables and the Supabase project.

**Estimated effort:** ~4–5 sessions across 5 phases. Phases 1, 3 and 5 are each a short session; Phase 2 is workflow work with a real deploy to verify; Phase 4 is the one that can absorb a whole session on CSP iteration.

## Open Risks & Assumptions

- **The stale-`master` rebase is the most likely way this change causes real damage** — skipping it means the PR reverts PR #17's merge.
- **G4 (no rate limiting on signup or the paid AI endpoint) stays open and is a direct billing-loss chain**: sign up N accounts, loop 10k-char generations, burn the OpenRouter balance.
- **G7 stays open and is a GDPR subprocessor gap** — the code pins a `:free` model while its own comment two lines above states the intent is a paid model with provider training disabled for a stated NFR.
- **The CSP ships enforcing with no report-only stage** — Astro's hash-based CSP is a `<meta http-equiv>` element and meta CSP has no report-only variant. It also does not work under `astro dev`, so the e2e suite cannot verify it; the `astro preview` island check is the only real gate.
- **Pre-merge detection of production schema divergence is given up.** `supabase start` still catches local-apply failures on every PR, but a migration conflicting with prod's actual state now surfaces on `master` — the class `lessons.md` records as having bitten once.
- **No regression guard.** With no CI grep gate, the `CLAUDE.md` block returns automatically the next time 10x-cli is run in this repo.
- `context/` remains the largest known residual — 134 files whose folder shape reads as a methodology, plus a Module 4 title, 50 lines of Polish, and a "Lesson 5 deliverable" line. A deliberate trade.
- **Assumption:** absent production `og:` tags are caused by an unset `vars.SITE_URL`, not a code defect — the guard at `src/layouts/Layout.astro:40-47` is verified correct, and Phase 5 tests this directly.

## Success Criteria (Summary)

- A visitor cloning the repo or browsing its page finds an accurate, licensed, coherent product app with no course or starter reference outside `context/`.
- The deployed app patches the CVSS 8.2 bypass, serves auth cookies a browser script cannot read, sends security headers, and leaks no account-existence signal on signup.
- Production credentials are no longer reachable from a PR-triggered CI job, and the full suite — lint, Vitest, Playwright, build — passes at every phase boundary.
