# Start Page Redesign — Plan Brief

> Full plan: `context/changes/start-page-redesign/plan.md`
> Research: `context/changes/start-page-redesign/research.md`

## What & Why

The start page is still the raw 10x Astro Starter — it pitches the _template to developers_ ("Authentication Ready", "Modern Stack") and the product name 10xCards appears nowhere in the shipped UI. This change replaces it with a real 10xCards landing page and gives the whole app an individual look: a new palette applied through proper design tokens, a real typeface, a logo/favicon/OG brand kit, English-only UI copy, and a coherent auth funnel.

## Starting Point

All 7 PRD capabilities are shipped (AI generation, gated review, FSRS study, manual cards, deck management, private accounts, GDPR deletion) — the landing can honestly advertise everything. Visually, the app runs on ~163 hard-coded "cosmic" color lines across 22 files while a full shadcn token system sits unused; dark mode is defined but unreachable. Exactly 6 Polish user-visible strings remain (config banner). One e2e spec asserts the starter H1 on `/` and will break with the redesign.

## Desired End State

A visitor to `/` sees a branded 10xCards landing — logo header with "Log in" + "Sign up free", an outcome-first hero with a CSS flashcard mock, how-it-works, three features, a privacy trust line, and a footer — and every view of the app renders correctly in both light (default) and dark (system) themes under the Emerald Recall palette with Space Grotesk type. Signing in lands on `/dashboard`; signed-in visitors are bounced off auth forms.

## Key Decisions Made

| Decision         | Choice                                                                                                           | Why (1 sentence)                                                                                                                                                                                                             | Source          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Palette          | Emerald Recall (green `#047857` light / `#34D399` dark + amber accent)                                           | Differentiates hardest from a category saturated with blue (Quizlet/RemNote/Brainscape/Noji); green = growth/recall. Light primary is the darker emerald-700 — `#059669` only reaches 3.6:1 on its foreground, under WCAG AA | Research / Plan |
| Theme strategy   | Light default + dark via `prefers-color-scheme`                                                                  | Category convention (8/8 competitors default light); shadcn tokens make dual-theme sustainable; no toggle UI                                                                                                                 | Plan            |
| Brand spelling   | `10xCards` in all UI copy; `package.json` renamed to `10xcards`                                                  | Canonical form in PRD/README/roadmap. Fixes the _user-visible_ name only — `wrangler.jsonc`'s `10x-cards` is the deployed Worker's identity and is explicitly out of scope (renaming it orphans the Worker and its secrets)  | Research / Plan |
| Typography       | One self-hosted variable font (Space Grotesk via @fontsource)                                                    | Distinct character at ~35-50 kB cost; Workers-friendly (no external hosts)                                                                                                                                                   | Plan            |
| Landing depth    | Full MVP (P0+P1): hero, mock, how-it-works, features, privacy, footer                                            | All claims are shipped features; skips fabricated social proof/pricing/FAQ                                                                                                                                                   | Research / Plan |
| Hero visual      | CSS-only flashcard mock (front/back + AI badge)                                                                  | Honest, themeable, zero JS, no screenshot maintenance                                                                                                                                                                        | Plan            |
| Trust point      | Privacy line only (no "75%" stat)                                                                                | The 75% is an internal target, not a measurement — presenting it as a stat borders on fabrication                                                                                                                            | Research / Plan |
| Auth funnel      | Full pack: sign-in → `/dashboard`, auth pages bounce signed-in users, `/` adapts hero                            | Landing for guests, dashboard for users; each change is 1-3 lines                                                                                                                                                            | Research / Plan |
| App chrome       | Topbar with logo global (via Layout); "← Dashboard" links stay                                                   | Brand visible everywhere without a full nav redesign (scope fence)                                                                                                                                                           | Plan            |
| Color sweep      | Semantic tokens for chrome + explicit `dark:` pairs for hue-coded semantics (FSRS grades, badges, error/success) | Standard shadcn practice; dual theme "for free" where possible, legible hue semantics where hue carries meaning                                                                                                              | Plan            |
| Testing          | Fix coupled specs + new landing smoke e2e; no visual snapshots                                                   | Guards exactly what changes; snapshots too flaky for the value                                                                                                                                                               | Research / Plan |
| AI card language | Unchanged (follows source text)                                                                                  | User data, not UI chrome — outside the English-only mandate                                                                                                                                                                  | Research        |

## Scope

**In scope:** landing page rebuild; token system (light+dark) + palette; font; logo/favicon/OG/meta; English banner strings; Topbar global; re-skin of all 10 views + React islands; auth-flow redirects; coupled e2e updates + landing smoke; starter-debt cleanup (`template.png`, `LibBadge`, `package.json`, README clone lines); lessons.md entry for the English-only rule.

**Out of scope:** new public pages (pricing/about/FAQ); theme toggle UI; nav redesign / removal of "← Dashboard" links; social proof or invented stats; social login / password reset; i18n framework; middleware/API/DB changes beyond the one-line redirect; visual-regression tests; AI card-content language.

## Architecture / Approach

Everything flows from `src/styles/global.css`: Emerald tokens on `:root` (light) + a `prefers-color-scheme: dark` media block (replacing the class-gated `.dark`), plus `--font-sans`. Chrome, surfaces, and text consume semantic tokens; hue-coded semantics keep Tailwind classes with explicit light/`dark:` pairs. The brand lives in one `Logo.astro` consumed by the Topbar (hoisted into `Layout.astro` for all pages), the favicon set, and a static `og.png`. The transitional `bg-cosmic` utility survives until the final phase so intermediate states stay usable.

## Phases at a Glance

| Phase                              | What it delivers                                                                    | Key risk                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Theme foundation & brand assets | Tokens (both themes), font, logo, favicon/OG/meta, English banner, starter cleanup  | Token values need contrast fine-tuning (AA)                     |
| 2. Landing page                    | New `Landing.astro` + branded Topbar + updated risk8 + landing smoke e2e            | Copy/selector coupling — risk8 must flip in the same commit     |
| 3. Auth flow & auth views          | Redirects (sign-in → dashboard, bounce signed-in), token re-skin of auth surfaces   | `auth.setup.ts` post-login URL expectation must match           |
| 4. App-wide sweep & global shell   | Topbar global, all inner views + islands on tokens, `bg-cosmic` deleted, grep gates | Breadth — mechanical but 15+ files; dual-theme QA on every view |

**Prerequisites:** none beyond the repo (no new secrets/services; `npm install @fontsource-variable/space-grotesk` at root).
**Estimated effort:** ~3-4 sessions, one commit per phase.

## Open Risks & Assumptions

- Dual-theme QA is manual — no color assertions exist in CI, so both-theme legibility rests on the per-phase manual passes.
- Space Grotesk carries the whole UI (headings + forms); if body legibility disappoints, the fallback is scoping it to headings and reverting body to the system stack (contained in `global.css`).
- Success states share the green family with primary (accepted): tint-weight banners vs. solid buttons carry the distinction.
- `auth.setup.ts`'s exact post-login assertion wasn't captured by research — read before editing (Phase 3).

## Success Criteria (Summary)

- A stranger landing on `/` understands what 10xCards does in one glance and can reach sign-up/sign-in in one click; a fresh sign-in lands in the product, not on marketing.
- Every view is legible and coherent in both system themes; no starter branding, Polish UI strings, or cosmic classes remain (grep-gated).
- Full CI suite green after each phase, including the updated risk8/auth specs and the new landing smoke.
