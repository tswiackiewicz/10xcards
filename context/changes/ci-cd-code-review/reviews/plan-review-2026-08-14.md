<!-- PLAN-REVIEW-REPORT -->

# Plan Review: AI Code Review CI/CD Workflow

- **Plan**: `context/changes/ci-cd-code-review/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE → **SOUND** after triage (all 10 findings fixed 2026-08-14)
- **Findings**: 3 critical, 4 warnings, 3 observations

Two dimensions score FAIL, which the rubric would map to RETHINK — but no finding challenges the
approach. The architecture holds. The failures are uniform and narrow: **the plan specified the happy
path and left three failure paths undefined** (API error, empty diff, oversized diff). F1, F2 and F6
are the same gap seen from three angles.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | FAIL    |

## Grounding

10/10 existing paths ✓ · 5/5 new paths correctly absent ✓ · Progress↔Phase 4/4 headings, 27 items,
zero checkboxes outside `## Progress` ✓ · brief↔plan ✓ · blast radius: no importers of
`packages/code-review` outside the package ✓ · `docs/reference/contract-surfaces.md` absent (check
skipped) · **`actionlint` not installed — two success criteria depend on it (see F7)**

## Findings

### F1 — A failed review leaves the PR with a stale label and no comment

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — steps 7 and 8
- **Detail**: The step list carries no `if:` anywhere. The CLI exits 1 on an OpenRouter error, on model
  output failing schema validation, and — by the plan's own design — on a diff above `MAX_DIFF_BYTES`.
  When the composite action fails, steps 7–8 are skipped: no comment, no label. Worse, a prior run's
  `ai-cr:passed` stays attached, so a PR that could not be reviewed looks reviewed and passed. Research
  explicitly recommended `if: always()` on both steps; the plan dropped it. Also unresolved: what
  verdict represents "the review could not run".
- **Fix A ⭐ Recommended**: Add a third `error` state plus `if: always()` on the comment and label steps
  - Strength: The PR always gets a signal; no "silence means success" state. Removing both verdict
    labels on error eliminates the false `passed`.
  - Tradeoff: The third state has to be threaded through the action, the workflow and the renderer —
    three places at once.
  - Confidence: HIGH — `if: always()` is a documented pattern, and `|| true` on the label DELETE is
    already in the plan.
  - Blind spot: Not verified whether `continue-on-error` on the action step propagates an empty output
    cleanly to dependent steps.
- **Fix B**: Let the steps fail, add a cleanup step that strips stale labels
  - Strength: Smaller change; a red job is itself a signal.
  - Tradeoff: No explanatory comment — the PR author sees a red job with no reason, and on an advisory
    check that is easy to miss entirely.
  - Confidence: MEDIUM — works, but communicates worse.
  - Blind spot: Not checked whether a red advisory job is visible in the PR UI without opening Checks.
- **Decision**: FIXED via Fix A (error state + `if: always()`)

### F2 — The empty-diff branch has no defined wiring

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — step 5 vs steps 7–8
- **Detail**: Step 5 says "skip the review step, set verdict `passed`, and use a fixed 'no reviewable
  changes' comment body", but step 7 reads `steps.review.outputs.comment-path`. With the action
  skipped, that output is empty and `-F body=@""` fails. The plan never says where the fixed body comes
  from or how the verdict is set on that path — the implementer has to guess. Related: the Phase 4 row
  "Empty diff is safe / PR with no file changes" is close to unexecutable, since GitHub refuses to open
  a PR with no differences ("There isn't anything to compare").
- **Fix**: Introduce a single "resolve outputs" step that sets `verdict` and `comment-path` in
  `$GITHUB_OUTPUT` from either the action's output or the fallback branch. Steps 7–8 read only from it,
  never from the action directly. Also rewrite the Phase 4 row into an executable scenario.
- **Decision**: FIXED (single `resolve outputs` step; Phase 4 row made executable)

### F3 — Phase 2 cannot pass its own success criteria

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — criteria 2.1 and 2.3 vs Changes Required
- **Detail**: Criterion 2.1 requires "a `workflow_dispatch` smoke workflow invoking the action against a
  fixture diff completes green", but Phase 2's Changes Required lists only `action.yml` and
  `ai-review-labels.yml` — the smoke workflow is never declared as a deliverable. It also needs
  `OPENROUTER_API_KEY`, which Phase 3 #4 adds. Criterion 2.3 needs a real LLM call, so it needs the
  secret too. Phase 2 is blocked by Phase 3; the phase order is inverted.
- **Fix A ⭐ Recommended**: Move the secret to a prerequisite ahead of Phase 1, and declare the smoke
  workflow as an explicit Phase 2 deliverable
  - Strength: The secret is manual and repo-external — it belongs to no code phase. Migration Notes
    already treat it that way ("confirm both before Phase 4"), so this only closes an inconsistency.
  - Tradeoff: Phase 2 still spends real tokens on the fixture diff.
  - Confidence: HIGH — this is bookkeeping, not a design change.
  - Blind spot: Undecided whether the smoke workflow stays in the repo permanently or is removed after
    Phase 2.
- **Fix B**: Drop 2.1/2.3 and defer action verification to Phase 4
  - Strength: No extra files and no token cost in Phase 2.
  - Tradeoff: Phase 2 ends with no evidence the action works at all — a manifest error surfaces two
    phases later.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (secret → Prerequisites; smoke workflow declared)

### F4 — The package step in the `ci` job blocks every merge in the repo

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 #2, Migration Notes
- **Detail**: The plan justifies the step's placement by "inherits branch protection". The unstated
  corollary: `ci` is the required check, so a broken or flaky test in `packages/code-review` now blocks
  merges of entirely unrelated work. That was a deliberate choice, but its cost is never named. The
  rollback note is also incomplete — "Rollback is deleting `ai-code-review.yml`" does not remove the
  `ci.yml` step, which is the part that actually blocks merges.
- **Fix**: State the tradeoff in Phase 3 #2 and extend Migration Notes with a separate rollback path for
  the `ci.yml` step.
- **Decision**: FIXED (tradeoff stated; two-lever rollback in Migration Notes)

### F5 — The `Verdict` type is used but never defined

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #2 vs #5 and #7
- **Detail**: #5 declares `renderMarkdown(review: Review, verdict: Verdict)` and #7 re-exports "the
  `Verdict` type", but #2's contract exports only `PASS_THRESHOLD` and a `deriveVerdict` returning an
  inline union.
- **Fix**: `verdict.ts` exports `export type Verdict = "passed" | "failed"`, and `deriveVerdict` returns
  `Verdict`.
- **Decision**: FIXED (`Verdict` type exported from verdict.ts)

### F6 — `MAX_DIFF_BYTES` undercuts the stated rationale for local `git diff`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 #6, Phase 3 step 3
- **Detail**: The local-`git diff` decision was justified by escaping the API ceiling (1 MB / 20k lines /
  300 files). The plan then imposes a 400 KB cap — tighter than the limit it was avoiding. Not wrong,
  but the rationale now reads as self-contradictory, and the number is unvalidated. Combined with F1, a
  PR over the cap currently gets no comment at all.
- **Fix**: Justify the cap on token cost and context window (not the API limit), mark 400 KB as a
  starting value to calibrate in Phase 4, and route the oversize path through F1's comment.
- **Decision**: FIXED (cap justified on token cost; calibration in Phase 4)

### F7 — Two success criteria depend on `actionlint`, which is not installed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: criteria 2.2 and 3.3
- **Detail**: `command -v actionlint` → absent. The plan never installs it, and the repo has no YAML
  validation at all (`.yml` is in no lint-staged glob and no hook) — so these two new files have no
  safety net whatsoever.
- **Fix**: Add a `rhysd/actionlint` step to CI, or record `brew install actionlint` as a prerequisite.
  Do not leave a success criterion that cannot be run.
- **Decision**: FIXED (actionlint step added to ci.yml in Phase 2)

### F8 — `--format=markdown` is a dead code path in CI

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 #6
- **Detail**: The action uses `--format=json` and extracts `.markdown` with jq. The `markdown` mode
  serves only local use and one manual check, yet carries a flag, a code branch, and test coverage
  ("argv parsing (defaults, each flag)").
- **Fix**: Drop the flag; the envelope is the single output shape. `jq -r .markdown` covers local
  preview.
- **Decision**: FIXED (`--format` flag dropped; envelope is the only output)

### F9 — `paths-ignore` narrows "every new pull request" without flagging the deviation

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: What We're NOT Doing vs Phase 3 step 1
- **Detail**: `requirements.md:3` says "GHA workflow run for every new pull request to master". The plan
  skips forks, drafts, Dependabot and `paths-ignore` paths. The first three are listed in "What We're
  NOT Doing"; `paths-ignore` is not. Side effect: the plan's own Phase 3 documentation edits would not
  trigger a review on their own PR.
- **Fix**: Add `paths-ignore` to "What We're NOT Doing" as an explicit deviation from requirements.
- **Decision**: FIXED (paths-ignore added to What We're NOT Doing)

### F10 — The formatter garbled three load-bearing lines

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan.md lines 66, 300, 305
- **Detail**: The prettier hook mangled nested backticks and asterisks. Line 305 currently reads
  ``\*_no automatic `INPUT\__` env vars`` — one of the composite-action warnings. Line 66 (the
  `.gitignore` `10x-*` trap) is equally unreadable. Both are load-bearing.
- **Fix**: Rewrite those three lines without emphasis markers inside code spans.
- **Decision**: FIXED (three lines rewritten without nested emphasis)
