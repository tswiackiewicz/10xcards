<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Quality-Gates Wiring (Rollout Phase 4)

- **Plan**: context/changes/testing-quality-gates-wiring/plan.md
- **Scope**: Full plan (Phases 1–3, all complete)
- **Date**: 2026-07-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — CI log may leak `SUPABASE_DB_PASSWORD` on a connection failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml` — "Verify migrations fully applied" step (deploy job)
- **Detail**: `output=$(supabase db push --dry-run 2>&1); echo "$output"` prints the full CLI output to CI logs. The Supabase CLI can emit a raw Postgres connection string (`postgresql://postgres:<password>@host:port/...`) on a connection failure. GitHub Actions auto-masks exact literal-secret matches, but a URL-encoded password (containing `@`, `/`, `+`, `%`) won't match the raw secret string, defeating the mask. This is a pre-existing pattern (the `ci` job's original dry-run check has the same exposure via direct stdout), but this plan's new step re-introduces it in a second place.
- **Fix**: Redact `postgres(ql)?://` substrings before echoing, e.g. `output=$(... | sed -E 's#://[^:]+:[^@]+@#://***:***@#g')`, or only echo the specific lines needed (`grep -E "up to date|Would push"`) instead of full output.
- **Decision**: FIXED — piped `echo "$output"` through `sed -E 's#(postgres(ql)?://[^:]+:)[^@]+(@)#\1***\3#g'` in `.github/workflows/ci.yml`'s "Verify migrations fully applied" step.

### F2 — Grep sentinel is a bare, unanchored substring match

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:80` (approx) — `grep -q "is up to date" <<< "$output"`
- **Detail**: The plan's own "Critical Implementation Details" section already names and accepts this exact coupling to the CLI's current wording as a deliberate tradeoff, not an oversight. Flagging for completeness: a coincidental unrelated string match would fail _unsafe_ (deploy proceeds with pending migrations), while a CLI wording change fails _safe_ (gate blocks everything). Anchoring tighter would reduce (not eliminate) the unsafe-failure surface.
- **Fix**: Anchor the pattern, e.g. `grep -qE '^Remote database .* is up to date\.?$'`, or corroborate with a second check for absence of `"Would push"`.
- **Decision**: FIXED — changed to `grep -qE "is up to date\.?$"` in `.github/workflows/ci.yml`; updated plan.md's Critical Implementation Details to match.

### F3 — Branch protection configured despite the plan's explicit "What We're NOT Doing" exclusion

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: GitHub repo settings (`master` branch protection) — not a file in this repo
- **Detail**: The plan states verbatim: "Not configuring GitHub branch-protection required-status-checks via API/code — that's a manual, repo-external action; this plan only reminds." During this session, `gh api PUT .../branches/master/protection` was used to configure branch protection requiring the `ci` status check (confirmed live: previously 404 "Branch not protected", now requires `ci`). This was done with explicit real-time user consent when 3.3 was being verified, but the plan text itself was never updated to reflect that the boundary moved.
- **Fix A ⭐ Recommended**: Keep the branch-protection change (it's live, tested — a real push already succeeded with an admin-bypass notice, non-admins would now be blocked on `ci`) and update the plan's "What We're NOT Doing" section to record this as an in-session addendum.
  - Strength: Preserves a genuine improvement (master had zero protection before) and keeps the plan accurate as the source of truth.
  - Tradeoff: The plan's original scope boundary is now documented as "amended," which some readers may see as scope creep even though it was consented.
  - Confidence: HIGH — the change is already live, verified via `gh api`, and matches the spirit of what 3.3 was trying to confirm/achieve.
  - Blind spot: Haven't checked whether other repo automation (bots, other contributors) push directly to master in a way that would now be blocked as non-admins.
- **Fix B**: Revert branch protection to keep strict scope discipline; leave 3.3 as "confirmed unconfigured, flagged for a separate change."
  - Strength: Plan's original boundary stays untouched — literal scope discipline.
  - Tradeoff: Reintroduces the exact gap (a red `ci` run doesn't block anything) that made 3.3 worth having in the plan at all.
  - Confidence: MEDIUM — reverting a security-positive change to satisfy a planning technicality is a judgment call, not a clear win.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — kept branch protection live; added an addendum note under "What We're NOT Doing" in plan.md documenting the in-session scope change.

### F4 — Phase 3's actual diff has one more step than the plan's contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `.github/workflows/ci.yml` — "Export Supabase credentials for the e2e web server" step (ci job)
- **Detail**: Phase 3's contract specified exactly two new lines (`playwright install`, `npm run test:e2e`) and stated "No new env vars." The actual diff has a third step exporting `SUPABASE_URL`/`SUPABASE_KEY` to `$GITHUB_ENV`, added in a follow-up fix commit (`a40e578`) after the real CI run revealed Playwright's `globalSetup` doesn't reliably propagate env to the separately-spawned `npm run dev` process. The fix itself is sound and narrowly scoped (only two non-secret local values, write-only to `$GITHUB_ENV`, no stdout leak) — this is a documentation-accuracy finding, not a code finding.
- **Fix**: Update Phase 3's Contract text in plan.md to include this step and correct the "No new env vars" claim.
- **Decision**: FIXED — Phase 3's Contract in plan.md now includes the credential-export step and a correction note explaining why "no new env vars" didn't hold.

### F5 — 1.3/1.4 verified via real production + dry-run, not a "scratch project"

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Progress rows 1.3/1.4
- **Detail**: The plan's Manual Verification called for a "disposable/scratch Supabase project." No external account was created; instead, a temporary `workflow_dispatch` workflow rehearsed both the pass and fail cases against the real production project using `--dry-run` only (never mutating), then was fully removed (commits `09c56b6`/`302527c` — confirmed clean, no residual references). This is arguably stronger evidence (the real target, not a proxy), but the row titles still say "Scratch-project rehearsal."
- **Fix**: Update the Progress row text (or add a note) to describe the actual method used, so a future reader isn't confused about what "scratch-project" refers to.
- **Decision**: FIXED — Progress rows 1.3/1.4 in plan.md now describe the actual rehearsal method (temporary `workflow_dispatch` workflow, dry-run only, against real production, then removed).

### F6 — Repeated `env:` blocks across three CI steps

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.github/workflows/ci.yml` — dry-run check, push, and verify steps all repeat the same 3-line `env:` block
- **Detail**: Not a safety issue (this was true before this plan too). Could be hoisted to job-level `env:` to reduce repetition. Out of scope for this diff — noted for a future cleanup pass, not this change.
- **Fix**: Hoist `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD`/`SUPABASE_PROJECT_ID` to the `deploy` job's top-level `env:` block.
- **Decision**: FIXED — hoisted the three secrets to the `deploy` job's top-level `env:` block in `.github/workflows/ci.yml`; removed the two duplicated step-level blocks. Verified YAML still parses.
