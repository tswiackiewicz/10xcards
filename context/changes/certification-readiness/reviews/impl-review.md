<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Certification Readiness

- **Plan**: context/changes/certification-readiness/plan.md
- **Scope**: All 5 phases (Progress 53/55; the 2 open rows are Manual and documented)
- **Date**: 2026-08-23
- **Commits**: 21fa208, 593f38c, 7355a65, d1c012c, 873f171, 5797ef0
- **Verdict**: REJECTED at review time — see Triage outcome below
- **Findings**: 1 critical, 6 warnings, 3 observations

## Triage outcome (2026-08-23)

All ten findings triaged. Nine fixed, one skipped:

| Finding                                          | Decision                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| F1 account-existence oracle (CRITICAL)           | FIXED via Fix A                                        |
| F2 no `Cache-Control` on the session response    | FIXED — but not by the fix as written; see the finding |
| F3 bare headers on the unauthenticated redirect  | FIXED                                                  |
| F4 regression test asserts at the wrong layer    | FIXED, break-and-revert verified                       |
| F5 undocumented `wrangler` pin                   | FIXED via Fix A                                        |
| F6 no CSP baseline where Astro emits none        | FIXED (one dev-server regression on the way)           |
| F7 manual rows verified by a throwaway script    | **SKIPPED** — still open                               |
| F8 README publicises an unmitigated abuse vector | FIXED                                                  |
| F9 seven smaller items                           | FIXED for 1, 2, 4, 5, 6, 7; item 3 left as recorded    |
| F10 two Progress rows overstate their evidence   | FIXED                                                  |

Post-triage state: `npm run lint` clean, 65 unit tests pass (63 before, +2 from F4), 6 e2e specs
pass, `npm run build` passes. Against `astro preview`: signup answers a taken address exactly as a
free one; the session-establishing 302 carries `no-store`; the signed-out redirect carries all four
security headers; HTML keeps a hash-locked `script-src`; API and 404 responses carry the baseline;
`_astro/*` still serves `public, max-age=31536000, immutable`; a Playwright sweep of the five public
pages reports zero CSP violations.

Two things the fixes did not close, both named in their findings: F1's second bug (a successful
signup sets a live session _and_ redirects to `/auth/confirm-email`) needs F1's Fix B, which is a
production auth-policy decision; and F7's missing preview-mode CSP guard, which F6 widened.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Every Automated success criterion across all five phases was re-run during this review and passes:
astro@6.4.8, GHSA-vj59-8hwv-xxmv absent, lint, 63 unit tests, 6 e2e specs, build, actionlint,
`verify-rls.mjs` (27 assertions), prettier, the course/starter greps, the wrangler dry-run
(31 files from `dist/client`), and the CSP + header checks against `astro preview`.

The headline result is that **two of the three security properties Phase 1 and Phase 4 claim to
establish are not actually established at the response layer** (F1, F2), and in both cases the
green automated criteria could not have detected it.

### Verified correct — no findings

Recorded so a later reader does not re-litigate them:

- **Per-page guards are genuinely independent.** `locals.user` is populated before the
  `PROTECTED_ROUTES` prefix match, so a path-canonicalization bypass of that matcher still meets a
  populated `locals.user` on all six pages. The defence-in-depth claim holds.
- **GitHub Actions permissions.** `contents: read` is sufficient for all four jobs — no
  `GITHUB_TOKEN`/`GH_TOKEN` reference exists in `ci.yml`. `purge.yml`'s `permissions: {}` is right.
- **Skipped-dependency semantics.** On `pull_request`, `migration-dry-run` is skipped, so `deploy`
  is too — and `deploy`'s own `if` is already false there. `ci` remains the sole required check, and
  production `SUPABASE_DB_PASSWORD` is genuinely out of reach of PR-authored workflow YAML.
- **Action SHA pins.** All three resolve and match their trailing version comments.
- **`no-store` blast radius is correctly bounded.** Static assets never reach the Worker
  (`directory: "./dist/client"`, no `run_worker_first`); `_astro/*` still serves
  `public, max-age=31536000, immutable`. The `dist` → `dist/client` narrowing is a real fix in its
  own right — the old root would have exposed the server bundle as a static asset.
- **`secure: true` is safe on every real deployment path** (Cloudflare is HTTPS-only; Chromium
  treats `localhost` as a secure context). See F9 for the one dev edge case.

## Findings

### F1 — Account-existence oracle survives via the signup redirect target

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signup.ts:16-21; root cause supabase/config.toml:209
- **Detail**: Phase 4 change 3's contract is "Signin and signup failures must be indistinguishable
  from an existence standpoint." The error _message_ was genericised, but the _redirect target_ was
  not. Verified live against the built Worker:

  ```
  POST /api/auth/signup   (NEW address)    → 302  Location: /auth/confirm-email
  POST /api/auth/signup   (EXISTING addr)  → 302  Location: /auth/signup?error=Could%20not%20create...
  ```

  Any unauthenticated client can enumerate every registered address by reading one header;
  `encodeURIComponent(toGenericAuthError(...))` is cosmetic against this. Sign-in is oracle-free —
  verified byte-identical on both branches — so the mapping module is correct and the signup
  route's control flow is what leaks.

  Root cause is `enable_confirmations = false`. GoTrue's built-in enumeration defence (returning an
  obfuscated fake user so both paths succeed identically) engages only when confirmations are on.
  `src/lib/auth/errors.ts:5-7` states that precondition and then does not act on it.

  **Same root cause, second bug:** with confirmations off a successful signup sets a live session
  cookie _and_ redirects to `/auth/confirm-email`, telling an already-logged-in user to confirm an
  email that will never arrive.

- **Fix A ⭐ Recommended**: Make the route's observable output identical for both branches — treat
  the already-exists case as success and redirect to `/auth/confirm-email`, while weak-password and
  malformed-address keep the generic `?error=`. Probing with a valid password then yields
  `/auth/confirm-email` either way; probing with a weak one yields the error either way.
  - Strength: Closes the channel at the only place that leaks it and needs no production
    auth-policy change — which matters, since production auth policy is still unverified (row 5.11).
  - Tradeoff: Someone who forgot they had an account gets "check your inbox" and no email. That is
    the standard accepted cost of non-enumerable signup. Does not fix the second bug above.
  - Confidence: HIGH — leak and fix both verified against the running preview build.
  - Blind spot: Timing differences between the branches were not measured.
- **Fix B**: Enable `enable_confirmations` locally and in the production project, so GoTrue itself
  obfuscates and both branches land on `/auth/confirm-email` naturally.
  - Strength: Fixes the oracle _and_ the live-session/confirm-email contradiction at the root, using
    the platform's own defence rather than app-level compensation.
  - Tradeoff: Changes production auth policy, which the plan explicitly scoped out as a separate
    decision, and requires a working transactional email path before it can ship.
  - Confidence: MEDIUM — correct in principle, but unverifiable from here: nobody has yet read the
    production auth settings (row 5.11 is still open).
  - Blind spot: Whether production email delivery is configured at all.
- **Decision**: FIXED via Fix A (2026-08-23). `isUserAlreadyExists()` added to
  `src/lib/auth/errors.ts`; `src/pages/api/auth/signup.ts` now falls through to
  `/auth/confirm-email` on that branch. Fix A's blind spot was narrowed during triage: probing
  the local stack directly showed GoTrue validates the password _before_ the existence lookup
  (`weak_password` on both a taken and a free address; `user_already_exists` only with a valid
  password), so the weak-password probe cannot distinguish either. The second bug named in this
  finding — a live session cookie alongside a `/auth/confirm-email` redirect — is untouched and
  needs Fix B.

### F2 — The session-establishing response carries the token but gets no `Cache-Control`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:61
- **Detail**: `context.locals.user` is resolved at line 13 from the _incoming_ request. During a
  sign-in the caller is still anonymous, so the `if (context.locals.user)` guard at line 61 is false
  and the no-store block never fires — on precisely the response that transmits the credential.
  Verified live:

  ```
  POST /api/auth/signin (success)
    302, Set-Cookie: sb-...-auth-token=<access + 400-day refresh>; HttpOnly; Secure; SameSite=Lax
    → no Cache-Control, no Pragma, no Expires

  GET /dashboard (authenticated, carries no token)
    200 → cache-control: private, no-cache, no-store, must-revalidate, max-age=0
  ```

  Phase 1 change 4's stated purpose is that "an intermediary cannot serve one user's session token
  to another". It is applied to every response except the one that actually carries the token.
  Practical exposure is bounded — a bare 302 is not heuristically cacheable and Cloudflare will not
  cache a `Set-Cookie` response by default — but this is exactly the defence-in-depth the phase set
  out to add.

- **Fix**: Widen the condition to cover responses that write a cookie:
  `if (context.locals.user || response.headers.has("Set-Cookie"))`.
- **Decision**: FIXED (2026-08-23), but **not by the fix as written** — `response.headers.has("Set-Cookie")`
  does not work here. `@supabase/ssr` writes the session through `context.cookies.set()`, and Astro
  only serializes that jar into a `Set-Cookie` header _after_ the middleware chain returns, so the
  header is absent at the point the condition runs. Applying the stated fix and re-probing a real
  successful `POST /api/auth/signin` against `astro preview` showed the response still shipping no
  `Cache-Control` — the finding would have been recorded as fixed while remaining true. The shipped
  condition is
  `context.locals.user || response.headers.has("Set-Cookie") || !context.cookies.headers().next().done`
  (`headers()` is Astro's non-consuming generator; `consume()` would break the adapter downstream).
  Verified live: the 302 that establishes the session now carries
  `private, no-cache, no-store, must-revalidate, max-age=0` plus `Expires`/`Pragma` and all four
  security headers, while an anonymous `GET /` still carries none and `_astro/*` keeps
  `public, max-age=31536000, immutable`.

### F3 — Security headers absent on the middleware's unauthenticated redirect

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:22
- **Detail**: `return context.redirect("/auth/signin")` returns at line 22, before `next()` at line
  26 and before every header assignment at lines 52-59. Measured against `astro preview`, count of
  the 4 security headers present:

  ```
  /                        4    [200]
  /auth/signin             4    [200]
  /dashboard (signed out)  0    [302]   <-- the early return
  /api/flashcards          4    [404]
  /nonexistent             4    [404]
  ```

  Six protected routes × every signed-out hit makes this one of the most frequently served
  responses in the app, and the only unhardened one. HSTS is the one that stings: a first-contact
  request to a bookmarked protected path over plain HTTP returns a redirect that never arms HSTS.

- **Fix**: Hoist the header block into a helper and apply it on both return paths, so one place
  decorates every outgoing response.
- **Decision**: FIXED (2026-08-23). `applySecurityHeaders()` extracted in `src/middleware.ts` and
  applied to both the unauthenticated redirect and the `next()` response.

### F4 — The 4.9 regression test asserts at a layer that cannot see the oracle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/unit/auth-error-enumeration.test.ts:50-52
- **Detail**: This is the direct cause of F1 shipping. The test compares
  `toGenericAuthError(flow, USER_EXISTS)` with `toGenericAuthError(flow, BAD_CREDENTIALS)` — two
  _error_ inputs to a pure mapping function. It can never observe a redirect target, and the success
  path never enters it. Its docblock calls it "the regression guard for the account-existence
  oracle", so the suite is green while the property it claims to protect is false end to end.
  Progress row 4.9 was marked complete on that basis. The break-check run during implementation
  confirmed the test protects the _mapping_ — true, and beside the point.

  This is the failure mode already recorded in this project's own memory: an E2E/risk claim needs a
  live break-and-revert against the real surface, not reasoning that a test would catch it.

- **Fix**: Add a route-level or e2e assertion that a signup for a seeded existing address and one
  for a fresh address, with the same valid password, produce identical status **and** `Location`.
  It fails today — that is the point. Pair it with F1's fix so it goes green on the fix.
- **Decision**: FIXED (2026-08-23). Added `tests/unit/auth-signup-existence-oracle.test.ts`: two
  route-level probes comparing `{status, Location}` for a seeded taken address against a free one,
  under a valid password and under a weak one. The second case pins the GoTrue ordering that F1's
  fix depends on (password validated before the existence lookup), so a reversal fails loudly.
  Break-and-revert run: with F1's `!isUserAlreadyExists(error)` guard removed the valid-password
  case fails (`302 /auth/confirm-email` vs `302 /auth/signup?error=...`) and passes again once
  restored. `auth-error-enumeration.test.ts`'s docblock no longer claims to be that guard and
  points here instead.

### F5 — The no-prerelease invariant rests on a pin whose rationale exists only in a commit message

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: package.json (devDependencies: `"wrangler": "4.116.0"`)
- **Detail**: `wrangler` is pinned exactly while every other dependency uses a caret range. The pin
  is correct — wrangler >= 4.117.0 declares `miniflare@5.x-alpha` as a hard dependency, so any bump
  reintroduces the prerelease that Phase 2's own criterion 2.2 forbids — but that reasoning lives
  only in commit 593f38c. `package.json` cannot carry comments, nothing in the repo explains the
  anomaly, and no check enforces the invariant, so an "unpin this, it looks like a mistake" cleanup
  would undo it and still go green.
- **Fix A ⭐ Recommended**: Document the pin in `AGENTS.md`, the file this repo already uses for
  exactly this class of non-obvious constraint.
  - Strength: Zero machinery; matches how the `.prettierrc.json`-per-package and
    `includeIgnoreFile()` gotchas are already recorded.
  - Tradeoff: Informs a human, does not stop an automated bump.
  - Confidence: HIGH — consistent with existing repo practice.
  - Blind spot: Nobody reads AGENTS.md before merging a bot PR.
- **Fix B**: Assert it — a unit test or `ci` step failing on any non-allowlisted prerelease in
  `package-lock.json`.
  - Strength: Actually enforces criterion 2.2 and catches bot PRs.
  - Tradeoff: Needs an allowlist for the 7 pre-existing prereleases, which will drift; the plan
    explicitly decided against new CI gates.
  - Confidence: MEDIUM — easy to write, but adds a maintenance surface the plan ruled out.
  - Blind spot: Whether the team wants any new gate at all.
- **Decision**: FIXED via Fix A (2026-08-23). `AGENTS.md`'s Stack section now carries the pin, why
  it is the only exact pin in the manifest, and the condition for bumping it. Fix A's blind spot
  stands: nothing stops an automated bump.

### F6 — CSP has no baseline on responses where Astro emits none

- **Severity**: 📌 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:52-56
- **Detail**: The append logic is correct where Astro emits a policy — the hash-locked `script-src`
  survives intact on SSR HTML, verified. But on responses where Astro emits nothing (API routes,
  404s) the composition yields a policy with no `script-src`, no `default-src`, no floor:

  ```
  GET /nope-xyz  →  Content-Security-Policy: frame-ancestors 'none';
                    style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'
                    Content-Type: text/html
  ```

  Low impact today (that 404 body is static, JSON carries `nosniff`), but there is a latent ordering
  hazard: CSP honours the **first** occurrence of a directive, so if anyone later adds
  `frame-ancestors` via `security.csp.directives`, the middleware's appended copy silently becomes
  dead code.

- **Fix**: Move the non-style directives into `astro.config.mjs` where Astro merges them properly —
  `frame-ancestors`, `default-src`, `object-src` and `base-uri` are all in Astro's allowlist, while
  `style-src*` is explicitly rejected there, so the middleware append is still required for the two
  style carve-outs. Then drop `frame-ancestors` from `EXTRA_DIRECTIVES` and give the middleware a
  fallback baseline for the `astroCsp == null` case.
- **Decision**: FIXED (2026-08-23). `astro.config.mjs` now sets
  `csp: { directives: ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"] }`, so Astro
  merges them and the ordering hazard is gone. `src/middleware.ts` appends only the two style
  carve-outs, and falls back to `BASELINE_DIRECTIVES` (`default-src 'none'` plus img/font/connect/
  frame-ancestors/base-uri) when Astro emitted nothing. `default-src` was left out of the Astro list
  deliberately: it would apply to hydrating pages, where `connect-src`/`img-src` are unaudited.
  Verified against `astro preview`: HTML pages carry the merged policy with `script-src` still
  hash-locked, `/nope-xyz` and API responses carry the baseline, and a Playwright sweep over `/`,
  `/auth/signin`, `/auth/signup`, `/auth/confirm-email` and `/nope-xyz` reports zero
  `securitypolicyviolation` events (the 404 page's inline `<style>` is covered by the
  `style-src-elem` carve-out). Signed-in pages were not swept — see F7.

  The baseline is gated on `import.meta.env.PROD`, and that gate was not foresight: the first
  version shipped it unconditionally and broke every e2e spec. `astro dev` emits no CSP at all, so
  "responses Astro attached no policy to" is not just API routes and 404s there — it is every page,
  and `default-src 'none'` blocked every script, so no island hydrated and the suite timed out on
  the first `waitForAstroHydration`. Confirmed against a real dev server before gating, and the
  full suite (65 unit, 6 e2e) is green after. Standing consequence: the e2e suite runs on
  `astro dev` and therefore can never exercise the baseline branch — it is preview-only, which is
  more of what F7 is about.

### F7 — Manual rows 4.7 / 4.8 were verified by a throwaway script that left no artifact

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (Progress rows 4.7, 4.8)
- **Detail**: The CSP-violation sweep across eight pages and the island-hydration probes were really
  run against `astro preview`, but with an ad-hoc Playwright script kept outside the repo. Nothing
  in `tests/e2e/` covers them, and the e2e suite runs `astro dev` where the CSP is inert by design,
  so no committed artifact can reproduce the claim and a CSP regression has no guard.
- **Fix**: Commit the sweep as a Playwright spec run against a preview server (a separate project or
  config, since the default `webServer` is `astro dev`), asserting zero `securitypolicyviolation`
  events and that islands respond to interaction.
- **Decision**: SKIPPED (2026-08-23). Still open, and F6's fix widened it slightly: the CSP now has
  two shapes (Astro-merged on HTML, the middleware baseline elsewhere) and neither has a committed
  guard. During F6's triage an ad-hoc Playwright sweep over `/`, `/auth/signin`, `/auth/signup`,
  `/auth/confirm-email` and `/nope-xyz` reported zero violations against `astro preview` — but that
  script was again not committed, and signed-in pages (notably the `/account` Radix dialog whose
  runtime-injected `<style>` is the whole reason for the style carve-outs) remain unswept.

### F8 — One unplanned README addition publicises an unmitigated abuse vector on a public repo

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: README.md:168-169
- **Detail**: Five additions were made that the plan's "Changes Required" does not list. Four are
  justified by their phase's intent and disclosed in commit messages: the three E2E rules added to
  `AGENTS.md` (required by the change-3 contract, which the plan wrongly claimed was already
  satisfied); the `.gitignore` comment rewritten from Polish and de-referenced from 10x-cli, rules
  byte-identical; `LICENSE` added to `.prettierignore`; and the bogus `npx supabase init` step
  removed from README's first-time setup.

  The fifth is not justified. `README.md:168-169` reads:

  > Rate limiting on signup and on the paid AI generation endpoint is **not** implemented. See the
  > billing-risk note in `context/changes/certification-readiness/plan.md`.

  No Phase 5 contract asked for it — change 6 covers `SITE_URL` and the auth-policy caveat only. On
  a **public** repository it hands a reader a working recipe for the G4 billing attack the plan
  documents (unlimited account creation with captcha disabled, plus no per-user quota on a paid
  OpenRouter endpoint) while that gap is still open, and it routes them straight into the planning
  folder Phase 3 exists to de-emphasise. Disclosing an unmitigated, exploitable gap more loudly than
  it was already disclosed is a net negative.

- **Fix**: Delete the two lines. If the gap is worth recording at all, keep it in `context/` where
  the plan already tracks it, or reduce it to "rate limiting is a known gap" with no attack shape
  and no pointer. Separately, append a short addendum to the plan listing the four justified
  additions so a later reviewer does not re-flag them.
- **Decision**: FIXED (2026-08-23). `README.md:168-169` deleted (its "Two related facts" lead-in
  reworded to match the single remaining bullet); the gap stays tracked in `plan.md` only. An
  "Addendum — changes made outside Changes Required" section appended to `plan.md` listing all five
  additions, including this reversal.

### F9 — Seven smaller items worth recording

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.ts:42,53-68; src/lib/auth/errors.ts:11-13; src/pages/api/auth/\*.ts:7-8; .prettierignore; .github/
- **Detail**:
  1. **Immutable-Response hazard** — `response.headers.set()` is unguarded. Safe today (no
     `Response.redirect()` and no returned `fetch()` result anywhere in `src/`), but a future route
     returning a `fetch()` response would make `.set()` throw and 500 that route. Cheap insurance:
     `const out = new Response(response.body, response)` before setting.
  2. **`secure: true` on a non-localhost plain-HTTP origin** — device testing against
     `http://192.168.x.x:4321` silently fails auth with no diagnostic. Worth one README line.
  3. **Auth routes bypass the repo's zod convention** (pre-existing, not introduced here).
     `AGENTS.md` says API routes validate with zod; both do `form.get("email") as string`, which
     lies to the type checker — `FormData.get` returns `null` for a missing field and hands `null`
     straight to Supabase. Flagged, not fixed, per the don't-touch-adjacent-code rule.
  4. **No `.github/dependabot.yml`** — the three new SHA pins will never be un-frozen by anything.
  5. **Adding `LICENSE` to `.prettierignore` makes criterion 5.6 trivially pass.** The exclusion is
     correct (prettier cannot infer a parser for an extensionless file), but the criterion as
     written — `prettier --check README.md LICENSE package.json` — now asserts nothing about
     `LICENSE`.
  6. **`src/lib/auth/errors.ts:11-13` slightly overstates the rate-limit carve-out.** True for
     request-rate limits; `over_email_send_rate_limit` fires only when a confirmation email is
     actually attempted, which — with confirmations enabled — happens only for a _new_ address. A
     theoretical residual channel, and it interacts with F1's Fix B.
  7. **`src/middleware.ts:42` is imprecise.** It says Astro "rejects `'unsafe-inline'` inside
     `style-src` when hashes are present"; that is _browser_ behaviour (a hash causes
     `'unsafe-inline'` to be ignored), not Astro rejecting the config. Substance is correct.
- **Fix**: Take 1, 2, 4 and 5 as small independent follow-ups; correct 6 and 7 in place when the
  file is next touched; leave 3 to a change that owns those routes.
- **Decision**: FIXED for 1, 2, 4, 5, 6 and 7; 3 left as recorded (2026-08-23).
  1. `applySecurityHeaders()` now copies through `new Response(source.body, source)` before setting
     any header.
  2. README's dev-server step carries a blockquote: reach it as `localhost`, not as a LAN address,
     because `secure: true` cookies are silently dropped on a plain-HTTP non-localhost origin.
  3. Unchanged — still `form.get("email") as string` on both auth routes, still owed to a change
     that owns them.
  4. `.github/dependabot.yml` added: monthly `github-actions` (un-freezes the three SHA pins) and
     monthly `npm`, with `wrangler` on the ignore list and F5's reason inline.
  5. Criterion 5.6's command in `plan.md` corrected to drop `LICENSE`, with a note that the
     `.prettierignore` exclusion is right and keeping it in the command only looked like a check.
  6. `src/lib/auth/errors.ts`'s docblock now separates request-rate limits from
     `over_email_send_rate_limit` and flags the residual channel if confirmations are ever enabled.
  7. Corrected while rewriting the comment for F6 — it now says a hash makes the _browser_ ignore
     `'unsafe-inline'`, rather than Astro rejecting the config.

### F10 — Two Progress rows are ticked with claims their recorded evidence does not support

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/certification-readiness/plan.md:561, :616
- **Detail**: Row 5.11 was honestly annotated `PARTIAL` when it could not be fully met. Two other
  rows were not given the same treatment, so the plan — the artifact a later reader trusts — now
  states things that are false:
  - **4.5** (`plan.md:616`) is ticked as "HTML carries a `<meta http-equiv="content-security-policy">`
    with `sha256-` hashes and no `'unsafe-inline'`". Both halves are false as written: there is no
    meta element (Astro emits a header for SSR routes), and `'unsafe-inline'` _is_ present via
    `style-src-elem` / `style-src-attr`. The deviation is correct and both the code comment and
    commit `d1c012c` explain it accurately — but a reader of the plan alone is misled.
  - **1.7** (`plan.md:561`) is ticked as "`npx wrangler deploy --dry-run` reads from `dist/client`",
    silently dropping the `-c wrangler.jsonc` that the plan's criterion (`plan.md:160`) calls
    **required** precisely because the bare form reports `dist/client` whether or not the fix
    landed. The `-c` form cannot run in this repo at all (`main` is a bare package specifier), and
    the fix was instead proven by a separate probe — but the row as recorded is unfalsifiable.

  The underlying work is sound in both cases; the defect is in the record, and it is the record
  `/10x-archive` preserves.

- **Fix**: Annotate both rows the way 5.11 was annotated — state what was actually verified and how
  it differed from the criterion as written.
- **Decision**: FIXED (2026-08-23). Both rows now carry a `DEVIATION:` annotation in the same style
  as 5.11. 4.5's wording was also corrected to what was actually verified (`script-src` hash-locked),
  since the original text asserted two things that are false.
