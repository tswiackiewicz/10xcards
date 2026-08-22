---
date: 2026-08-22T15:39:05+02:00
researcher: tswiackiewicz (via Claude Code)
git_commit: 4cb3683f5bdb6aacf96ab3ee2a076c40ef022846
branch: master
repository: tswiackiewicz/10xcards
topic: "Start page redesign — individual look for the start page and the whole app: landing-page content patterns, new palette, English-only copy, 10xCards logo"
tags: [research, codebase, start-page, landing-page, theming, tailwind, shadcn, branding, auth, welcome]
status: complete
last_updated: 2026-08-22
last_updated_by: tswiackiewicz
---

# Research: Start Page Redesign — Individual Look for 10xCards

**Date**: 2026-08-22T15:39:05+02:00
**Researcher**: tswiackiewicz (via Claude Code)
**Git Commit**: `4cb3683f5bdb6aacf96ab3ee2a076c40ef022846`
**Branch**: `master`
**Repository**: `tswiackiewicz/10xcards`

## Research Question

Original (Polish, verbatim): "Obecnie strona startowa aplikacji jest odzworowaniem uzytego 10x Astro Starter. Chce nadac stronie startowej ale tez calej aplikacji indywiadualnego wygladu. W analizie skup sie na porownaniu z innymi aplikacjami tego typu, jakie elementy powinny znalezc sie na stronie startowej (opcje logowania, zakladania konta, moze jakas krotka zajawka czym jest ta aplikacja) + do tego inna niz w tym starterze kolorystyka - nie tylko na stronie glownej, ale takze na pozostalych widokach. Tresc moze byc wylacznie w jezyku angielskim - byc moze potrzebne bedzie dostosowanie w calej aplikacji. Dobrze byloby tez osadzic jakies logo '10x Cards'."

In short (English): the start page is still the raw 10x Astro Starter. Give the start page — and the whole app — an individual look: (1) compare with similar apps and determine which elements belong on the start page (sign-in, sign-up, a short blurb about the product); (2) a color scheme different from the starter's, applied across all views; (3) content in English only, adjusting the whole app if needed; (4) embed a "10x Cards" logo. Web search allowed.

## Summary

1. **The start page is 100% unmodified starter marketing.** `src/pages/index.astro` renders `Welcome.astro`, whose H1 is `"10x Astro Starter"` and whose three feature cards pitch the _template to developers_ ("Authentication Ready", "Modern Stack", "Developer Experience") — not 10xCards to learners. The product name **never appears anywhere in the shipped UI**; the default `<title>` is also `"10x Astro Starter"`.
2. **The visual system is two disconnected layers.** A full shadcn oklch token set exists in `src/styles/global.css` but is consumed by almost nothing (only shadcn primitives + `body`). The actual look is **~163 hard-coded "cosmic" color lines across 22 files** (purple/blue/white-alpha utilities + the `bg-cosmic` hex-gradient utility repeated on all 10 views). Dark mode is defined (`.dark` block, `@custom-variant`) but **unreachable** — no `class="dark"` is ever set; the dark look is faked with `white/N` alpha classes over a near-black gradient. A palette swap is therefore: re-point tokens + activate a theme strategy + systematically replace ~12 recurring class motifs.
3. **The English-only mandate is nearly met already.** Exactly **6 Polish user-visible strings in 2 files** — the missing-config banner path (`src/lib/config-status.ts`, `src/layouts/Layout.astro`). Everything else (page titles, forms, error copy, Supabase email defaults, API error codes) is English. One deliberate exception to confirm: AI-generated _card content_ follows the language of the pasted source text (`src/lib/flashcards/generation.ts:30`).
4. **Competitors converge on clear landing conventions** (verified live 2026-08-22): top-right "Log in" as ghost/text + a filled, value-worded sign-up button ("Get Started", "Sign up for free"); dedicated auth pages, not modals; hero = outcome headline + mechanism sub-headline + single sign-up CTA; below the fold: how-it-works, feature row, footer. The category color is **blue** (Quizlet ~#4255FF, RemNote #506CF7, Brainscape #29A5DC, Noji #009DFF, Anki #7EBBE5) — green or warm-orange primaries differentiate hardest.
5. **All 7 PRD capabilities are shipped** (roadmap: every milestone done), so the landing page can honestly advertise: AI generation from pasted text, human-gated accept/edit/reject review, FSRS spaced-repetition study, manual authoring, deck management with AI/Manual provenance badges, private RLS-backed decks, GDPR self-service deletion with 30-day recovery.
6. **CI coupling:** `tests/e2e/risk8-route-protection-smoke.spec.ts:27` asserts the `"10x Astro Starter"` heading on `/` — the redesign **will fail CI** unless this spec is updated in the same change. The protected-routes oracle (`tests/integration/risk8-protected-routes-oracle.test.ts:31-32`) pins the exact page set, so any _new_ public page (e.g. `/pricing`) fails it by design. No test asserts colors.
7. **Adjacent UX debt discovered** (candidates for the same change or explicit out-of-scope): post-sign-in redirect goes to `/` (the marketing page) instead of `/dashboard`; a signed-in visitor to `/` still sees the starter pitch; auth pages don't redirect already-signed-in users; the Topbar exists only on `/`; there's no footer, no `<meta description>`, no OG tags; `public/template.png` (1.27 MB starter banner) is orphaned but still shipped.

## Detailed Findings

### 1. Current start page — anatomy

Composition: `src/pages/index.astro` (8 lines) → `<Layout>` (no `title` prop → default `"10x Astro Starter"` from `src/layouts/Layout.astro:10`) → `src/components/Welcome.astro` (126 lines, everything).

Welcome.astro structure:

- **Decorative layer** (`Welcome.astro:5-25`): `bg-cosmic` gradient wrapper; three blurred "cosmic orbs" (`bg-purple-500/20`, `bg-blue-500/15`, `bg-indigo-400/10`); an inline-`style` star field of three `rgba(255,255,255,…)` radial-gradients (`Welcome.astro:23`).
- **Topbar** (`Welcome.astro:28`) — rendered **only on this page** (see §2).
- **Hero** (`Welcome.astro:31-54`): H1 `"10x Astro Starter"` in a `from-blue-200 via-purple-200 to-pink-200` gradient (`:35`); sub-headline "A production-ready starter with authentication, modern tooling, and a cosmic developer experience." (`:38`); CTA 1 `"Sign In"` → `/auth/signin` (solid `bg-purple-600`, `:41-46`); CTA 2 `"Sign Up"` → `/auth/signup` (outline, `:47-52`).
- **Feature cards** (`Welcome.astro:57-124`): 3-up glass grid (`border-white/10 bg-white/5 backdrop-blur-xl`), hand-inlined `stroke="currentColor"` SVGs in `text-purple-300`. Copy: "Authentication Ready" / "Modern Stack" / "Developer Experience" — template-facing, and factually stale ("Astro 5…" while the repo is on Astro 6).
- **No images** (zero `<img>`; all visuals are CSS + inline SVG), **no footer** (none exists anywhere in the app).

Template leftovers inventory:

| Location                                                 | Leftover                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/components/Welcome.astro:35,38,74-76,97-99,119-121` | All starter marketing copy incl. H1                                               |
| `src/layouts/Layout.astro:10`                            | Default `<title>` `"10x Astro Starter"`                                           |
| `src/lib/config-status.ts:16`                            | Starter GitHub docs URL surfaced in a user-visible banner                         |
| `public/template.png`                                    | 1,266,671 B starter banner — **zero references, still shipped to `dist/client/`** |
| `src/components/ui/LibBadge.astro`                       | Dead starter component, zero usages (4 hard-coded colors)                         |
| `package.json:2`                                         | `"name": "10x-astro-starter"`; no `description` field                             |
| `README.md:41-42`                                        | Clone instructions pointing at the starter repo                                   |

### 2. View inventory, routing, and auth flows

One layout for all 10 pages (`src/layouts/Layout.astro`; only prop: `title?`). `PROTECTED_ROUTES` (`src/middleware.ts:4`): `["/dashboard", "/generate", "/create", "/cards", "/study", "/account"]`; unauthenticated hits redirect to `/auth/signin` (`middleware.ts:22`). All gating is middleware-only — no per-page auth logic.

| Route                          | Purpose                                      | Title                 | Protected |
| ------------------------------ | -------------------------------------------- | --------------------- | --------- |
| `/`                            | Starter marketing page                       | default (starter)     | no        |
| `/dashboard`                   | Post-login hub (link grid)                   | "Dashboard"           | yes       |
| `/generate`                    | AI generation + review                       | "Generate flashcards" | yes       |
| `/create`                      | Manual authoring                             | "Create flashcard"    | yes       |
| `/cards`                       | Deck list/edit/delete                        | "My flashcards"       | yes       |
| `/study`                       | FSRS study loop                              | "Study"               | yes       |
| `/account`                     | Deletion/reactivation                        | "Account"             | yes       |
| `/auth/signin`, `/auth/signup` | Auth forms (React islands)                   | "Sign in"/"Sign up"   | no        |
| `/auth/confirm-email`          | Post-signup interstitial (DEV/PROD branches) | dynamic               | no        |

Flow findings that shape the redesign:

- **Post-sign-in lands on `/`** (`src/pages/api/auth/signin.ts:34`) — i.e. back on the starter marketing page; the user must find the small "Dashboard" link in the Topbar. Sign-out also lands on `/` (`signout.ts:9`). Sign-up lands on `/auth/confirm-email`, which dead-ends at a "Go to sign in" link.
- **A signed-in visitor to `/` gets the same starter pitch** — no redirect, only the Topbar switches to email + Dashboard/Account/Sign out (`src/components/Topbar.astro:9-25`).
- **Auth pages don't redirect signed-in users** — `/auth/signin` renders the form again.
- **The Topbar renders only on `/`** (`Welcome.astro:28` is its sole usage) and **shows no app name/logo** — its left slot is the user email or `"Not signed in"`. App pages navigate via a per-page gradient H1 + `"← Dashboard"` back-link pattern repeated in 5 files (`generate.astro:13`, `create.astro:13`, `cards.astro:24`, `study.astro:25`, `account.astro:28`); there is no shared app shell.
- Start page → auth links exist in 4 places (hero ×2 + Topbar ×2), duplicative and template-framed.

Meta/branding surface (all in `Layout.astro:14-19`): `<html lang="en">`, charset, viewport, `favicon.png` (733 B starter mark), `<title>`. **Absent:** meta description, OG/Twitter tags, theme-color, canonical, apple-touch-icon, SVG favicon, robots.txt. `@astrojs/sitemap` is configured (`astro.config.mjs:27`).

### 3. Theming & color system — the palette-swap surface

**Central tokens** (`src/styles/global.css`, the only CSS file; imported once at `Layout.astro:2`):

- `:root` (L6-39, 33 tokens) + `.dark` (L41-73, 32 tokens): stock shadcn `baseColor: neutral` in oklch — every neutral is chroma-0 grayscale; only `--destructive` is chromatic. `@theme inline` (L75-111) maps tokens into Tailwind utilities. `components.json`: `style: "new-york"`, `baseColor: "neutral"`, `cssVariables: true`.
- `@utility bg-cosmic` (L113-115): `linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a)` — three raw hexes, **the actual background of all 10 views**, entirely outside the token system. Highest-leverage single edit in the repo.
- No custom fonts anywhere (no `@fontsource`, no Google Fonts link, no `--font-*` overrides, no Astro fonts config) — the app runs on the Tailwind 4 default system-UI stack.

**Dark mode: defined but unreachable.** Class strategy via `@custom-variant dark (&:is(.dark *))` (`global.css:4`), but `Layout.astro:14` never sets `class="dark"`, no toggle component exists, no `prefers-color-scheme` usage. Consequence: shadcn primitives resolve **light** tokens under a near-black page — default `<Button>` renders near-black-on-near-black, which is why `SubmitButton.tsx:18` force-overrides with `bg-purple-600`, and `AlertDialog` renders as a light dialog over the dark app. **Any palette must first decide the theme strategy** (set `class="dark"` and theme the `.dark` block dark-first, or re-point `:root` and go light-default with `prefers-color-scheme` support).

**Hard-coded color inventory (complete enumeration by the audit):** 101 lines / 162 class tokens of numeric-shade palette utilities across **22 files**, plus 61 lines of `white/black`-alpha utilities, 12 raw hexes (9 in `Banner.astro`, 3 in `bg-cosmic`), 1 inline-style `rgba()` line (star field). Zero arbitrary-value color classes. Only **one** semantic-token line in app code (`AccountView.tsx:118`). The swap is tractable because it clusters into recurring motifs:

| Motif (current classes)                                                                                                                                                                      | ~Count | Where                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `text-blue-100/{50..90}` body/label/eyebrow text                                                                                                                                             | 45     | every component + 9 pages                               |
| `border-white/10 bg-white/5` card/input glass surface                                                                                                                                        | ~18    | all flashcard views, Welcome, Topbar                    |
| `border-white/20 bg-white/10 hover:bg-white/20` CTA/tile                                                                                                                                     | ~12    | dashboard tiles, StudyView, SavedCardsView              |
| `from-blue-200 to-purple-200 bg-clip-text` gradient H1                                                                                                                                       | 9      | `Welcome.astro:33` + 8 pages                            |
| `text-purple-300 hover:text-purple-100` links/icons                                                                                                                                          | ~11    | Topbar ×5, pages, Welcome icons                         |
| `bg-purple-600 hover:bg-purple-500` primary CTA                                                                                                                                              | 2      | `Welcome.astro:43`, `SubmitButton.tsx:18`               |
| `focus:border-purple-300` / `focus:ring-purple-400`                                                                                                                                          | 5      | 4 textareas + `FormField.tsx:53`                        |
| `border-red-400/40 bg-red-500/10 text-red-200` error banner                                                                                                                                  | 6+     | Generate/Manual/SavedCards/Study + `ServerError.tsx:11` |
| `border-emerald-400/40 bg-emerald-500/10 text-emerald-200` success                                                                                                                           | 3      | Generate, Manual, CandidateCard accepted                |
| `text-red-300` inline errors / over-limit counters                                                                                                                                           | 9      | forms + counters                                        |
| Semantic scales (keep hue-coded): FSRS grades red/orange/blue/green (`StudyView.tsx:14-21`), AI/Manual badges (`SavedCardsView.tsx:40-41`), amber pending-deletion (`AccountView.tsx:68-69`) | 7      | study, cards, account                                   |
| `bg-cosmic` page wrapper                                                                                                                                                                     | 10     | all pages                                               |

**Spots needing decisions, not find-and-replace:**

- `src/components/Banner.astro:28-40` — 9 raw hexes in a scoped `<style>` (not Tailwind): light-scheme banner on a dark page; immune to token changes; should be rewritten to token utilities. Also carries 2 of the 6 Polish strings' render path (`Layout.astro:22-37`).
- `src/components/auth/SubmitButton.tsx:18` — deleting the purple override makes the button obey `--primary` for free.
- `src/components/ui/LibBadge.astro` — dead; delete rather than re-theme.
- `src/components/Welcome.astro:23` — inline-style star field; hand-edit or lift into a `@utility` next to `bg-cosmic`.
- SVGs are safe: all inline SVGs are `stroke="currentColor"`, all other icons are lucide (`currentColor`) — recolor via parent `text-*`.

shadcn primitives are essentially clean (only `button.tsx:14` `text-white` in destructive, `alert-dialog.tsx:24` `bg-black/50` scrim; `dark:` variants in `button.tsx` are currently dead branches).

### 4. Branding & naming state

- **Canonical written product name: `10xCards`** (one word — `context/foundation/prd.md:2`, `roadmap.md:2,12`, `README.md:1`). Drift: `10x-cards` (`wrangler.jsonc:3`, tech-stack hand-off), `10x-astro-starter` (`package.json:2`), `"10x Astro Starter"` (all shipped UI). The user brief writes "10x Cards" (with space) — **the wordmark spelling needs a one-time decision** (see Open Questions).
- The app name appears in exactly 3 places in `src/` + `public/` (`Welcome.astro:35`, `Layout.astro:10`, the starter URL at `config-status.ts:16`) — there is **no single source of truth** (no `siteConfig`), no logo component, no brand/design doc anywhere in `context/foundation/` (no `ui-plan.md`).
- Assets: `public/favicon.png` (733 B, 32 px starter mark — the only referenced asset in the app) and orphaned `public/template.png`.

### 5. Language audit — English-only mandate

**The app is ~99% English. Exactly 6 Polish user-visible strings, 2 files, one render path** (missing-config banner shown on every page when `SUPABASE_URL`/`SUPABASE_KEY`/`OPENROUTER_API_KEY` is unset):

| file:line                     | String                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `src/layouts/Layout.astro:25` | `<strong>Uwaga:</strong>`                                                            |
| `src/layouts/Layout.astro:30` | fallback link text `"Dokumentacja"`                                                  |
| `src/lib/config-status.ts:15` | `"Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone."`        |
| `src/lib/config-status.ts:17` | `"Zobacz instrukcję konfiguracji"`                                                   |
| `src/lib/config-status.ts:22` | `"OpenRouter nie jest skonfigurowany — generowanie fiszek przez AI jest wyłączone."` |
| `src/lib/config-status.ts:24` | `"Zobacz instrukcję konfiguracji"`                                                   |

Everything else checked and clean: `<html lang="en">`; all page titles/UI copy/error-copy maps English; API returns typed error codes (no prose; `src/lib/flashcards/schemas.ts:61-71`, `src/lib/account/schemas.ts:3`) mapped to English client-side; zod uses bare `.min()/.max()` (no custom messages); Supabase email templates not customized → English defaults (`supabase/config.toml:229-238` commented out); no Polish in `tests/`. Internal-only Polish (`idea-notes.md`, multibyte test fixtures in `packages/code-review`) is out of scope of the mandate.

**Deliberate multilingual exception to confirm:** `src/lib/flashcards/generation.ts:30` instructs the AI to "Use the same language as the source text" — generated _card content_ (user data, not UI chrome) follows the pasted source. Recommend treating as out of scope, but it's an owner call.

The English-only rule has no written home in the repo — worth capturing in `context/foundation/lessons.md` or the PRD during this change.

### 6. Competitor landing pages (web research, fetched live 2026-08-22)

Verified by direct fetch except Quizlet (bot-blocked → search-snippet data, marked [S]).

| App                                            | Above the fold                                                                                                           | Auth entry                                                        | Colors / theme                                     | Logo                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------- | ---------------------------- |
| **Quizlet** [S]                                | "Discover, create, and master your study material — all in one place"; sign-up-first                                     | Top-right Log in (text) + Sign up (filled); dedicated pages       | Primary ~**#4255FF** "blurple"; light              | "Q" rounded tile + wordmark  |
| **Anki** (apps.ankiweb.net)                    | "Powerful, Intelligent Flashcards" + mechanism sub; CTA "Download Anki"                                                  | None in nav (desktop-first)                                       | Light blue #7EBBE5; light+dark (system)            | Star-on-card icon + wordmark |
| **Noji** (ex-AnkiPro; ankipro.net 301→noji.io) | "Noji Flashcards: Learn More, Stress Less"; "Start learning"                                                             | "Sign in" text + "Get Started" filled                             | Blue #009DFF on white; light                       | Wordmark                     |
| **Brainscape**                                 | "The ultimate study weapon." + "Use AI to find or make flashcards from any source. Learn faster with spaced repetition." | "Log in" text + "Get Started" filled; `/log-in`, `/sign-up` pages | Sky #29A5DC + orange #FF8243 accent; light         | Icon + wordmark              |
| **Memrise**                                    | "Learn a language…"; CTA "Start learning"                                                                                | "Log in" text only; filled CTA is the signup path                 | Cream #FCFAF2, navy #2B3648, yellow #FFBB00; light | Lowercase wordmark           |
| **RemNote**                                    | "The AI note taking tool that actually helps you learn." + sub; "Sign up for free"                                       | "Log in" text + "Get RemNote Free" filled                         | Blue #506CF7, pale-blue surfaces; light            | Icon + wordmark              |
| **Mochi** (mochi.cards)                        | "Spaced repetition flashcards made easy" + markdown mechanism                                                            | None in nav ("Open app")                                          | Monochrome; **system light/dark**                  | Icon + wordmark              |
| **Knowt**                                      | "Every AI Study Tool You Need for a 4.0"; app badges + web CTA                                                           | `/login`, `/signup` pages (nav client-rendered)                   | Teal #50D2C2 + violet accents; light               | Icon + lowercase wordmark    |

Cross-cutting conventions relevant to 10xCards:

- **Unanimous header pattern among account-based web apps:** top-right "Log in"/"Sign in" as plain text/ghost + a **filled, value-worded sign-up button** ("Get Started", "Get X Free", "Start learning"). Dedicated auth pages, never modals — matches the existing Supabase pages.
- **Hero formula:** outcome-first headline (learn/remember), mechanism sub-headline naming _flashcards + spaced repetition + AI_, one primary CTA (sign-up).
- **Below-fold spine:** social proof → how-it-works/features → testimonials/stats → FAQ → footer CTA. Most of that spine exists for scale 10xCards doesn't have (see checklist).
- **All 8 default light**; only Mochi and Anki ship real dark support (system-driven).
- **Blue is the saturated category color** (5 of 8), teal taken by Knowt, yellow-on-cream by Memrise.

### 7. Distilled start-page element checklist for 10xCards

Two jobs: explain the product in one glance; route to sign-in / create-account.

**P0 — must ship**

1. Header: logo (glyph + wordmark) top-left → `/`; top-right exactly two controls: "Log in" ghost → `/auth/signin`, filled value-worded sign-up → `/auth/signup`.
2. Hero headline, outcome-first, ≤8 words (pattern: "Paste your notes. Remember them forever.").
3. Hero sub-headline, one sentence naming AI-generated flashcards + spaced repetition + free.
4. Primary hero CTA = sign-up (value-worded, e.g. "Start learning free"); secondary = "Log in" or anchor "See how it works". One primary only.
5. One product visual in the hero — cheapest honest option: a styled flashcard mock (front/back), not a screenshot to maintain.
6. Minimal footer (copyright, GitHub/contact, privacy note) — the app currently has none.

**P1 — worth it, still cheap** 7. "How it works" in 3 steps (Paste text → Review AI candidates → Study on schedule) — mirrors the actual FR-003/FR-004/FR-009 loop. 8. 3-feature row (AI generation with human gate / FSRS spaced repetition / private & free) — icon + two lines each; can honestly add the AI/Manual provenance badge and 30-day deletion recovery as trust points. 9. Repeat sign-up CTA at page bottom. 10. Honor `prefers-color-scheme` (shadcn gives it nearly free) even though competitors default light.

**Skip for this MVP:** pricing (none exists), testimonials/ratings/user-count stats (would be fabricated), logo trust strips, FAQ, blog teasers, app-store badges, competitor-comparison sections, social-login buttons. PRD non-goals must NOT be advertised: no file/PDF import (paste only), no sharing/team decks, no mobile apps, no LMS integrations.

Honest proof points available from the PRD instead of fake social proof: "75% of AI cards accepted" quality bar (`prd.md:47-49`) and "your source text is never exposed to other users and never reused beyond your request" (`prd.md:144-145`).

### 8. Palette directions (3, shadcn-token-ready, non-zinc)

All values practical as `--primary`/`--accent`/`--background` oklch tokens; category context: avoid the blue cluster (233–270 hue) and Knowt's teal (184).

**A — "Emerald Recall" (green + amber)** — differentiates hardest.
Primary #059669 (oklch 0.596 0.127 163.2), white foreground; accent amber #F59E0B (0.769 0.165 70.1) for streaks/due counts; green-tinted neutrals (hue 150–170, chroma ≤0.01); dark mode: primary #34D399 on near-black green-tinted ground (~oklch 0.18 0.012 165). Psychology: growth / "correct answer" — matches the recall loop. No surveyed competitor owns green.

**B — "Ember Deck" (warm orange + ink navy)** — most distinctive-warm.
Primary #EA580C (0.646 0.194 41.1); secondary ink navy #1C2433 (0.260 0.031 262.7) for headings/dark surfaces; warm stone neutrals (hue 40–60), hero off-white ~oklch(0.98 0.006 60); dark mode: primary #FB923C on the navy itself (~oklch 0.22 0.03 263) — a navy-not-gray dark theme. Psychology: energy/momentum, fits the "10x" promise. Orange exists in the category only as Brainscape's accent.

**C — "Orchid Synapse" (violet + cyan)** — rides the AI-purple convention; closest to the current cosmic look and to Quizlet (#4255FF, hue 270 vs 293) / RemNote — pick only if brand continuity with today's purple matters more than differentiation.
Primary #7C3AED (0.541 0.247 293.0); accent cyan #06B6D4 (0.715 0.126 215.2) for AI moments (icons/borders, not body text on dark); violet-tinted neutrals (hue ~290, chroma ≤0.012); dark mode: primary #A78BFA on oklch(0.17 0.015 290).

Regardless of direction, the semantic scales stay hue-coded and just get re-tuned to the new neutrals: FSRS grades (red/orange/blue/green), error red, success emerald→(palette-consistent green), pending amber, AI/Manual badges.

### 9. Logo approaches ("10x Cards", engineer-shippable)

Competitor precedent: icon+wordmark is the norm (Quizlet, RemNote, Knowt, Anki, Mochi); wordmark-only viable (Memrise, Noji) but weak for favicons.

1. **Stacked-cards glyph + wordmark (recommended).** Inline SVG: 2–3 rounded rectangles (rx≈3 on a 24-unit grid) offset diagonally as a card stack; top card carries "10x" or a 4-point AI sparkle. Wordmark in the UI font, `font-weight: 700`, `letter-spacing: -0.02em`, "10x" in `--primary`, "Cards" in `--foreground`. `currentColor`-driven → themes automatically. ~30 lines of SVG, one shared component.
2. **Wordmark-only with a typographic hook** ("x" as a rotated card or in accent color). Zero glyph design, but still needs a monogram for the favicon.
3. **Monogram tile** (Quizlet-style rounded square, `--primary` bg, white "10x"/card glyph) — one asset works as logo, favicon, and og-image centerpiece.

Derivations regardless of approach: `favicon.svg` (glyph only, `<link rel="icon" type="image/svg+xml">`, can embed a `prefers-color-scheme` media swap) + 32 px PNG fallback + 180 px apple-touch-icon; static `public/og.png` (1200×630) rendered once (Playwright is already in the repo) + `og:image`/description meta in `Layout.astro`. Keep the glyph legible at 16 px (≤2 overlapping shapes, strokes ≥1.5 px at 24-unit viewBox).

### 10. Test & CI coupling (redesign blockers)

- 🔴 `tests/e2e/risk8-route-protection-smoke.spec.ts:27` — `getByRole("heading", { name: "10x Astro Starter" })` on `/`. **Renaming the H1 fails CI**; update in the same change.
- `tests/integration/risk8-protected-routes-oracle.test.ts:31-32` — hand-authored `EXPECTED_PROTECTED`/`EXPECTED_PUBLIC` sets cross-checked against a filesystem walk of `src/pages/**`. **Adding any new page (e.g. `/pricing`) fails until the oracle is updated** — by design.
- Copy-coupled e2e selectors (safe unless those screens' copy changes): `auth.setup.ts:17-19` ("Email", "Password", "Sign in"); `seed.spec.ts:39-72` (generate-flow strings); `risk1-…:34-54` / `risk3-…:30-68` (manual-form placeholders "e.g. What does RLS stand for?", "Save card", "Card saved to your deck.").
- **No test asserts any color** (no `toHaveCSS`/color names in `tests/`) — the palette swap itself is CI-safe.
- Any new/changed e2e must navigate via `gotoAndWaitForHydration`/`reloadAndWaitForHydration` from `tests/e2e/navigate.ts` (AGENTS.md rule — `client:load` islands hydrate asynchronously).

## Code References

Permalink base: `https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/`

- [`src/pages/index.astro`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/pages/index.astro) — start page shell (Layout + Welcome only)
- [`src/components/Welcome.astro`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/components/Welcome.astro) — the entire current start page (hero L31-54, feature cards L57-124, star field L21-25)
- [`src/layouts/Layout.astro`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/layouts/Layout.astro) — single global layout: default title L10, `<html lang="en">` L14, head L15-20, config banners L22-37 (2 Polish strings L25, L30)
- [`src/styles/global.css`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/styles/global.css) — tokens `:root` L6-39, `.dark` L41-73, `@theme inline` L75-111, `bg-cosmic` L113-115
- [`src/components/Topbar.astro`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/components/Topbar.astro) — start-page-only chrome, no app name
- [`src/components/Banner.astro`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/components/Banner.astro) — scoped-CSS raw-hex light banner (L28-40)
- [`src/lib/config-status.ts`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/lib/config-status.ts) — 4 Polish strings (L15, L17, L22, L24) + starter URL (L16)
- [`src/middleware.ts`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/middleware.ts) — `PROTECTED_ROUTES` L4, redirect L22
- [`src/pages/api/auth/signin.ts`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/pages/api/auth/signin.ts) — post-sign-in redirect to `/` (L34), pending-deletion → `/account` (L31)
- [`src/components/auth/SubmitButton.tsx`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/components/auth/SubmitButton.tsx) — `bg-purple-600` override of `--primary` (L18)
- [`src/lib/flashcards/generation.ts`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/src/lib/flashcards/generation.ts) — "Use the same language as the source text" (L30)
- [`tests/e2e/risk8-route-protection-smoke.spec.ts`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/tests/e2e/risk8-route-protection-smoke.spec.ts) — asserts starter H1 on `/` (L27)
- [`tests/integration/risk8-protected-routes-oracle.test.ts`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/tests/integration/risk8-protected-routes-oracle.test.ts) — page-set oracle (L31-32)
- [`context/foundation/prd.md`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/context/foundation/prd.md) — product name L2, FRs L83-137, quality bar L47-49, privacy L144-145, non-goals L173-182
- [`components.json`](https://github.com/tswiackiewicz/10xcards/blob/4cb3683f5bdb6aacf96ab3ee2a076c40ef022846/components.json) — shadcn new-york, baseColor neutral

## Architecture Insights

- **Astro static pages + React `client:load` islands**; the start page is pure static Astro (zero islands) — keep it that way for speed unless interactivity is added.
- **Middleware-only route protection** (`src/middleware.ts`), no per-page gating; `Astro.locals.user` available everywhere — Welcome/Topbar already branch on it.
- **Page-shell contract** (from the manual-card-authoring change, verified live): `Layout title` + `bg-cosmic` wrapper + gradient H1 + `← Dashboard` back-link + island. A redesign should re-skin this shell consciously (ideally centralizing it) rather than diverging page-by-page.
- **`/dashboard` is the intended signed-in hub** (decision from manage-saved-flashcards change); `/` is the marketing page. The post-sign-in redirect to `/` contradicts that intent.
- **Feedback idiom: inline glass banners, no toast library** (decision from ux-improvements change) — red `border-red-400/40 bg-red-500/10` / emerald success; preserve the idiom, re-tint per new palette.
- **Two-layer styling reality**: semantic shadcn tokens (unused) vs hard-coded utility soup (everything). The redesign's structural opportunity is to collapse the app onto the token layer (re-point tokens, delete per-component overrides) instead of swapping one hard-coded palette for another.
- shadcn CLI is configured (`components.json`) — missing primitives (Card, Input, Badge) can be added via CLI rather than hand-rolled.

## Historical Context (from prior changes)

- `context/archive/2026-07-02-ux-improvements/` — de-facto design-system record: inline glass banners over toasts (research.md:82,104; plan.md:45); canonical spinner/dialog idioms; precedent that "polish" changes get strict scope fences.
- `context/archive/2026-07-01-manage-saved-flashcards/plan.md:34-40` — locked shadcn new-york + lucide + cosmic glass as house style; established `/dashboard` as the nav hub (why `/` is pure marketing).
- `context/archive/2026-07-01-manual-card-authoring/plan.md:25,160` — the page-shell contract every app page follows.
- `context/archive/2026-06-25-ai-card-generation/plan.md:35,317` — baseline architecture: Astro pages + React islands, types from `src/lib/flashcards/schemas.ts`.
- `context/archive/2026-07-02-bootstrap-verification/verification.md:1-6` — the app was cloned from `przeprogramowani/10x-astro-starter`; starter branding was never rewritten post-bootstrap (origin of this change's debt).
- `context/foundation/roadmap.md:44-50` — all 7 milestones done; landing page can advertise the full feature set truthfully.

## Related Research

- `context/archive/2026-07-02-ux-improvements/research.md` — prior UI-idiom research (banners, spinners, dialogs) this redesign should stay consistent with.
- No other research artifacts under `context/changes/**`.

## Open Questions

1. **Palette direction** — A "Emerald Recall", B "Ember Deck", or C "Orchid Synapse"? (A/B differentiate hardest from the blue-saturated category; C preserves continuity with the current purple. Owner pick at plan time.)
2. **Theme strategy** — dark-first (set `class="dark"`, keep the current dark character with the new palette) vs light-default with `prefers-color-scheme` dark support (matches all 8 competitors; more work: every `white/N` alpha class must become token-driven)?
3. **Wordmark spelling** — `10xCards` (canonical in PRD/README) or `10x Cards` (user brief)? Should `package.json` `name`/`description` be fixed in the same change?
4. **Post-sign-in redirect** — change `/api/auth/signin.ts:34` from `/` to `/dashboard`? And should a signed-in visitor to `/` be redirected (or shown a "Go to dashboard" hero CTA instead of Sign in/Sign up)? Strong UX win, technically one-line, but touches auth flow tests.
5. **Scope of the app-wide re-skin** — one change (start page + tokens + motif sweep across all 22 files) or two stages (1: start page + brand + tokens + Polish strings; 2: mechanical motif sweep on inner views)? Precedent (S-06) favors tight scope fences; the diff for a full sweep is large but mechanical, and CI has no color assertions.
6. **AI card-content language** (`generation.ts:30` follows source-text language) — confirm it stays out of the English-only mandate (it's user data, not UI chrome).
7. **Logo glyph** — stacked cards vs monogram tile; and whether "75% AI-cards-accepted" / privacy statement should appear on the landing page as trust points.
