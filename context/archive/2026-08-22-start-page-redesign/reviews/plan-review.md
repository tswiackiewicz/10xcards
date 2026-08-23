<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Start Page Redesign — 10xCards Brand, Landing & App-Wide Theme

- **Plan**: `context/changes/start-page-redesign/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-22
- **Verdict**: REVISE → **SOUND after fixes** (all 8 findings fixed in the plan)
- **Findings**: 1 critical, 4 warnings, 3 observations

## Verdicts

| Dimension             | Verdict | After fixes |
| --------------------- | ------- | ----------- |
| End-State Alignment   | PASS    | PASS        |
| Lean Execution        | WARNING | PASS        |
| Architectural Fitness | WARNING | PASS        |
| Blind Spots           | FAIL    | PASS        |
| Plan Completeness     | WARNING | PASS        |

## Grounding

20/20 paths ✓, 10/10 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (4 phases, 26/26 criteria mapped; 29/29 after fixes).

`docs/reference/contract-surfaces.md` does not exist — the contract-surfaces check was skipped.

Checks that came back clean and are worth not re-litigating:

- `src/middleware.ts` sets `context.locals.user` on **every** request, not just `PROTECTED_ROUTES` — Phase 2's signed-in hero variant and Phase 3's auth-form bounce both work as specified.
- An unauthenticated e2e opt-out already exists and is per-file: `tests/e2e/risk8-route-protection-smoke.spec.ts:15` uses `test.use({ storageState: { cookies: [], origins: [] } })`. Phase 2's `landing-smoke` can mirror it with no `playwright.config.ts` change.
- `src/styles/global.css:118-122` already applies `bg-background text-foreground` to `<body>`, so Phase 4's "body's `bg-background` shows through" holds.
- Tailwind 4's default `dark:` variant **is** `prefers-color-scheme`-based — removing `global.css:4`'s `@custom-variant` override does re-enable it, as the plan claims.
- All 10 views accounted for; every Desired-End-State promise has a backing phase; the Phase 3 auth-component file list is complete (`SignInForm.tsx` carries no hard-coded colors).
- `--destructive: oklch(0.577 0.245 27.3)` computes to ~4.6:1 on the light background — the destructive text specified in Phase 1 #7 / Phase 3 #4 passes AA. The contrast problem is specific to `--primary`.

## Findings

### F1 — Primary token fails WCAG AA as a text color

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (token block) + Phase 3 §3, Phase 4 §3
- **Detail**: `--primary: oklch(0.596 0.127 163.2)` (= `#059669`) against `--primary-foreground: oklch(0.985 0 0)` (≈ `#fafafa`) computes to **3.61:1**; WCAG AA for normal text is 4.5:1. That is the label on every primary CTA ("Start learning free", "Sign up free", `SubmitButton` after Phase 1 §8 strips its purple override). Worse where the plan uses the token as a foreground: Phase 3 §3's `text-primary` auth cross-links and Phase 4 §3's `text-primary` on `bg-primary/10` success banners land under 4:1. The plan's stated escape hatch ("fine-tune L by ±0.02") cannot reach AA — that needs L ≈ 0.51, i.e. −0.086. And no phase carries a contrast gate: Phase 1's automated criteria are lint/build/test/grep only, and manual 1.9 asked merely that the button "renders the emerald primary correctly", which a 3.6:1 button does.
- **Fix A ⭐ Recommended**: Darken light `--primary` to `oklch(0.51 0.115 163.2)` (≈ `#047857`, emerald-700, ~5:1) and widen the stated tolerance to require re-measurement.
  - Strength: One value fixes button labels, `text-primary` links and tinted banners at once; same emerald family, so the "Emerald Recall" identity and the differentiation-from-blue rationale survive. Dark theme (`#34D399` on a dark foreground) already passes.
  - Tradeoff: Brand green ships one step darker than the `#059669` named in the brief's decision table, which needs updating too.
  - Confidence: HIGH — arithmetic, not taste: 3.61:1 computed for the specified pair, ~5.0:1 for `#047857`.
  - Blind spot: `--muted-foreground: oklch(0.5 0.02 165)` lands near 4.3:1 on the light background and was not re-tuned; the new contrast gate should catch it, along with the amber/violet/blue pairs in Phase 4 §3.
- **Fix B**: Keep 0.596 for fills only, add a separate `--primary-text` token.
  - Strength: Preserves `#059669` exactly as the fill color (fills only need 3:1 as a UI component, which it meets).
  - Tradeoff: A non-standard token outside the shadcn set, in a change whose whole point is collapsing 163 ad-hoc color lines into one standard vocabulary — and the Phase 4 sweep across 15+ files is exactly where the wrong green gets picked.
  - Confidence: MEDIUM — technically sound, but adds vocabulary.
  - Blind spot: Whether shadcn's Button/AlertDialog need overrides to pick up the second token.
- **Decision**: FIXED via Fix A — `--primary` and `--ring` set to `oklch(0.51 0.115 163.2)`; the tolerance note now states the 3.6:1 measurement and requires re-measurement at ≥4.5:1 for any L change (noting `--ring` only needs 3:1 as a non-text indicator); a WCAG AA contrast criterion was added to Phase 1's Manual verification (Progress 1.11) covering `--primary`/`--primary-foreground`, `--foreground`/`--background`, `--muted-foreground`/`--background`, `--destructive`/`--background` in both themes; the brief's Palette decision row updated to `#047857` light / `#34D399` dark with the reason.

### F2 — OG tags need an absolute base that may be undefined

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §5 (Layout head)
- **Detail**: `og:image` and `og:url` must be absolute — relative paths are ignored by every scraper. The only base is `Astro.site`, which `astro.config.mjs:13-18` derives from `loadEnv()`'s `SITE_URL` — documented as optional in `.env.example` ("Without it, @astrojs/sitemap logs a warning and skips") and supplied in CI from `${{ vars.SITE_URL }}`. So `${Astro.site}og.png` silently renders `undefined/og.png` on any build without `SITE_URL`, and nothing catches it: `npm run build` still passes, and manual 1.7 checked only that `/og.png` renders — which it does, while the meta tag pointing at it is broken. No production origin is recorded anywhere in the repo (`infrastructure.md`, README, CI workflows all carry none), so there is no safe fallback domain to hard-code.
- **Fix**: Resolve `const siteOrigin = Astro.site?.origin ?? null` in the frontmatter, build URLs with `new URL(…, siteOrigin)`, and render the `og:image`/`og:url`/`twitter:card` block only when `siteOrigin` is non-null — so the tags are either correct and absolute, or absent, never broken. `description`, `theme-color`, favicons and `og:title`/`og:description` stay unconditional.
  - Strength: Turns a silent prod-only failure into a checked one, without inventing a domain.
  - Tradeoff: OG previews are simply absent on builds without `SITE_URL` (including local dev unless set).
  - Confidence: HIGH — `SITE_URL`'s optionality is documented in both `.env.example` and the `astro.config.mjs` comment.
  - Blind spot: Whether `vars.SITE_URL` is actually populated in this repo's GitHub settings — not visible from the working tree.
- **Decision**: FIXED — an "Absolute-URL guard (OG only)" contract added to Phase 1 §5; manual criterion added (Progress 1.8) verifying the rendered `og:image`/`og:url` in view-source both with and without `SITE_URL`.

### F3 — Phase 4's Topbar hoist collides with the wrappers it freezes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §1 vs. Phase 4 §2
- **Detail**: §1 puts `<Topbar />` in Layout above `<slot />`. §2's contract then said "layout structure and link targets unchanged" — freezing exactly what §1 breaks. (a) All 10 page wrappers are `min-h-screen` (`dashboard.astro:8`, `generate:7`, `create:7`, `cards:18`, `study:19`, `account:22`, plus 3 auth pages); a header above a `min-h-screen` block makes every view taller than the viewport — a permanent scrollbar, compounded by `Layout.astro`'s scoped `html, body { height: 100% }`. (b) `dashboard.astro:8` and the 3 auth pages add `flex items-center justify-center`; that centering now measures against a box the header no longer shares, parking content visibly low. (c) `Topbar.astro:6` is styled as an inset card (`mb-4 … rounded-xl border`) because its only consumer today is `Welcome.astro:28`, inside that page's container; from Layout it is full-bleed and aligns with none of the pages' `mx-auto max-w-*` content (widths vary: `max-w-2xl`, `max-w-3xl`, `max-w-sm`, `max-w-4xl`).
- **Fix A ⭐ Recommended**: Give §1 a shell contract and unfreeze §2's wrappers.
  - Strength: The `min-h-screen` wrappers existed only to give `bg-cosmic` a full-height canvas — a reason §5 of the same phase deletes. Removing them is the natural consequence, not extra scope.
  - Tradeoff: §2 stops being a pure class-swap, so its diff is wider and the dual-theme QA pass has layout to check too.
  - Confidence: HIGH — grep confirms all 10 wrappers and their exact classes, and `bg-cosmic` is their only reason to exist.
  - Blind spot: Whether any page relies on `min-h-screen` for a sticky-footer effect — none seen, but not all 6 pages read in full.
- **Fix B**: Restyle Topbar as a full-width sticky app-bar; inner content just gets top padding.
  - Strength: A normal app shell; sidesteps the alignment question entirely.
  - Tradeoff: Closer to the "full app-shell/navigation redesign" the plan explicitly fenced out.
  - Confidence: MEDIUM — visually the better end state, but widens scope against a stated boundary.
  - Blind spot: Interaction with the config Banner, which Layout renders above the Topbar.
- **Decision**: FIXED via Fix A — a "Shell contract" added to Phase 4 §1 (Layout wraps Topbar in `mx-auto w-full max-w-5xl px-4`; Topbar drops its inset-card styling for a header row with a bottom border); §2's file list extended to the 3 auth pages and its contract unfrozen to remove `min-h-screen` and the `flex items-center justify-center` centering; a `grep -rn "min-h-screen" src/pages/` gate added (Progress 4.5) and manual 4.9 extended to cover header alignment and header-induced scrollbars.

### F4 — Phase 4's grep gates miss text-white and backdrop-blur

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 Success Criteria / Progress 4.3
- **Detail**: The gate list was `bg-cosmic`, `text-blue-100`, `bg-white/`, `border-white/`, `purple-`, `bg-clip-text`, `10x Astro Starter`. It omitted the two motifs with the widest footprint and the worst failure mode on a light background: `text-white` (no slash) in 19 files — 18 of them app code the sweep touches (StudyView, SavedCardsView, CandidateCard, ManualCardForm, GenerateView, AccountView, FormField, SubmitButton, all 6 inner pages, 2 auth pages), and white text on the new `bg-background` is invisible; and `backdrop-blur` in 8 files, implied dead by the glass-panel → `bg-card` mapping but never named or gated. Caveat: `src/components/ui/button.tsx:14` uses `bg-destructive text-white` legitimately (shadcn's own destructive variant, CLI-managed), so a bare grep would fail forever.
- **Fix**: Add `text-white` and `backdrop-blur` to the gate list, run with `--exclude-dir=ui`, mirrored into the Phase 4 Automated Verification bullet and Progress.
- **Decision**: FIXED — both gates added with the `--exclude-dir=ui` scoping and the reason for it; Progress 4.4 added.

### F5 — wrangler.jsonc's Worker name is the third spelling, and it must not move

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 / plan-brief "Brand spelling" decision row
- **Detail**: The repo holds three spellings: `package.json:2` `"10x-astro-starter"`, `wrangler.jsonc` `"name": "10x-cards"`, and the brand `10xCards`. Phase 1 §2 renames `package.json` to `"10xcards"` — a fourth form — while the brief claimed this "ends the 3-way name drift". It doesn't, and the invitation is dangerous: `wrangler.jsonc`'s `name` is the deployed Worker's identity. Renaming it makes the next `wrangler deploy` (which CI runs automatically on every push to `master`) create a brand-new Worker with no secrets and no routes, while the old one keeps serving. The plan's "no other manifest changes" note is scoped to `package.json`, and nothing flagged this string as load-bearing.
- **Fix**: Add `wrangler.jsonc`'s `name` to "What We're NOT Doing" with the one-line reason; drop/qualify the brief's drift claim.
- **Decision**: FIXED — scope fence added to "What We're NOT Doing"; the brief's Brand-spelling row rewritten to say the rename fixes the user-visible name only and that the Worker name is explicitly out of scope.

### F6 — Phase 1's Polish gate can't see the strings it's guarding

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria / Progress 1.5
- **Detail**: The gate was `grep -rnE "[ąćęłńóśźż]" src/`, labelled "No Polish user-visible text". Only `src/lib/config-status.ts` matches today. The other two Polish strings — `Layout.astro:25` "Uwaga:" and `:30` "Dokumentacja" — carry no diacritics, so criterion 1.5 goes green whether or not Phase 1 §5's translation happened.
- **Fix**: `grep -rnE "[ąćęłńóśźż]|Uwaga|Dokumentacja" src/`.
- **Decision**: FIXED — literals added to the gate and to Progress 1.5, with the reason recorded inline.

### F7 — Hex comments sit on the wrong tokens

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 CSS block
- **Detail**: `--primary-foreground: oklch(0.985 0 0); /* #059669 */` and, in the dark block, `--primary-foreground: oklch(0.2 0.03 165); /* #34D399 */`. Both hexes describe the `--primary` line above them, not the foreground. A literal-minded implementer sets `primary-foreground` to the emerald hex and gets emerald-on-emerald buttons.
- **Fix**: Move each comment up one line onto its `--primary` declaration.
- **Decision**: FIXED — comments moved; the light one updated to `≈ #047857` per F1.

### F8 — Chart and sidebar palettes specified for surfaces that don't exist

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §1 ("charts: emerald/amber/teal/blue/violet family; sidebar-\* mirror card/primary")
- **Detail**: `src/components/ui/` holds exactly three files — `alert-dialog.tsx`, `button.tsx`, `LibBadge.astro` (deleted this phase). Nothing in `src/` references `chart-*` or `sidebar-*` outside `global.css`'s own `@theme inline` mappings. That's 13 hand-tuned values (5 chart + 8 sidebar) with zero consumers and no phase that adds one.
- **Fix**: Leave the existing stock values untouched; note they're inert until a chart or sidebar component lands.
- **Decision**: FIXED — the re-tuning instruction replaced with an explicit "leave stock, retune when a consumer lands" note.
