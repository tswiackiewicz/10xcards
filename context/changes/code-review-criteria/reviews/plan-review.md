<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Code Review Criteria Swap

- **Plan**: `context/changes/code-review-criteria/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE → **SOUND** after triage (all 10 findings fixed, 2026-08-21)
- **Findings**: 4 critical, 5 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | FAIL → PASS (F3, F10 fixed) |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → PASS (F1, F2 fixed) |
| Plan Completeness | FAIL → PASS (F4–F9 fixed) |

**Post-triage:** all ten findings were fixed in `plan.md` on 2026-08-21; every dimension now
reads PASS and the plan is SOUND. Progress↔Phase contract re-verified after each edit
(32 criteria ↔ 32 items, 5 phases matched, no stray checkboxes). The original assessment
follows.

Three FAILs would normally read RETHINK. Recorded as REVISE because the criteria set, the
ordering of Phases 1–3 and the decision to leave the architecture alone all verified sound
against the code. Every failure is concentrated in **Phase 4's method** (F2, F3) and in
reference hygiene (F4–F9). Phase 4 needs a rewrite rather than a patch; the concept of the
change does not.

## Grounding

13/13 paths ✓ (`docs/` new, expected), 10/10 symbols ✓, brief↔plan ✓,
Progress 5/5 phases ✓ 29/29 items ✓ (one `## Progress` heading, no stray checkboxes in
phase blocks).

## Findings

### F1 — Prompt-size claim is inverted; the rubric grows ~30%

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Performance Considerations; Phase 1 §2
- **Detail**: The plan states "The prompt gets shorter, not longer." Measured: the current
  `criteria` block is 3,323 chars / 33 lines; the block as written in Phase 1 is 4,923 chars /
  72 lines — **+48%**. The `n/a` block also gains a sentence and loses nothing structural.
  `reviewInstructions` goes from ~6,290 chars (~1,573 tokens) to roughly ~8,100 (~2,030
  tokens): **~29% more fixed cost on every review**. Cause: Phase 1 declares the
  Covers / Does-not-cover lines must appear "verbatim in both this file and the prompt".
- **Fix A ⭐ Recommended**: Covers/Does-not-cover live in the spec only; the prompt keeps
  today's shape (definition + anchors).
  - Strength: Keeps per-call cost flat while the spec keeps the full enumeration — which is
    where the missing-rationale gap actually was. The two load-bearing negative clauses stay
    in the prompt: clarity's "never report what ESLint/Prettier owns" folds into its anchors,
    verification's "expensive is not a reason for n/a" is already going into the n/a block.
  - Tradeoff: Prompt and spec are no longer literally identical, so a drift guard would have
    to compare only the parts that must match.
  - Confidence: HIGH — sizes measured directly from both files.
  - Blind spot: Whether trimmed anchors still convey the "does not cover" boundary well enough
    to suppress the failure modes; only Phase 4 shows that.
- **Fix B**: Keep the full text in the prompt and correct the Performance section.
  - Strength: Maximum explicitness; matches the research's own citation that telling a model
    what *not* to do is the high-value part of a prompt.
  - Tradeoff: ~29% more input tokens on every PR, permanently.
  - Confidence: HIGH on the cost; MED on the benefit.
  - Blind spot: Nobody measured whether the longer form scores better.
- **Decision**: FIXED via Fix A (2026-08-21) — Covers/Does-not-cover confined to the spec; prompt keeps definition + anchors plus three negative clauses, with a hard 3,323-char budget and a new automated check (1.2). Performance section rewritten to record the +48% / ~+29% measurement it previously got backwards.

### F2 — Phase 4 measures against a baseline the record itself disputes

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 (`handScored`), criterion 4.8
- **Detail**: The plan takes the five hand-scored verdicts from `change.md:19-25` as ground
  truth and targets "agrees with the hand-scored baseline more often than the old one's
  2-of-5". But `change.md:37-39` records that **PR #3's `failed` baseline was itself a false
  positive** ("no test infrastructure existed at that commit… Arguably better than the
  baseline"). The yardstick therefore penalises correct behaviour on 1 of 5 cases, and the
  2-of-5 denominator is computed against it — corrected, the old rubric scored 3-of-5, which
  is the number to beat. Second problem on the same criterion: `agent.ts:14-19` states in its
  own comment that the provider ignores `seed`, so "no replay story may be built on the seed
  alone" — a one- or two-case delta is within noise, yet 4.8 reads a bare count as signal.
- **Fix ⭐**: Correct the baseline (PR #3 → `passed`, with the change.md citation), restate the
  old rubric as 3-of-5, and replace "agrees more often" with a per-PR judgment plus at least
  two runs per rubric.
  - Strength: Removes a known-wrong ground-truth entry and makes a single flip visibly noise
    rather than evidence.
  - Tradeoff: Doubles Phase 4's call count (still cents on Haiku) and requires written
    reasoning, not just a table.
  - Confidence: HIGH — both the false positive and the seed caveat are stated verbatim in
    sources the plan already cites.
  - Blind spot: Whether two runs characterise variance; recorded evidence has determinism
    holding once (PR #3 byte-identical) and failing once (eval fixture).
- **Decision**: FIXED (2026-08-21) — `handScored` now records #3 as `passed` with the change.md:37-39 citation; the old rubric is restated as 3-of-5; criterion 4.8 split into two runs per rubric (4.8) and a per-PR written judgment (4.9).

### F3 — Phase 4's replay.ts is both unnecessary and unworkable as specified

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Lean Execution
- **Location**: Phase 4 §2
- **Detail**: The plan specifies a new `evals/corpus/replay.ts` and says "the old-rubric column
  comes from re-running the same script at the pre-change commit." That fails three ways:
  (1) the script does not exist at that commit; (2) typed against the five new keys it fails
  `tsc` there, because `Review["criteria"]` still has six keys; (3) `eslint.config.js:9`
  applies `strictTypeChecked` + `stylisticTypeChecked` with `projectService` to `evals/**`, so
  it must hand-declare its types the way `evals/provider.ts:8-29` does. It is also redundant:
  `src/cli.ts` already is this tool — stdin = unified diff (`:99-112`), argv
  `--title-file`/`--body-file`/`--cwd` (`:27-39`), stdout one JSON
  `{verdict, review, markdown}` (`:84`), model via `OPENROUTER_MODEL`.
- **Fix ⭐**: Drop `replay.ts`; drive `src/cli.ts` from two git worktrees
  (`git diff … | npm start -- --cwd <repo>` per worktree, `OPENROUTER_MODEL` pinned). Keep the
  corpus fixtures and their README.
  - Strength: No new file at either commit, so no criterion-shape coupling in the harness at
    all — removes the tsc, eslint and copy-the-script-backwards problems in one move.
  - Tradeoff: Each worktree needs its own `npm ci` inside the package (standalone package, own
    lockfile); the comparison table is assembled by hand or a shell loop.
  - Confidence: HIGH — cli.ts's contract read directly; ground truth still resolves in a
    worktree via the root `package-lock.json` fallback (`ground-truth.ts:27-46`).
  - Blind spot: `npm ci` time in a second worktree not measured.
- **Decision**: FIXED (2026-08-21) — `replay.ts` dropped. Phase 4 §2 is now a documented four-step worktree procedure driving `src/cli.ts`; criteria 4.2/4.3 replaced with a both-worktrees-green check and a pinned-`OPENROUTER_MODEL` check.

### F4 — Success criterion 1.2 cannot run, and damages the code if satisfied

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Automated Verification; Progress 1.2
- **Detail**: `grep -c "requirements.md" src/` errors with "Is a directory" — no `-r`. Worse,
  reaching 0 would be wrong. Of ten citations only **three** go stale: `prompts.ts:18`
  (criteria, `:36-91`), `prompts.ts:53` (n/a, `:93-117`), `render.ts:7` (label names). The
  other seven cite the **unchanged** gate and blocking-category spec — `verdict.ts:11,12,58,83`
  and `prompts.ts:66` — and because `context/archive/**` is immutable those line numbers still
  resolve. They are the provenance for thresholds this change must not touch.
- **Fix**: Replace 1.2 with a targeted check that the three criteria-specific citations now
  point at `docs/criteria.md`, and that the seven gate / blocking-category citations are
  untouched.
- **Decision**: FIXED (2026-08-21) — the grep-to-zero criterion is replaced by two targeted checks: three criteria citations repointed at `docs/criteria.md` (1.3), seven gate / blocking-category citations verified untouched (1.4).

### F5 — A judge rubric will state "all six criteria", unguarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 5 (unlisted file)
- **Detail**: `evals/promptfooconfig.yaml:137-138` — "The `criteria` notes are one-line score
  justifications that the schema requires for **all six criteria**…" — sits inside the
  precision rubric the judge reads, and becomes false. The transcription guard at
  `tests/unit/eval-asserts.test.ts:143-146` only checks the three `flaw_*` rubrics (sourced
  from `flaws.ts`), so nothing will flag this drift. The plan claims the eval suite survives
  untouched.
- **Fix**: Add the edit to Phase 5's change list and note that the precision rubric sits
  outside the transcription guard's coverage.
- **Decision**: FIXED (2026-08-21) — Phase 5 §1 is now the `promptfooconfig.yaml:137-138` edit, carrying the note that the precision rubric sits outside the transcription guard's coverage.

### F6 — Root README documents "a six-criterion rubric"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: not in any phase
- **Detail**: `README.md:195` — "reviews every non-draft, same-repo PR against a six-criterion
  rubric". Unlisted. For completeness: `.github/**` and `packages/code-review/evals/README.md`
  are genuinely criterion-agnostic, and `packages/code-review/README.md` does not exist, so
  this is the only doc hit outside `context/`.
- **Fix**: Add `README.md:195` to Phase 2's change list.
- **Decision**: FIXED (2026-08-21) — added as Phase 2 §3 (`README.md:195`), plus automated criterion 2.3: no prose outside `context/` still claims a six-criterion rubric.

### F7 — `npm run format` does not exist in this package

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Automated Verification; Progress 1.3
- **Detail**: `package.json` has `start`, `dev`, `test`, `eval`, `typecheck`, `lint`,
  `lint:fix` — no `format`. Prettier reaches this package only as the `prettier/prettier`
  ESLint rule, and `eslint .` does not lint `.md`, so `docs/criteria.md` has no enforcement
  inside the package. Root lint-staged does rewrite it on commit, using the **root** prettier
  config.
- **Fix**: Replace with `npx prettier --check docs/criteria.md`; note the root-config
  reformat-on-commit behaviour.
- **Decision**: FIXED (2026-08-21) — replaced with `npx prettier --check docs/criteria.md`, plus an explicit note that no `format` script exists and root lint-staged reformats with the root config on commit.

### F8 — Three verdict.ts comments go stale, unscheduled

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: Phase 2 schedules only the `ACCUMULATION_COUNT` doc comment. Also wrong after the
  change: `verdict.ts:21-23` ("The **two** dimensions that fail on 'unproven'… partition the
  **six** criteria"), `verdict.ts:65-67` ("'Other' because condition 1 already fails **the
  two** blocking dimensions" — and it no longer explains the `clarity` exemption), and
  `verdict.ts:72` ("accumulation across **all six** criteria").
- **Fix**: Add these three comment sites to Phase 2's contract.
- **Decision**: FIXED (2026-08-21) — Phase 2 §1 now enumerates four comment sites (`:21-23`, `:65-67`, `:72`, and the `ACCUMULATION_COUNT` doc comment), with manual criterion 2.4 to verify them.

### F9 — The eval coupling line range is wrong and incomplete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries; Phase 3 §3
- **Detail**: The plan names `tests/unit/eval-asserts.test.ts:32-37` as the only compile-time
  coupling. The criteria literal is `:31-38`, and there is a **second, independent** coupling
  at `:28` — `as Review["criteria"]["correctness"]` — which a rename of `correctness` breaks on
  its own.
- **Fix**: Correct the range to `:27-41` and name the `:28` cast explicitly.
- **Decision**: FIXED (2026-08-21) — corrected to `:27-41` in both Key Discoveries and Phase 3 §3, naming the `:28` cast as an independent second coupling alongside the `:31-38` literal.

### F10 — Two structural leftovers from drafting

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 5 §1; Phase 2 Manual Verification
- **Detail**: (a) Phase 5 §1 is a change entry whose contract reads "no further change" — a
  placeholder that survived drafting. (b) Phase 2's manual criteria 2.3/2.4 ("a hand-built
  review with `clarity: "1"` yields passed") are precisely what Phase 3's gate table asserts,
  and at the end of Phase 2 the suite is still red, so satisfying them means a throwaway
  script.
- **Fix**: Delete Phase 5 §1; move 2.3/2.4 into Phase 3 as named gate-table cases.
- **Decision**: FIXED (2026-08-21) — the no-op Phase 5 §1 is gone (replaced by the F5 edit); gate cases 2.3/2.4 moved into Phase 3's gate-table contract, and Phase 2's manual criterion is now the comment check from F8.
