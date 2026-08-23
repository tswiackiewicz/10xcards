# Start Page Redesign — 10xCards Brand, Landing & App-Wide Theme Implementation Plan

## Overview

Replace the untouched 10x Astro Starter start page with a real 10xCards landing page, and move the whole app from the starter's faked-dark "cosmic" look onto a proper two-theme (light default + system dark) shadcn token system with the **Emerald Recall** palette, a self-hosted **Space Grotesk** typeface, a **10xCards** logo/favicon/OG brand kit, and English-only UI copy. Along the way, close the auth-funnel gaps the research surfaced (post-sign-in landing, signed-in visitors on `/` and `/auth/*`).

## Current State Analysis

From `context/changes/start-page-redesign/research.md` (commit `4cb3683`):

- `/` renders `src/components/Welcome.astro` — 100% starter marketing copy; H1 and default `<title>` say "10x Astro Starter"; the product name appears nowhere in the UI.
- Two disconnected styling layers: a full shadcn oklch token set in `src/styles/global.css` that almost nothing consumes, and ~163 hard-coded color lines across 22 files (`text-blue-100/*`, `bg-white/5` glass, purple links/CTAs, `bg-cosmic` hex gradient on all 10 views). Dark mode is class-gated (`@custom-variant dark`) but no `.dark` class is ever set.
- Exactly 6 Polish user-visible strings, all in the missing-config banner path (`src/lib/config-status.ts`, `src/layouts/Layout.astro:25,30`).
- Auth flow: post-sign-in redirects to `/` (`src/pages/api/auth/signin.ts:34`); signed-in users see the starter pitch on `/`; `/auth/signin`+`/auth/signup` render forms to signed-in users. Topbar exists only on `/` and shows no brand.
- No fonts, no meta description/OG, 733 B starter favicon, orphaned 1.27 MB `public/template.png`, dead `src/components/ui/LibBadge.astro`.
- CI coupling: `tests/e2e/risk8-route-protection-smoke.spec.ts:27` asserts the starter H1 on `/`; `tests/integration/risk8-protected-routes-oracle.test.ts:31-32` pins the exact page set; e2e sign-in setup (`tests/e2e/auth.setup.ts`) uses label/copy selectors. **No test asserts colors.**

## Desired End State

- `/` is a 10xCards landing page: branded header (logo + "Log in" ghost + filled sign-up CTA), outcome-first hero with a CSS flashcard mock, "How it works" (3 steps), 3-feature row, privacy trust line, bottom CTA band, minimal footer. Signed-in visitors see an "Open dashboard" hero variant.
- All 10 views render correctly in **both** themes (light default, dark via `prefers-color-scheme`), styled through semantic shadcn tokens carrying the Emerald Recall palette; hue-coded semantics (FSRS grades, AI/Manual badges, error/success, pending-amber) keep explicit Tailwind classes with `dark:` variants.
- Space Grotesk (variable, self-hosted via `@fontsource-variable`) is the app typeface.
- Brand kit shipped: `Logo` component, SVG favicon (+PNG/apple-touch fallbacks), static `og.png`, meta description/OG tags, `10xCards` in `<title>`s and `package.json`.
- Zero Polish user-visible strings; zero starter branding (`10x Astro Starter`, starter repo URLs, `template.png`, `LibBadge`) anywhere in `src/`.
- Post-sign-in lands on `/dashboard`; signed-in users hitting `/auth/signin`/`/auth/signup` are bounced to `/dashboard`.
- CI green: updated `risk8` heading assertion + `auth.setup.ts`, new landing smoke e2e.

Verify: run the Phase 4 grep gates plus the full suite (`npx astro sync && npm run lint && npm run build && npm test && npm run test:e2e`) and review every view under macOS light/dark appearance.

### Key Discoveries

- The dark look is faked with alpha-white utilities over `bg-cosmic`; tokens are dead weight today (`global.css:6-111` vs. 1 consuming line in app code, `AccountView.tsx:118`).
- The hard-coded classes cluster into ~12 recurring motifs (research §3), so the sweep is systematic, not creative.
- All inline SVGs and lucide icons are `currentColor` — recoloring is free; the only fixed-color leftovers are `Banner.astro`'s scoped-CSS hexes, `SubmitButton.tsx:18`'s purple override, and the `bg-cosmic`/star-field CSS.
- All 7 PRD capabilities are shipped (roadmap: everything done) — every landing claim below is honest.
- `tests/integration/risk8-protected-routes-oracle.test.ts` fails on any _new_ page under `src/pages/**` — this plan adds none (landing replaces `Welcome` on the same route).

## What We're NOT Doing

- No new public pages (`/pricing`, `/about`, FAQ) — keeps the protected-routes oracle untouched.
- No fabricated social proof, ratings, user counts, or the "75% accepted" quality bar (internal target, not a measured stat).
- No theme _toggle_ UI — theme follows the system (`prefers-color-scheme`) only.
- No full app-shell/navigation redesign: Topbar goes global with the logo, but per-page "← Dashboard" links stay.
- No changes to AI card-content language (`src/lib/flashcards/generation.ts:30` keeps "same language as the source text" — user data, not UI chrome).
- No visual-regression/screenshot tests; no changes to middleware `PROTECTED_ROUTES`, API contracts, or DB.
- **No rename of `wrangler.jsonc`'s `"name": "10x-cards"`** — that string is the deployed Worker's identity, not a brand label. Changing it makes the next `wrangler deploy` (which CI runs on every push to `master`) provision a _new_ Worker with no secrets and no routes while the old one keeps serving traffic. The `package.json` rename in Phase 1 #2 is cosmetic and unrelated; it does not make the repo's names uniform, and it must not be "finished" by touching this one.
- No social login, password-reset flow work, or i18n framework.

## Implementation Approach

Four phases, each independently committable and CI-green. Phase 1 lays the invisible foundation (tokens, font, brand assets, English banner) while leaving old views on their transitional cosmic styling — `bg-cosmic` survives until Phase 4 so intermediate states stay readable. Phase 2 rebuilds the landing (the only page users see logged-out) together with its coupled e2e specs. Phase 3 re-skins auth views and closes the auth-funnel gaps. Phase 4 hoists the Topbar into the Layout, sweeps all inner views onto tokens + `dark:` semantics, deletes `bg-cosmic`, and enforces grep gates that prove the old vocabulary is gone.

## Critical Implementation Details

- **Dark-variant mechanism**: remove `@custom-variant dark (&:is(.dark *))` from `global.css:4` — Tailwind 4's _default_ `dark:` variant is already `prefers-color-scheme`-based, so removing the override re-enables it. Move the `.dark { … }` token block into `@media (prefers-color-scheme: dark) { :root { … } }`. Add `color-scheme: light` on `:root` and `color-scheme: dark` inside the media block so native form controls/scrollbars follow.
- **Ordering**: `@utility bg-cosmic` and the per-page cosmic wrappers must survive Phases 1–3 (inner views depend on the dark ground for their alpha-white text). Delete only in Phase 4. Transitional mixed states (emerald buttons on cosmic bg) are acceptable — CI asserts no colors.
- **E2E**: every new/edited spec navigates via `gotoAndWaitForHydration`/`reloadAndWaitForHydration` from `tests/e2e/navigate.ts` (AGENTS.md rule). `auth.setup.ts`'s exact post-login assertion wasn't captured by research — read it before editing in Phase 3 and update its expected URL from `/` to `/dashboard`.
- **Space Grotesk has no italic axis** — don't introduce italic styles; use weight/color for emphasis.
- **Success/primary share the green family** (accepted tradeoff): success feedback uses tint-weight banners (`…/10` backgrounds), primary uses solid fills — distinction comes from weight, not hue.

## Phase 1: Theme Foundation & Brand Assets

### Overview

Ship the new token system (Emerald Recall, light + system dark), typeface, logo/favicon/OG kit, English config banner, and starter-debt cleanup — without touching page layouts. App still looks transitional; CI green.

### Changes Required:

#### 1. Token system & font

**File**: `src/styles/global.css`

**Intent**: Replace the stock neutral shadcn tokens with the Emerald Recall palette in both themes; switch dark mode from class-gated to system media; register Space Grotesk as the app font. Keep `@theme inline` mappings and `--radius` as-is; keep `@utility bg-cosmic` for now (deleted in Phase 4).

**Contract**: `:root` carries light values, `@media (prefers-color-scheme: dark) { :root { … } }` carries dark values (replacing the `.dark` block); `@custom-variant dark` line removed; `@theme` gains `--font-sans: "Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif;` and `@import "@fontsource-variable/space-grotesk";` sits with the other imports. Target values below are already contrast-checked: light `--primary` is set at L 0.51 (≈ `#047857`, emerald-700) because the brighter `#059669` gives only **3.6:1** against `--primary-foreground` — under AA's 4.5:1 for the CTA label, and worse for the `text-primary` uses in Phases 3–4. Hue/chroma stay; the implementer may fine-tune L by ±0.02 **only if the resulting foreground/background pair is re-measured at ≥4.5:1** (`--ring` is a non-text indicator and only needs 3:1):

```css
:root {
  /* light */
  color-scheme: light;
  --background: oklch(0.985 0.005 160);
  --foreground: oklch(0.19 0.015 165);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.19 0.015 165);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.19 0.015 165);
  --primary: oklch(0.51 0.115 163.2); /* ≈ #047857 */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.95 0.01 160);
  --secondary-foreground: oklch(0.25 0.02 165);
  --muted: oklch(0.95 0.01 160);
  --muted-foreground: oklch(0.5 0.02 165);
  --accent: oklch(0.94 0.015 160);
  --accent-foreground: oklch(0.25 0.02 165);
  --destructive: oklch(0.577 0.245 27.3);
  --border: oklch(0.9 0.01 160);
  --input: oklch(0.9 0.01 160);
  --ring: oklch(0.51 0.115 163.2);
  /* chart-* and sidebar-*: leave the existing stock values untouched. Nothing in
     src/ consumes them (src/components/ui/ holds only alert-dialog.tsx and
     button.tsx after LibBadge is deleted), and no phase adds a chart or sidebar —
     re-tuning 13 values with zero consumers is work with no observable effect.
     Retune when a component that reads them actually lands. */
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --background: oklch(0.17 0.012 165);
    --foreground: oklch(0.97 0.005 160);
    --card: oklch(0.21 0.015 165);
    --card-foreground: oklch(0.97 0.005 160);
    --popover: oklch(0.21 0.015 165);
    --popover-foreground: oklch(0.97 0.005 160);
    --primary: oklch(0.773 0.153 163.2); /* ≈ #34D399 */
    --primary-foreground: oklch(0.2 0.03 165);
    --secondary: oklch(0.26 0.015 165);
    --secondary-foreground: oklch(0.97 0.005 160);
    --muted: oklch(0.26 0.015 165);
    --muted-foreground: oklch(0.7 0.02 160);
    --accent: oklch(0.26 0.02 165);
    --accent-foreground: oklch(0.97 0.005 160);
    --destructive: oklch(0.704 0.191 22.2);
    --border: oklch(1 0 0 / 12%);
    --input: oklch(1 0 0 / 16%);
    --ring: oklch(0.773 0.153 163.2);
  }
}
```

#### 2. Font dependency

**File**: `package.json` (+ lockfile)

**Intent**: Add `@fontsource-variable/space-grotesk` as a regular dependency (self-hosted woff2, Workers-compatible; no external font hosts). Also rename the package to `10xcards` and add a `description` ("AI-generated flashcards with spaced repetition study").

**Contract**: root `npm install @fontsource-variable/space-grotesk`; `name`/`description` fields updated; no other manifest changes.

#### 3. Logo component

**File**: `src/components/Logo.astro` (new)

**Intent**: Single source of the brand mark: inline SVG glyph (two stacked rounded-rect cards, offset/rotated, `fill="currentColor"`, front card cut with a 4-point sparkle) + wordmark "10xCards" — "10x" in `text-primary`, "Cards" in `text-foreground`. Themeable via `currentColor`/tokens; legible at 16 px (2 shapes, no thin strokes).

**Contract**: `<Logo />` renders `<span class="inline-flex items-center gap-2">` with the svg (`aria-hidden`) and the wordmark text; component takes no props beyond optional `class`; carries `aria-label="10xCards"` on the wrapper. Consumers wrap it in their own `<a href="/">`.

#### 4. Favicon & OG kit

**File**: `public/favicon.svg` (new), `public/favicon.png` (replace), `public/apple-touch-icon.png` (new), `public/og.png` (new)

**Intent**: Derive the favicon from the glyph alone (SVG with an embedded `@media (prefers-color-scheme: dark)` fill swap; 32 px PNG fallback; 180 px apple-touch). Generate `og.png` (1200×630: glyph + "10xCards" + hero sub-headline on the brand background) once, offline — e.g. a throwaway HTML file screenshotted with the repo's Playwright — and commit the static file. Delete `public/template.png`.

**Contract**: four static assets in `public/`; no runtime generation; `template.png` removed.

#### 5. Layout head & English banner shell

**File**: `src/layouts/Layout.astro`

**Intent**: Brand the document head and finish the banner's English copy. Default/branded title pattern, meta description, OG/Twitter tags, theme-color pair, favicon links.

**Contract**: title resolves as `title ? `${title} · 10xCards` : "10xCards — AI flashcards you'll actually remember"`; head gains `<meta name="description">` ("Paste your notes, review AI-drafted flashcards, and remember them with spaced repetition."), `og:title/description/image/type/url` + `twitter:card`, `<link rel="icon" type="image/svg+xml">` + PNG fallback + apple-touch-icon, and two `<meta name="theme-color">` entries (light/dark via `media`). Line 25 `Uwaga:` → `Warning:`; line 30 fallback `Dokumentacja` → `Documentation`. Body/slot structure unchanged in this phase.

**Absolute-URL guard (OG only)**: `og:image` and `og:url` must be absolute — relative paths are ignored by every scraper. The only base available is `Astro.site`, which `astro.config.mjs:13-18` derives from `loadEnv()`'s `SITE_URL` — **optional** (`.env.example`: "Without it, @astrojs/sitemap logs a warning and skips") and supplied in CI from `${{ vars.SITE_URL }}`. So `${Astro.site}og.png` silently renders `undefined/og.png` on any build without `SITE_URL`, and `npm run build` still passes. No production origin is recorded anywhere in the repo, so don't invent a fallback: resolve `const siteOrigin = Astro.site?.origin ?? null;` in the frontmatter, build the URLs with `new URL("/og.png", siteOrigin)` / `new URL(Astro.url.pathname, siteOrigin)`, and render the `og:image`/`og:url`/`twitter:card` block **only when `siteOrigin` is non-null**. Either the tags are correct and absolute, or they're absent — never broken. `description`, `theme-color`, favicons and `og:title`/`og:description` are unconditional. Set `SITE_URL` in the local `.env` when verifying manually.

#### 6. Config-status strings

**File**: `src/lib/config-status.ts`

**Intent**: Translate the 4 Polish banner strings to English and stop pointing users at the starter's GitHub docs.

**Contract**: messages become "Supabase is not configured — authentication features are disabled." / "OpenRouter is not configured — AI flashcard generation is disabled."; `docsLabel` "See setup instructions"; `docsUrl` → `https://github.com/tswiackiewicz/10xcards#readme`.

#### 7. Banner restyle

**File**: `src/components/Banner.astro`

**Intent**: Replace the scoped-`<style>` raw-hex light-only styling with token utilities so the banner works in both themes.

**Contract**: variant map in class strings — `error`: `border-destructive/40 bg-destructive/10 text-destructive`; `warning`: amber pair with `dark:` variant; `info`: `border-primary/40 bg-primary/10`; scoped `<style>` block deleted; `role` logic unchanged.

#### 8. SubmitButton token compliance

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Delete the `bg-purple-600 hover:bg-purple-500 text-white` override so the button obeys `--primary`; retint the CSS spinner to `border-primary-foreground/30 border-t-primary-foreground`.

**Contract**: shadcn `Button` default variant, no color `className` overrides.

#### 9. Dead-code cleanup

**File**: `src/components/ui/LibBadge.astro` (delete), `README.md`

**Intent**: Remove the unused starter badge component; fix README's clone instructions to reference this repo instead of `przeprogramowani/10x-astro-starter`.

**Contract**: file deleted (zero imports exist); README lines 41-42 point at `tswiackiewicz/10xcards`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint` passes
- `npm run build` passes
- `npm test` passes (Vitest — oracle untouched)
- `npm run test:e2e` passes (nothing coupled touched in this phase)
- No Polish user-visible text: `grep -rnE "[ąćęłńóśźż]|Uwaga|Dokumentacja" src/ --include="*"` returns nothing — the two literals are required because `Layout.astro:25`/`:30` carry no diacritics, so a diacritics-only gate passes whether or not change #5 landed
- Starter debt gone: `public/template.png` and `src/components/ui/LibBadge.astro` deleted; `grep -rn "10x-astro-starter" src/ package.json` returns nothing

#### Manual Verification:

- Browser tab shows the new favicon in both system themes; `/og.png` renders as a 1200×630 brand card
- With `SITE_URL` set locally, view-source on `/` shows `og:image` and `og:url` as **absolute** URLs (not `undefined/…`, not relative); with `SITE_URL` unset, those two tags are absent rather than malformed
- With `SUPABASE_URL` unset locally, the config banner renders in English with token styling (readable in both themes)
- A shadcn `Button` (e.g. dashboard sign-out or delete dialog) renders the emerald primary correctly — transitional cosmic backgrounds elsewhere are expected and OK
- WCAG AA contrast measured in both themes for the text-bearing token pairs: `--primary`/`--primary-foreground`, `--foreground`/`--background`, `--muted-foreground`/`--background`, `--destructive`/`--background` — each ≥4.5:1 (no CI check exists for color, so this is the only gate)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Landing Page

### Overview

Replace the starter Welcome with the 10xCards landing (fully token-based, both themes), rewrite the Topbar as the branded header, adapt the hero for signed-in visitors, and land the coupled e2e updates (risk8 heading) plus a new landing smoke spec.

### Changes Required:

#### 1. Landing component

**File**: `src/components/Landing.astro` (new; delete `src/components/Welcome.astro`)

**Intent**: The full landing per the research checklist (P0+P1), pure static Astro (zero islands), token-styled. Sections top-to-bottom: `<Topbar />`; hero; flashcard mock; "How it works" (3 steps); 3-feature row; privacy line; bottom CTA band; footer. Signed-out hero: H1 **"Paste your notes. Remember them forever."**, sub-headline "10xCards turns text you already have into AI-drafted flashcards — you accept, edit, or reject each one, then study them on a spaced-repetition schedule. Free." Primary CTA "Start learning free" → `/auth/signup`, secondary outline "Log in" → `/auth/signin`. Signed-in variant (branch on `Astro.locals.user`): sub-line "Welcome back." and a single primary CTA "Open dashboard" → `/dashboard`.

**Contract**: content sections use semantic HTML (`<header>` via Topbar, `<main>`, `<section>` with headings, `<footer>`); headings are solid `text-foreground` (no `bg-clip-text` gradients anywhere in the new design); copy is English and advertises only shipped capabilities: steps = Paste your text (up to 10,000 characters) → Review AI-drafted cards → Study on schedule (FSRS); features = human-gated AI generation (with AI/Manual provenance), built-in spaced repetition (Again/Hard/Good/Easy), private by default (your deck is yours alone; delete anytime with a 30-day recovery window); privacy line = "Your source text is never shown to other users and never reused beyond your request."; footer = © 10xCards + GitHub repo link. `src/pages/index.astro` imports `Landing` instead of `Welcome`.

#### 2. Flashcard mock (hero visual)

**File**: inside `src/components/Landing.astro` (or a small `src/components/landing/CardMock.astro` if it keeps Landing readable)

**Intent**: An honest, CSS-only front/back flashcard pair — front shows a question, back the answer, with a small "AI" provenance badge — styled with `bg-card border-border shadow` tokens so it themes automatically. Slight offset/rotation for depth; no JS.

**Contract**: static markup + Tailwind classes only; decorative attributes hidden from AT where appropriate.

#### 3. Topbar as branded header

**File**: `src/components/Topbar.astro`

**Intent**: Rewrite as the app's brand header. Left: `<a href="/"><Logo /></a>`. Right, signed-out: "Log in" ghost link → `/auth/signin` + filled "Sign up free" → `/auth/signup` (use `buttonVariants` from `@/components/ui/button` for anchors). Right, signed-in: user email (`text-muted-foreground`), Dashboard, Account links, Sign out form button — all token-styled. In this phase Topbar is still rendered only by `Landing.astro`; it moves into the Layout in Phase 4.

**Contract**: accepts an optional prop to hide the auth CTAs (used by auth pages in Phase 4); all colors via tokens; no `purple-*`/`white/*` classes remain in the file.

#### 4. Coupled + new e2e specs

**File**: `tests/e2e/risk8-route-protection-smoke.spec.ts`, `tests/e2e/landing-smoke.spec.ts` (new)

**Intent**: Update the `/` heading assertion to the new H1; add a smoke spec proving the landing's one job — explain and route: H1 visible, logo visible, header "Log in" navigates to `/auth/signin`, hero primary CTA navigates to `/auth/signup`.

**Contract**: both specs navigate via `gotoAndWaitForHydration` (`tests/e2e/navigate.ts`); locators are `getByRole`-first; the smoke runs unauthenticated (no storageState) — mirror how existing unauthenticated specs opt out of the auth setup project.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npm run build` passes
- `npm test` passes (`/` unchanged in the page-set oracle)
- `npm run test:e2e` passes, including updated `risk8-route-protection-smoke` and new `landing-smoke`

#### Manual Verification:

- Landing reads correctly in both system themes: hero, card mock, steps, features, privacy line, footer — no unreadable surfaces
- Signed-in visit to `/` shows the "Open dashboard" hero variant and the signed-in Topbar
- Deliberate-break check: temporarily point the hero CTA at a wrong route → `landing-smoke` fails; revert → green (proves the smoke guards routing)
- Copy proofread — English only, no unshipped claims

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Auth Flow & Auth Views

### Overview

Close the funnel: post-sign-in lands on `/dashboard`, signed-in visitors are bounced off the auth forms; re-skin the three auth pages and all auth components onto tokens; update the e2e auth setup.

### Changes Required:

#### 1. Post-sign-in redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Successful sign-in redirects to `/dashboard` instead of `/`. The pending-deletion branch (→ `/account`) stays untouched.

**Contract**: line 34 `context.redirect("/")` → `context.redirect("/dashboard")`; no other logic changes.

#### 2. Signed-in bounce on auth forms

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: A signed-in user visiting either form is redirected to `/dashboard` (frontmatter guard; `confirm-email` intentionally left accessible).

**Contract**: `if (Astro.locals.user) return Astro.redirect("/dashboard");` at the top of both frontmatters. Middleware and `PROTECTED_ROUTES` untouched — both routes stay public for anonymous visitors, so the protected-routes oracle is unaffected.

#### 3. Auth pages re-skin

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Replace cosmic wrappers and gradient H1s with the token design: `bg-background` page (drop `bg-cosmic` here), centered `bg-card border-border rounded-xl shadow-sm` auth card, solid `text-foreground` headings, `text-muted-foreground` helper text, `text-primary` cross-links; add the `Logo` above the card as the brand anchor (linked to `/`).

**Contract**: copy unchanged (labels/strings are e2e selectors); only structure/classes change.

#### 4. Auth components re-skin

**File**: `src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `ServerError.tsx`, `SignUpForm.tsx` (hint line)

**Intent**: Token-compliant fields: inputs `border-input bg-transparent text-foreground placeholder:text-muted-foreground focus:ring-ring`; error state `border-destructive focus:ring-destructive`, error text `text-destructive`; toggle `text-muted-foreground hover:text-foreground`; ServerError `border-destructive/40 bg-destructive/10 text-destructive`; password hint `text-muted-foreground`.

**Contract**: labels, placeholders, and validation strings unchanged (e2e selectors); only classes change.

#### 5. E2E auth expectations

**File**: `tests/e2e/auth.setup.ts` (+ any spec asserting the post-login URL)

**Intent**: Read the current post-login assertion first, then update the expected destination from `/` to `/dashboard`. Sweep `tests/e2e/**` for other `/`-after-login or auth-page assumptions and align them.

**Contract**: selectors stay label-based ("Email", "Password", "Sign in"); only URL expectations change.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npm run build` passes
- `npm test` passes
- `npm run test:e2e` passes, including the updated `auth.setup.ts`
- `grep -rn "purple-" src/components/auth src/pages/auth` returns nothing

#### Manual Verification:

- Full loop: sign-up → confirm-email interstitial → sign-in → lands on `/dashboard`; sign-out → lands on `/`
- Signed-in direct visits to `/auth/signin` and `/auth/signup` bounce to `/dashboard`
- Failed sign-in shows the destructive-styled ServerError; forms legible in both themes

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: App-Wide Sweep & Global Shell

### Overview

Hoist the Topbar into the Layout for every page, sweep all inner views and React islands onto tokens (+ `dark:` variants for hue-coded semantics), delete `bg-cosmic`, and prove the old vocabulary is gone with grep gates. Close the docs loose ends.

### Changes Required:

#### 1. Global Topbar

**File**: `src/layouts/Layout.astro`, `src/components/Topbar.astro`, `src/components/Landing.astro`

**Intent**: Layout renders `<Topbar />` above `<slot />` on every page; on `/auth/*` paths the Topbar shows the logo only (auth CTAs hidden — the visitor is already on the form). Remove the Topbar render from `Landing.astro` (it now arrives via Layout).

**Contract**: path detection via `Astro.url.pathname.startsWith("/auth/")` (in Layout, passed as the Phase-2 prop); signed-in row identical on all pages; per-page "← Dashboard" links remain untouched.

**Shell contract** (the hoist changes page geometry, so it can't be class-only): Layout wraps the Topbar in its own container — `<div class="mx-auto w-full max-w-5xl px-4"><Topbar /></div>` — because page content widths differ (`max-w-2xl` on study/account, `max-w-3xl` on generate/create/cards, `max-w-sm` auth cards, `max-w-4xl` landing) and there is no single width to inherit. Topbar itself drops its inset-card styling (`Topbar.astro:6`'s `mb-4 … rounded-xl border`, which only made sense while its sole consumer was `Welcome.astro:28`, inside that page's container) in favour of a plain header row with a bottom border. Change #2 then removes the per-page `min-h-screen` wrappers — see there.

#### 2. Inner pages re-skin

**File**: `src/pages/dashboard.astro`, `generate.astro`, `create.astro`, `cards.astro`, `study.astro`, `account.astro`, plus the three `src/pages/auth/*.astro` wrappers (for the `min-h-screen` removal only — their re-skin already landed in Phase 3)

**Intent**: Replace the cosmic shell on each page: drop `bg-cosmic` (body's `bg-background` shows through), glass panels → `bg-card border-border rounded-xl`, gradient H1s → solid `text-foreground` semibold, body/copy `text-muted-foreground`, back-links `text-muted-foreground hover:text-foreground`, dashboard tiles → `bg-card border-border hover:bg-accent`. Replace the starter-flavored dashboard line "This page is only for authenticated users." with product copy ("Pick up where you left off.").

Also **drop the `min-h-screen` page wrappers** (`dashboard.astro:8`, `generate.astro:7`, `create.astro:7`, `cards.astro:18`, `study.astro:19`, `account.astro:22`, and the three auth pages). They existed only to give `bg-cosmic` a full-height canvas to paint; that reason disappears with change #5, and once change #1 puts a header above them every view becomes taller than the viewport — a permanent scrollbar, compounded by `Layout.astro`'s scoped `html, body { height: 100% }`. For the same reason, drop `flex items-center justify-center` from `dashboard.astro:8` and the auth pages: with a header above, that vertical centering measures against a box the header no longer shares and parks content visibly low. Replace with normal top-aligned flow plus vertical padding (auth cards keep `mx-auto max-w-sm`).

**Contract**: link targets and content order unchanged; classes, the two structural removals above, and that one copy line are the only edits.

#### 3. Flashcard islands re-skin

**File**: `src/components/flashcards/GenerateView.tsx`, `ManualCardForm.tsx`, `CandidateCard.tsx`, `SavedCardsView.tsx`, `StudyView.tsx`

**Intent**: Apply the motif mapping — surfaces/text/inputs/links via tokens; hue-coded semantics keep Tailwind hues with explicit light+`dark:` pairs:

- textareas/inputs: `border-input bg-transparent text-foreground focus:border-ring focus:ring-ring`
- labels/eyebrows/counters: `text-muted-foreground`; over-limit counters and inline errors: `text-destructive`
- error banners: `border-destructive/40 bg-destructive/10 text-destructive`
- success banners & accepted candidate state: primary-tinted (`border-primary/40 bg-primary/10 text-primary`) — weight distinguishes from solid-primary CTAs
- FSRS grades keep the red/orange/blue/green scale as light/dark pairs, e.g. Again: `border-red-300 bg-red-50 text-red-700 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-200` (same pattern for Hard/Good/Easy)
- AI badge → violet pair (`border-violet-300 bg-violet-50 text-violet-700 dark:…`), Manual badge → blue pair; rejected candidate: `opacity-50` + muted borders

**Contract**: all copy, ERROR_COPY maps, placeholders, and aria attributes unchanged (several are e2e selectors); only class strings change.

#### 4. Account island re-skin

**File**: `src/components/account/AccountView.tsx`

**Intent**: Same mapping; pending-deletion card keeps amber semantics as a light/dark pair (`border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200`); danger zone → destructive tokens; the confirm input (already token-based, line 118) stays.

**Contract**: copy and dialog flow unchanged.

#### 5. Kill the cosmic layer

**File**: `src/styles/global.css`

**Intent**: Delete `@utility bg-cosmic` — the final consumer disappeared in change #2. (The star-field inline style died with `Welcome.astro` in Phase 2.)

**Contract**: no `bg-cosmic` reference anywhere in `src/`.

#### 6. Docs loose ends

**File**: `context/foundation/lessons.md`

**Intent**: Append the owner mandate as a lesson so future changes inherit it: UI copy is English-only (user-facing strings, titles, meta, emails); AI-generated card _content_ follows the source text's language by design.

**Contract**: append-only entry in the existing lesson format (Context/Problem/Rule/Applies to).

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npm run build` passes
- `npm test && npm run test:e2e` passes (full suite)
- Grep gates all return zero hits in `src/`: `bg-cosmic`, `text-blue-100`, `bg-white/`, `border-white/`, `purple-`, `bg-clip-text`, `10x Astro Starter` (also zero in `tests/`)
- Two more gates, run with `--exclude-dir=ui` (shadcn's CLI-managed `src/components/ui/button.tsx:14` uses `bg-destructive text-white` legitimately and must stay): `grep -rn --exclude-dir=ui "text-white" src/` and `grep -rn --exclude-dir=ui "backdrop-blur" src/` both return nothing. These are the two widest motifs — `text-white` sits in 18 files of app code and is _invisible_ on the new light `--background`; `backdrop-blur` in 8, implied dead by the glass-panel → `bg-card` mapping but never named until now
- `grep -rn "min-h-screen" src/pages/` returns nothing (proves the full-height cosmic wrappers are gone, so the hoisted Topbar doesn't push every view past the viewport)

#### Manual Verification:

- Every view (landing, 3 auth, dashboard, generate, create, cards, study, account) reviewed under macOS light and dark appearance — no unreadable text or surfaces
- Study grade buttons, AI/Manual badges, and the pending-deletion card legible in both themes
- Delete-card AlertDialog + confirm-phrase input correct in both themes
- Global Topbar behaves: logo-only on auth pages, full nav elsewhere, signed-in row consistent; header aligns with page content, and no view gains a scrollbar or drops its content low purely from the header

**Implementation Note**: Final phase — after verification, the change is ready for `/10x-impl-review` and archive.

---

## Testing Strategy

### Unit Tests:

- No new unit surface (styling change); existing Vitest suite guards the page-set oracle and API logic — run per phase.
- Oracle stays valid: no pages added/removed; `/` remains public.

### Integration Tests:

- `risk8-protected-routes-oracle` — untouched, must stay green every phase.

### Manual Testing Steps:

1. Toggle macOS appearance light↔dark on each view; check text/surface contrast, focus rings, scrollbars (color-scheme).
2. Logged-out funnel: `/` → "Start learning free" → sign-up → confirm-email → sign-in → `/dashboard`.
3. Logged-in: visit `/` (adapted hero), `/auth/signin` (bounce), full CRUD + study loop for visual regressions.
4. Unset `SUPABASE_URL` locally → English token-styled banner on every page.

## Performance Considerations

- Landing stays zero-JS (no islands); Space Grotesk variable woff2 (latin) adds ~35–50 kB — imported once via `global.css`.
- Deleting `template.png` removes 1.27 MB from every deploy; `og.png` is static (no runtime generation on Workers).

## Migration Notes

No DB/API migrations. Each phase is one Conventional Commit, independently revertable. Risk concentrates in Phase 4's breadth — it is mechanical (motif mapping above) and gated by greps + full suite.

## References

- Related research: `context/changes/start-page-redesign/research.md` (inventory tables §1–§3, competitor conventions §6–§7, palette §8, logo §9, test coupling §10)
- Prior UI idioms: `context/archive/2026-07-02-ux-improvements/` (inline banners, no toasts), `context/archive/2026-07-01-manual-card-authoring/plan.md` (page-shell contract)
- Hydration-safe e2e helpers: `tests/e2e/navigate.ts` (AGENTS.md rule)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Theme Foundation & Brand Assets

#### Automated

- [x] 1.1 `npx astro sync && npm run lint` passes — 1c51e90
- [x] 1.2 `npm run build` passes — 1c51e90
- [x] 1.3 `npm test` passes — 1c51e90
- [x] 1.4 `npm run test:e2e` passes — 1c51e90
- [x] 1.5 No Polish in `src/`: diacritics + `Uwaga`/`Dokumentacja` grep clean — 1c51e90
- [x] 1.6 Starter debt gone: `template.png` + `LibBadge.astro` deleted, no `10x-astro-starter` in `src/`/`package.json` — 1c51e90

#### Manual

- [x] 1.7 Favicon (both themes) + `og.png` render correctly — 1c51e90
- [x] 1.8 `og:image`/`og:url` absolute in view-source with `SITE_URL` set; absent (not malformed) without it — 1c51e90
- [x] 1.9 Config banner renders in English, token-styled, both themes — 1c51e90
- [x] 1.10 shadcn Button/AlertDialog show emerald primary correctly — 1c51e90
- [x] 1.11 WCAG AA contrast (≥4.5:1) measured for the text-bearing token pairs in both themes — 1c51e90

### Phase 2: Landing Page

#### Automated

- [x] 2.1 `npx astro sync && npm run lint && npm run build` passes — 9a1dc68
- [x] 2.2 `npm test` passes — 9a1dc68
- [x] 2.3 `npm run test:e2e` passes incl. updated `risk8` + new `landing-smoke` — 9a1dc68

#### Manual

- [x] 2.4 Landing correct in both themes (hero, mock, steps, features, privacy, footer) — 9a1dc68
- [x] 2.5 Signed-in `/` shows "Open dashboard" variant — 9a1dc68
- [x] 2.6 Deliberate-break check on `landing-smoke` (break → red, revert → green) — 9a1dc68
- [x] 2.7 Copy proofread (English only, honest claims) — 9a1dc68

### Phase 3: Auth Flow & Auth Views

#### Automated

- [x] 3.1 `npx astro sync && npm run lint && npm run build` passes — 398819d
- [x] 3.2 `npm test` passes — 398819d
- [x] 3.3 `npm run test:e2e` passes incl. updated `auth.setup.ts` — 398819d
- [x] 3.4 No `purple-` classes left under `src/components/auth` + `src/pages/auth` — 398819d

#### Manual

- [x] 3.5 Full loop: sign-up → confirm → sign-in → `/dashboard`; sign-out → `/` — 398819d
- [x] 3.6 Signed-in bounce off `/auth/signin` + `/auth/signup` — 398819d
- [x] 3.7 Failed sign-in error styling correct, both themes — 398819d

### Phase 4: App-Wide Sweep & Global Shell

#### Automated

- [x] 4.1 `npx astro sync && npm run lint && npm run build` passes — 51347ff
- [x] 4.2 `npm test && npm run test:e2e` passes (full suite) — 51347ff
- [x] 4.3 Grep gates zero: `bg-cosmic`, `text-blue-100`, `bg-white/`, `border-white/`, `purple-`, `bg-clip-text`, `10x Astro Starter` — 51347ff
- [x] 4.4 `text-white` + `backdrop-blur` gates zero in `src/` (`--exclude-dir=ui`) — 51347ff
- [x] 4.5 `min-h-screen` gone from `src/pages/` — 51347ff

#### Manual

- [x] 4.6 All views reviewed in both system themes, no unreadable surfaces — 51347ff
- [x] 4.7 Grade buttons / badges / pending card legible in both themes — 51347ff
- [x] 4.8 AlertDialog + confirm input correct in both themes — 51347ff
- [x] 4.9 Global Topbar: logo-only on auth, full nav elsewhere; header aligned, no header-induced scrollbar or low content — 51347ff
