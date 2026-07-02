---
bootstrapped_at: 2026-06-15T16:25:56Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: 10x-cards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-cards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

10xCards is a solo, after-hours, 3-week web-app whose core is AI flashcard generation
behind per-user accounts — and the 10x Astro Starter delivers every load-bearing piece
without wiring: Supabase supplies email+password auth and Postgres with row-level
security, directly satisfying the per-user isolation and no-loss guardrails (FR-001/002,
access control); Astro API routes are a natural home for the LLM generation call
(FR-003/004), with TypeScript and Zod giving typed boundaries for candidate-card
payloads. One opinionated stack across UI, data, auth, and deploy minimizes integration
work, which suits the tight after-hours timeline. Cloudflare Pages is the starter's
default deploy target; GitHub Actions auto-deploys on merge to main. The only caveat:
the Cloudflare edge runtime constrains long-running tasks, but generation is
request/response (with visible progress per the >2s NFR) and the MVP has no background
jobs, so this is a heads-up rather than a blocker. No payments, realtime, or background
jobs are in scope.

## Pre-scaffold verification

| Signal       | Value                                              | Severity | Notes                                                    |
| ------------ | -------------------------------------------------- | -------- | -------------------------------------------------------- |
| npm package  | not run                                            | n/a      | cmd_template starts with `git clone`; no npm create CLI  |
| GitHub repo  | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url; within last 3 months                 |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold cleanup**: deleted (cloned `.git/` removed before move-up so upstream history did not leak)

Moved entries (20): `.env.example`, `.github`, `.gitignore`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `astro.config.mjs`, `CLAUDE.md.scaffold` (sidelined; cwd `CLAUDE.md` won), `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `README.md`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`.

Preserved in cwd (never overwritten): `context/`, `CLAUDE.md`, `.claude`, `.agents`, `idea-notes.md`, `skills-lock.json`.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 11 HIGH, 7 MODERATE, 0 LOW (18 total)
**Direct vs transitive**: direct 0/5/1/0 of total 0/11/7/0 (CRITICAL/HIGH/MODERATE/LOW)

Note: `npm install` printed an aggregated "15 vulnerabilities (7 moderate, 8 high)" line; the authoritative per-severity counts from `npm audit --json` metadata are recorded above (18 total). The HIGH cluster chains predominantly through the `esbuild` → `vite` dev-toolchain path, common to fresh Astro + Vite + Cloudflare trees. No auto-fix was applied — bootstrapper informs; you decide.

#### CRITICAL findings

None.

#### HIGH findings

| Package                  | Direct? | Via (cause chain)                                                                                              |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| @astrojs/cloudflare      | direct  | astro, vite, wrangler                                                                                          |
| @astrojs/react           | direct  | @vitejs/plugin-react, vite                                                                                      |
| @tailwindcss/vite        | direct  | vite                                                                                                           |
| astro                    | direct  | esbuild, vite                                                                                                  |
| wrangler                 | direct  | esbuild, miniflare                                                                                             |
| @cloudflare/vite-plugin  | transitive | miniflare, vite, wrangler, ws                                                                              |
| @vitejs/plugin-react     | transitive | vite                                                                                                       |
| devalue                  | transitive | Svelte devalue: DoS via sparse array deserialization                                                      |
| esbuild                  | transitive | esbuild: missing binary integrity verification (Deno/NPM_CONFIG_REGISTRY RCE); arbitrary file read via dev server on Windows |
| vite                     | transitive | esbuild                                                                                                    |
| vitefu                   | transitive | vite                                                                                                       |

#### MODERATE findings

| Package               | Direct? | Range / Via                                                                                  |
| --------------------- | ------- | -------------------------------------------------------------------------------------------- |
| @astrojs/check        | direct  | via @astrojs/language-server                                                                 |
| @astrojs/language-server | transitive | via volar-service-yaml                                                                   |
| miniflare             | transitive | via ws                                                                                     |
| volar-service-yaml    | transitive | via yaml-language-server                                                                    |
| ws                    | transitive | ws: uninitialized memory disclosure (8.0.0 - 8.20.0)                                        |
| yaml                  | transitive | yaml: stack overflow via deeply nested YAML collections (2.0.0 - 2.8.2)                     |
| yaml-language-server  | transitive | via yaml                                                                                    |

#### LOW / INFO findings

None.

## Hints recorded but not acted on

v1 reads these hints and carries them into this log without acting on them. A future M1L4 ("Memory Architecture") skill — or a later bootstrapper version — may act on them.

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review the `CLAUDE.md.scaffold` sibling the conflict policy created — `diff CLAUDE.md CLAUDE.md.scaffold` to see what the starter shipped vs what you had, then decide which version of each section to keep.
- Copy `.env.example` to `.env` and fill in Supabase + Cloudflare credentials before running the app.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The HIGH findings are dev-toolchain transitive advisories (esbuild/vite); `npm audit fix` resolves most without breaking changes.
