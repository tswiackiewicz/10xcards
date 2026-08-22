<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Start Page Redesign — 10xCards Brand, Landing & App-Wide Theme

- **Plan**: context/changes/start-page-redesign/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-22
- **Verdict**: NEEDS ATTENTION → triaged 2026-08-22 (6 fixed, 1 accepted)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence base

Automated criteria re-run for this review (not taken on trust):

- `npx astro sync && npm run lint` — pass
- `npm run build` — pass
- `npm test` — 54/54 pass (16 files)
- `npm run test:e2e` — 6/6 pass on two consecutive clean runs. An initial run failed 5/6; cause was contention over the shared local Supabase stack with the `npm test` run immediately preceding it, not a code regression.
- All 9 grep gates from Phases 1 and 4 return zero hits, including `bg-cosmic`, `text-white` (`--exclude-dir=ui`), `backdrop-blur`, `min-h-screen` in `src/pages/`, Polish diacritics + `Uwaga`/`Dokumentacja`, and `10x-astro-starter`.
- `wrangler.jsonc`, `src/middleware.ts`, and `supabase/` are absent from the diff — the plan's explicitly-flagged dangerous Worker rename did not happen.
- **WCAG AA contrast independently recomputed** from `global.css` at HEAD (oklch → sRGB → WCAG). The plan's claim holds in both themes: primary-fg/primary 5.15 / 9.34; foreground/background 17.66 / 17.52; muted-foreground/background 5.70 / 7.21; destructive/background 4.57 / 6.60. Tightest margin is destructive/background in light at 4.57:1 — passing, but any future darkening of `--background` breaks it.
- **Progress row 2.6 (deliberate-break check) independently re-verified live**: pointing the hero CTA at a wrong route turned `landing-smoke` red on the exact `waitForURL("/auth/signup")` assertion; reverting turned it green. Not rubber-stamped.
- `SITE_URL` is confirmed present as a GitHub repo variable, so the `og:image`/`og:url` block does render in production.

No unplanned files: all 49 changed files map to a plan item. No scope-guardrail violations across all nine "What We're NOT Doing" boundaries.

## Findings

### F1 — Topbar hoist creates two `banner` landmarks on every authenticated page

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/layouts/Layout.astro:69-73 (with src/pages/{account,cards,create,generate,study}.astro)
- **Detail**: Phase 4 #1 hoisted `Topbar.astro`'s `<header>` into the Layout so it renders on every page. Five inner pages still render their own body-level `<header class="flex items-center justify-between py-6">` (e.g. `cards.astro:19`). Neither is nested in `main`/`article`/`section`/`nav`/`aside`, so both map to the `banner` landmark — two banners per page, which is invalid and makes landmark navigation ambiguous. This is a **regression introduced by this change**, not a pre-existing shape: `git show 1c51e90^:src/pages/cards.astro` has exactly one `<header>`, because before the hoist `Topbar` was rendered only by `Welcome.astro` on `/`. Separately, only `Landing.astro:39` has a `<main>`; no authenticated page has a main landmark at all (that part is pre-existing).
- **Fix A ⭐ Recommended**: Wrap the slot in `Layout.astro` — `<main><slot /></main>` — leaving the Topbar's `<header>` outside it.
  - Strength: One line, one file. Nesting the per-page `<header>`s inside `<main>` strips their `banner` role automatically, so it fixes the duplicate-landmark defect **and** the missing-`main` gap in the same edit. Keeps the Topbar as the single page-level banner.
  - Tradeoff: `Landing.astro:39` already has its own `<main>`, producing a nested `main` on `/` — that inner one must be demoted to a fragment or `<div>` in the same edit.
  - Confidence: HIGH — landmark role suppression by `main` ancestry is specified behavior, and the file set is tiny.
  - Blind spot: Not verified against a screen reader; no automated a11y check exists in this repo to catch a regression here later.
- **Fix B**: Demote the five per-page `<header>` elements to `<div>`.
  - Strength: Leaves the Layout untouched; zero risk of a nested-`main` mistake.
  - Tradeoff: Touches five files instead of one, and does nothing about the missing `main` landmark — the weaker of the two defects survives.
  - Confidence: HIGH — purely mechanical.
  - Blind spot: Any page added later reintroduces the same duplicate-banner bug, since nothing structural prevents it.
- **Decision**: FIXED via Fix A — `Layout.astro` now wraps `<slot />` in `<main>`; `Landing.astro`'s inner `<main>` demoted to `<div>`. Verified: lint, build, and 6/6 e2e green; exactly one `<main>` per page.

### F2 — `hideAuthCta` does not produce a logo-only header for a signed-in visitor on `/auth/confirm-email`

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/Topbar.astro:19-46
- **Detail**: Phase 4 #1's contract states that "on `/auth/*` paths the Topbar shows the logo only". In the implementation the `user ?` branch wins and `!hideAuthCta` guards only the signed-out `:` branch. Phase 3 #2 deliberately left `confirm-email.astro` without a signed-in redirect, so a signed-in visitor can reach `/auth/confirm-email` — and there they get the full email / Dashboard / Account / Sign out row, not the logo alone. Narrow, but the stated contract is not met for the one route where it is reachable.
- **Fix**: Gate the entire right-hand block on `!hideAuthCta` so both branches are suppressed on `/auth/*`.
- **Decision**: FIXED — guard hoisted to cover both branches in `Topbar.astro:19-20`. Verified: lint, build, 6/6 e2e green.

### F3 — `aria-label` on a roleless `<span>` is ARIA-prohibited, and an e2e assertion depends on it

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/Logo.astro:9
- **Detail**: `<span class:list={[...]} aria-label="10xCards">` wraps the visible text `10x` + `Cards`. Under ARIA 1.2 `aria-label` is prohibited on `role=generic`, so a conforming AT ignores it. It is harmless today only because name-from-content yields the identical string. The problem is that `tests/e2e/landing-smoke.spec.ts:22` asserts `getByLabel("10xCards")` against it, so a spec-conformance fix in any future browser or Playwright version silently breaks the test. This matches the plan's own wording, so the drift originates in the plan, not the implementation.
- **Fix**: Drop the `aria-label` from `Logo.astro:9` and re-point the assertion at the real accessible name — `getByRole("link", { name: "10xCards" })` against the anchor in `Topbar.astro:15`.
- **Decision**: FIXED — `aria-label` removed from `Logo.astro:9`; `landing-smoke.spec.ts:23` now asserts `getByRole("link", { name: "10xCards" })`. Verified: lint and 6/6 e2e green.

### F4 — `landing-smoke` uses `.first()` where two matching CTAs exist, so it never asserts which one it exercised

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/landing-smoke.spec.ts:25,30
- **Detail**: Both the Topbar and the hero render a "Log in" link, and the hero and bottom CTA band both render "Start learning free". `.first()` resolves the strict-mode collision by DOM order rather than by intent, so the spec's stated job ("header Log in" and "hero primary CTA") is not actually what it verifies — a header CTA could be deleted and the test would still pass off the hero's. The live break-and-revert confirms the routing assertion is real; the ambiguity is about which control it guards.
- **Fix**: Scope each locator to its region — `page.getByRole("banner").getByRole("link", { name: "Log in" })` and the hero `<section>` for the primary CTA — and drop `.first()`.
- **Decision**: FIXED — hero `<section>` given `aria-labelledby="hero"` (`Landing.astro:41,43`), matching the sibling sections' existing pattern; spec now scopes to `getByRole("banner")` and the hero region, with every `.first()` removed. Verified by deliberate break: renaming *only* the header CTA turns the spec red (it would have passed off the hero's link before this fix), revert turns it green.

### F5 — `public/og.png` ships at 306 KB unoptimized

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: public/og.png
- **Detail**: 1200×630 RGB PNG at 306 KB. It is correctly referenced only from the `og:image` meta tag, so no ordinary page load fetches it — this is not a runtime performance defect. But it is 5× larger than a flat brand card needs to be, and some social scrapers cap around 300 KB, which would silently drop the preview this phase exists to create.
- **Fix**: Run `oxipng -o4` or `pngquant` over `public/og.png` and re-commit; expect well under 60 KB.
- **Decision**: FIXED — 306,008 B → 140,264 B (54% smaller), still 1200×630 RGB. No `oxipng`/`pngquant` on this machine, so the re-encode went through the repo's existing `sharp` at `compressionLevel: 9, effort: 10`, fed from a raw pixel buffer. That last detail matters: `sharp` reading the PNG directly shifted colors by up to 5/255, but encoding from raw pixels is **verified pixel-identical** (`ImageChops.difference` bbox `None`, max channel delta 0). The 60 KB estimate in the original fix was optimistic — palettizing to 256 colors would have been needed to approach it, and it produced a *larger* file (102 KB) while being lossy, so lossless was the better trade. Build re-run; `dist/client/og.png` matches.

### F6 — Validation errors in `FormField` are not programmatically associated with their input

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/FormField.tsx:59
- **Detail**: The error message renders as a sibling `<p>` with no `id`, and the input carries neither `aria-describedby` nor `aria-invalid`. A screen-reader user who focuses the field never hears why it was rejected. The label/`htmlFor` pairing at `:37-46` is correct, so this is only about the error text. Pre-existing, but Phase 3 #4 rewrote exactly these lines, which is why it surfaces here.
- **Fix**: Give the error `<p>` an `id={`${id}-error`}` and add `aria-invalid={!!error}` plus `aria-describedby={error ? `${id}-error` : undefined}` to the input.
- **Decision**: FIXED — `FormField.tsx:51-52` gains `aria-invalid`/`aria-describedby` (both `undefined` when there is no error, so clean markup in the happy path) and `:61` gains `id={`${id}-error`}`. Attributes only; no label, placeholder, or validation string changed, so Phase 3 #4's contract still holds. Verified: lint, 54/54 vitest, 6/6 e2e green.

### F7 — Two benign deviations from literal "classes-only" contracts

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:6-12,25-33 and src/layouts/Layout.astro:69-73
- **Detail**: Two edits exceed their contracts without harming anything. (a) Phase 4 #2 said classes, two structural removals, and one copy line were the only permitted edits to the inner pages; `dashboard.astro` additionally refactored five hard-coded `<a>` tiles into a `TILES` array rendered with `.map()`. Link targets, labels, and order were verified identical to the pre-change markup. (b) Phase 4 #1's shell contract put the bottom border on the Topbar itself; the implementation instead introduced an extra full-bleed `<div class="border-border border-b">` wrapper in the Layout, giving an edge-to-edge rule rather than one clipped to `max-w-5xl` — arguably the better result, but an extra DOM node the contract did not describe.
- **Fix**: No code change — accept both and record them as deviations, since each is behavior-preserving or an improvement.
- **Decision**: ACCEPTED — no code change. Both deviations stand as implemented: the `TILES` array is behavior-preserving (targets, labels, order verified identical), and the full-bleed border wrapper is the better visual result than the contract's version.
