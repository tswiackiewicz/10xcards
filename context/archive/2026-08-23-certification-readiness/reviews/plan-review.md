<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Certification Readiness

- **Plan**: `context/changes/certification-readiness/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-23
- **Verdict**: REVISE → **SOUND** after triage (8/8 findings resolved)
- **Findings**: 2 critical, 5 warnings, 1 observation

## Verdicts

| Dimension             | Verdict (at review) | After triage |
| --------------------- | ------------------- | ------------ |
| End-State Alignment   | WARNING             | PASS         |
| Lean Execution        | WARNING             | PASS         |
| Architectural Fitness | FAIL                | PASS         |
| Blind Spots           | WARNING             | PASS         |
| Plan Completeness     | WARNING             | PASS         |

## Grounding

15/15 paths ✓, 4/4 symbols ✓, brief↔plan ✓. Progress↔Phase contract verified mechanically before and after triage: 1 `## Progress` heading, 5/5 phase names matched, criteria counts equal to Progress rows in every phase, ID sequences contiguous, zero stray checkboxes in phase bodies.

## Findings

### F1 — Phase 4 names a config that doesn't exist, and its two stated options are mutually incompatible

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 change 1; Critical Implementation Details
- **Detail**: The plan offered "`'unsafe-inline'` for `script-src` or Astro's `experimental.csp` hashes". Three problems: (1) Astro 6 has **stable** `security.csp`, not `experimental.csp` (`node_modules/astro/dist/types/public/config.d.ts:660,699` — `@version 6.0.0`, default `false`); (2) Astro's own type docs state `'unsafe-inline'` is **incompatible** with its CSP implementation, because browsers reject it when a hash or nonce is present in the same directive — so option A was a dead end, not a fallback; (3) `security.csp` emits `<meta http-equiv="content-security-policy">`, which cannot express report-only and ignores `frame-ancestors`, making "ship report-only first" and "use Astro's CSP" mutually exclusive. Also `security.csp` merges into the same `security` object already holding `checkOrigin: true` (`astro.config.mjs:21`).
- **Fix A ⭐ Recommended**: Split the two mechanisms explicitly.
  - Strength: `security.csp: true` makes Astro compute hashes for its own island scripts and styles — exactly the problem the plan was working around — and ships enforcing, so no report-only stage is needed for script/style. Middleware carries only what meta cannot: `frame-ancestors`, HSTS, `nosniff`, `Referrer-Policy`.
  - Tradeoff: Security posture defined in two places; no report-only safety net for script/style.
  - Confidence: HIGH — read directly from the installed type docs.
  - Blind spot: Shiki is unsupported under Astro CSP. **Cleared during triage** — 0 hits for Shiki/`<Code>`/`<Prism>` and 0 for `ClientRouter`/`transition:*` in `src/`, so both of Astro CSP's documented incompatibilities are absent.
- **Fix B**: Hand-roll the whole CSP as a middleware report-only header with `'unsafe-inline'`.
  - Strength: Keeps the report-only staging; one place to look.
  - Tradeoff: `'unsafe-inline'` makes `script-src` near-worthless, so the XSS this was meant to pair with the cookie fix stays exploitable.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. Phase 4 split into change 1 (`astro.config.mjs` → `security.csp`) and change 2 (middleware header-only directives); the report-only strategy removed from Critical Implementation Details, Desired End State, Phase 4 overview, and Open Risks; the `astro dev` limitation documented.

### F2 — Phase 3's cleanliness criterion fails on package-lock.json, which no phase touches

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3, criterion 3.1
- **Detail**: `package-lock.json:2` and `:8` still read `"name": "10x-astro-starter"`. Research §A recorded the `package.json` rename in `1c51e90` but never checked the lockfile, and the plan inherited the blind spot. Criterion 3.1 greps every tracked file outside `context/` and the eval corpus for `10x-astro-starter` — it would hit these two lines and fail. This is also the last literal starter name outside `context/`, in a root file GitHub indexes.
- **Fix**: Add a Phase 3 step asserting `package-lock.json`'s `name` is `10xcards`; note that npm rewrites the field from `package.json` on any lockfile write, so Phase 1's and Phase 2's installs likely fix it for free, with `npm install --package-lock-only` as the fallback. The criterion must run after those installs.
- **Decision**: FIXED. Added as Phase 3 change 8 with two criteria (3.1 note + new 3.2); Phase 3 Progress renumbered to 3.1–3.13.

### F3 — Criterion 1.7 cannot verify the wrangler fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, criterion 1.7
- **Detail**: Verified `.wrangler/deploy/config.json` redirects `configPath` to `../../dist/server/wrangler.json`, whose assets block is `{"directory": "../client"}`. A bare `wrangler deploy --dry-run` therefore reports `dist/client` both before and after the change — the criterion passes either way and proves nothing. The fix only takes effect on the explicit `-c` path, which is precisely the path G2 says a human will run by hand.
- **Fix**: Use `npx wrangler deploy --dry-run -c wrangler.jsonc` and assert `.dev.vars` is absent from the file list. (`dist/server/.dev.vars` exists right now, 309 B.)
- **Decision**: FIXED.

### F4 — Phase 1 change 4 isn't small, and its mechanism is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 changes 2 and 4
- **Detail**: The underlying finding checks out — `applyServerStorage` (`node_modules/@supabase/ssr/dist/main/cookies.js:328,376-380`) calls `setAll` with `{"Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache"}`, and `src/lib/supabase.ts:18` discards it. But "record the values and apply them in middleware" had no mechanism: `createClient` is called from **16 files** and receives only `requestHeaders` and `cookies`, with no route to `locals` or the response; routes build their own clients _after_ middleware entered `next()`, so middleware cannot observe a downstream write without new plumbing. Phase 1's overview also said "Four changes" while listing five.
- **Fix A ⭐ Recommended**: Drop the conditional — set the three headers on any response where `context.locals.user` is non-null.
  - Strength: Auth-bearing responses are exactly the ones that must not be cached, the check already exists at `src/middleware.ts:13`, and no signature changes anywhere.
  - Tradeoff: Broader than strictly necessary — authenticated pages become uncacheable at the edge even when no cookie was rewritten.
  - Confidence: HIGH — that is the correct caching posture for a per-user SSR page regardless.
  - Blind spot: None significant.
- **Fix B**: Widen `createClient`'s signature to take the full `APIContext`.
  - Strength: Headers set precisely at the point of write.
  - Tradeoff: Touches all 16 call sites for a caching header.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. Change 2's speculative `setAll` snippet removed, change 4 rewritten with the `locals.user` mechanism and the rationale for rejecting the conditional; "Four changes" corrected to five.

### F5 — Phase 2 claims `supabase db reset` substitutes for the prod dry-run; it doesn't, and it's largely redundant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment / Lean Execution
- **Location**: Phase 2 change 4
- **Detail**: Two problems in one change. **Redundant**: `ci.yml:33` already runs `supabase start`, which applies every migration to a fresh local stack, so local-apply failures are already caught pre-merge and the proposed `db reset` adds almost nothing. **Not equivalent**: what the prod dry-run uniquely catches is divergence against production's _actual_ schema state — `AGENTS.md` says exactly that ("catches migrations that fail against prod before merge") — and no local run can see prod. Moving the dry-run to push-only genuinely loses pre-merge prod-divergence detection; the plan asserted an equivalence that doesn't hold. `context/foundation/lessons.md`'s "Migrations aren't shipped until CI pushes them" exists because prod schema drifted silently once.
- **Fix A**: Gate the dry-run on a GitHub Environment with required reviewers instead of push-only, and drop the redundant `db reset`.
  - Strength: Keeps pre-merge prod-divergence coverage while removing the attack path.
  - Tradeoff: Every PR touching migrations needs an approval click.
  - Confidence: MED — not verified against this repo's environment settings.
  - Blind spot: Whether Environments are available/configured here.
- **Fix B ⭐ Chosen**: Push-only as planned, drop the `db reset`, state the loss plainly.
  - Strength: Simplest; no approval friction.
  - Tradeoff: Prod-divergence surfaces after merge — the exact failure mode `lessons.md` was written about.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B. `db reset` removed; the loss documented in the change contract, in `README.md:193` and `AGENTS.md` update requirements, in criterion 2.6/2.9, and as a new entry in Open Risks. The Environment option recorded as an explicit non-goal of this change.

### F6 — The enumeration fix ships with no automated coverage, and the plan cites specs that don't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 change 3; criterion 4.9
- **Detail**: The plan said "Existing e2e specs asserting on error copy will need updating." There are none — grep for `Invalid login|already registered|error=|ServerError` across `tests/e2e/` returns zero hits; the five spec files are `landing-smoke`, `risk1-…`, `risk3-…`, `risk8-…`, `seed`. So there was nothing to update and nothing to catch a regression: the indistinguishability criterion was manual-only, and an account-existence oracle could come back silently.
- **Fix**: Correct the claim, put the mapping in a small exported helper rather than inline in the two route handlers, and add a unit test asserting no Supabase error code — `"User already registered"` in particular — yields a message distinguishable from a generic credentials failure.
- **Decision**: FIXED. Claim corrected, helper-plus-unit-test requirement added to the change contract, and criteria 4.2 / progress 4.2 updated to name the new test.

### F7 — Phase 4's CSP criteria are unverifiable in the e2e/dev environment

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4, criteria 4.3, 4.5, 4.6
- **Detail**: Astro's config types state CSP "isn't supported while working in `dev` mode… test this using `build` and `preview`." Verified `playwright.config.ts:33` runs `npm run dev` (`astro dev`), deliberately (comment at `:30-32`). So the e2e criterion says nothing about CSP; a `curl -sI http://localhost:4321/` would show no Astro-generated CSP at all; and the zero-violations-across-eight-pages check — which the plan itself calls "not optional" — could not be validated through the dev flow.
- **Fix**: Add a `npm run build && npx astro preview` verification step and retarget the CSP criteria at the preview server rather than dev.
- **Decision**: FIXED. Criteria 4.3/4.5/4.6/4.7/4.8 rewritten to name the preview server and to state explicitly that the e2e suite cannot see the CSP; the Implementation Note now requires the island check on `astro preview`. Phase 4 Progress renumbered to 4.1–4.10.

### F8 — Two doc references go stale or are already wrong

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 change 5; Phase 1 change 1
- **Detail**: `AGENTS.md:14` reads "`npx wrangler deploy` — ship `./dist` to Cloudflare Workers manually"; after Phase 1 change 5 the asset root is `./dist/client` and no phase updated the line. The plan also cited `package.json:36` for the astro range when it is `package.json:34` (research's number, carried forward).
- **Fix**: Add `AGENTS.md:14` to Phase 1 change 5's contract; correct the line reference.
- **Decision**: FIXED.

## Notes

- F1, F2 and F5 were defects in the plan as originally written, not pre-existing repo issues. F1 in particular changed Phase 4's approach rather than just its wording.
- `plan-brief.md` was updated in the same pass to match the revised CSP mechanism, the `authenticated responses` cache-header scope, and the two new Open Risks (enforcing CSP with no report-only stage; pre-merge prod-divergence detection given up).
