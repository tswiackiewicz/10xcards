---
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
---

## Why this stack

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
