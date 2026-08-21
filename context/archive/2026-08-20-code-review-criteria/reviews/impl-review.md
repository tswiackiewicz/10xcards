<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Code Review Criteria Swap

- **Plan**: `context/changes/code-review-criteria/plan.md`
- **Scope**: Phases 1–5 of 5
- **Date**: 2026-08-21
- **Verdict**: NEEDS ATTENTION — **triaged 2026-08-21: all 7 findings resolved** (6 fixed, 1 accepted)
- **Findings**: 0 critical, 4 warnings, 3 observations

> **Independence caveat**: this review was produced by the same session that implemented the
> change. Every claim is re-derived from files on disk and from executed code rather than from
> memory, and the exhaustive gate sweep in F1 is machine-checked — but F1 and F3 would benefit
> from a second reader.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Findings

### F1 — Gate condition 3 is now structurally dead, and two comments claim the opposite

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `packages/code-review/src/agents/reviewer/verdict.ts:18-23`; `packages/code-review/docs/criteria.md` (gate section)
- **Detail**: With three blocking criteria and only two non-blocking ones (`verification`,
  `clarity`), any set of three criteria at ≤5 must include a blocking one — which fires
  condition 1 first. Exhaustive check over all 7,776 score combinations (six values × five
  criteria): condition 3 fired 3,888 times and **never once without condition 1**. It can only
  ever append a redundant reason line to an already-failed verdict. The same sweep shows
  `clarity` flips `passed`→`failed` in **0** cases.
  The `ACCUMULATION_COUNT` doc comment calls this "a deliberate tightening from 3-of-6 to
  3-of-5", and `docs/criteria.md` repeats it. That is wrong: under six criteria there were four
  non-blocking criteria, so 3-of-6 could fire independently. The real effect is that the
  condition became inert. `docs/criteria.md` also says a low `clarity` "still counts toward the
  accumulation condition", implying a consequence it cannot have.
- **Fix A ⭐ Recommended**: Correct the three comments to state what is true — condition 3 can no
  longer fire independently, and `clarity` cannot affect a verdict — leaving the code unchanged.
  - Strength: Honest, zero behavior change, preserves the condition for a future rubric with
    more soft criteria. The plan's "not changing the gate mechanics" guardrail holds.
  - Tradeoff: Ships a condition that provably cannot fire; a reader may ask why it remains.
  - Confidence: HIGH — the 7,776-case sweep is exhaustive over the score domain.
  - Blind spot: Whether anyone wants condition 3 live enough to justify re-tuning
    `ACCUMULATION_COUNT` to 2.
- **Fix B**: Lower `ACCUMULATION_COUNT` to 2 so `verification` + `clarity` together can fail a PR.
  - Strength: Makes the condition live again and gives `clarity` real (non-solo) weight.
  - Tradeoff: Changes gate behavior, which the plan explicitly forbade — and `research.md`
    §Mechanika deliberately wants `verification` + `clarity` together to stay `passed`.
  - Confidence: MED — mechanically sound but contradicts two recorded decisions.
  - Blind spot: Not replayed against the corpus; could turn PR #3 or #5 (both `verification` 5)
    into failures.
- **Decision**: FIXED via Fix A — three comments corrected (verdict.ts ACCUMULATION_COUNT doc, verdict.ts condition-3 inline, docs/criteria.md gate section + "Which criteria block"). Code behavior unchanged; 118 tests, lint, typecheck, prettier all green.

### F2 — Criterion 2.4 was flipped on a comment that is not true

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/code-review-criteria/plan.md:727`
- **Detail**: 2.4 reads "The four rewritten `verdict.ts` comments each state something now true"
  and is checked `[x] — 657c158`. Three of the four do. The fourth (the `ACCUMULATION_COUNT` doc
  comment, added by that same commit) states the "deliberate tightening" claim F1 disproves.
  This is exactly the rubber-stamp the criterion existed to catch.
- **Fix**: Revert 2.4 to `- [ ]` until F1's comment fix lands, then re-flip it.
- **Decision**: FIXED via re-stamp (`5bb7a17`) — 2.4 stays checked but now points at the commit that actually made it true, with a note that it was first flipped at `657c158`, which introduced the untrue comment.

### F3 — research.md and the plan both assert PR #7 "added 15 tests"; the whole `verification` rationale rests on it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: `context/changes/code-review-criteria/research.md` §C4; `plan.md:504,560`
- **Detail**: Corrected during Phase 4 in `docs/criteria.md`, `change.md` and
  `evals/corpus/pr-7.json` — but only at the last hop. The false premise originates in the
  archive (`context/archive/2026-08-14-ci-cd-code-review/change.md:46-48`), propagates through
  `research.md` §C4, and from there into the plan.
  It is load-bearing, not incidental. `research.md` §C4 justifies the entire `testCoverage` →
  `verification` reframe with: _"Przy pytaniu 'czy w tym diffie jest test dotykający tej
  ścieżki' odpowiedź na PR-ze z 15 testami jest trywialnie 'tak'."_ On the true facts (nine
  files, zero test files) the reframed question answers "no", so the predicted trivial win never
  existed — which is precisely why gate 4.6 failed across eight runs. The criterion remains
  defensible on its other grounds (κ 0.10–0.21 for judging test adequacy), but its headline
  argument is void.
- **Fix A ⭐ Recommended**: Add a dated correction note to `research.md` §C4 recording that the
  15-tests premise is false and which part of the argument survives without it.
  - Strength: Stops the next change inheriting the error a fourth time; keeps the surviving
    rationale intact and attributable.
  - Tradeoff: Edits a research artifact after the fact — though it lives in `context/changes/`,
    not the immutable `context/archive/`.
  - Confidence: HIGH — verified by file-listing all five reconstructed corpus diffs.
  - Blind spot: Whether the reframe would have been chosen at all had the premise been checked
    at research time.
- **Fix B**: Leave `research.md` and rely on the corrections already in `docs/criteria.md` and
  `change.md`.
  - Strength: Research artifacts stay a faithful record of what was believed at the time.
  - Tradeoff: `research.md` is what the next rubric change reads first; the correction lives
    three files away.
  - Confidence: MED — depends on reading habits.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (`df0fe60` working tree) — dated `KOREKTA — 2026-08-21` block added to `research.md` §C4 in Polish to match the document, plus a flag on the summary-table row at line 189. Records the nine-file/zero-test fact, that the predicted win never existed, that this is why 4.6 failed across eight runs, and which half of the argument (κ 0.10–0.21) survives without the premise.

### F4 — The `n/a` block grew 47% for a prohibition that does not work

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `packages/code-review/src/agents/reviewer/prompts.ts:48-59`
- **Detail**: Measured: the `criteria` block went 3,323 → 3,156 chars (−5%, inside the plan's
  budget), but the `notApplicable` block went 1,017 → 1,493 (**+47%**) and total
  `reviewInstructions` 6,290 → 6,599 (+5%), paid on every review. The plan budgeted only the
  criteria block, so this growth passed unmetered.
  The plan's contract for this block was "replaces the three default cases with these three,
  plus **one** added sentence". It ships with a rewritten `verification` case (closed-list
  precondition) plus two added sentences, and a fourth clause on the `verification` criterion
  line that the plan explicitly said needed nothing extra. All of it is Phase 4 remediation for
  gate 4.6 — which still fails.
- **Fix A ⭐ Recommended**: Keep it. The text demonstrably tightened `verification` on PR #3
  (8 → 5) and PR #5 (9 → 5), which is where the value landed even though #7 did not move.
  - Strength: Two of five corpus PRs measurably improved; reverting gives back a real gain to
    save ~470 characters.
  - Tradeoff: +5% input cost per review, permanently, and a prompt section this model provably
    reasons around.
  - Confidence: HIGH — both effects measured across two runs each.
  - Blind spot: Whether the #3/#5 tightening came from these sentences or from the criterion
    rewrite alone — the two were not isolated.
- **Fix B**: Trim to the plan's one-sentence contract and accept looser `verification` scores.
  - Strength: Restores the plan's budget discipline; removes text this model demonstrably
    reasons around.
  - Tradeoff: Likely gives back the #3/#5 improvement, which is the change's only measured win.
  - Confidence: MED — the attribution above is untested.
  - Blind spot: Needs another billed replay to confirm either way.
- **Decision**: ACCEPTED via Fix A (`df0fe60`) — text kept; the measured cost (1,017 → 1,493 on the block, 6,290 → 6,599 overall) is recorded in a doc comment on `notApplicable` and in `change.md`, with the instruction to budget the whole string next time.

### O1 — Gate reasons print schema keys while the score table prints display labels

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `packages/code-review/src/agents/reviewer/verdict.ts:58` (`label()`) vs `render.ts:8`
- **Detail**: One PR comment now reads "Blocking criterion at or below 5: blastRadius (5)" above
  a table row "blast radius and reversibility". Pre-existing behavior, but the camelCase key
  reads worse than `correctness` did.
- **Fix**: Have `label()` resolve through `CRITERION_LABELS`.
- **Decision**: FIXED (`df0fe60`) — `CRITERION_LABELS` moved to `schema.ts` (render.ts imports verdict.ts, so the map could not stay where it was without the gate depending on the markdown layer); `label()` routes through it. Two verdict tests re-pinned to display names. Rendered output verified consistent.

### O2 — The precision judge rubric is still outside the transcription guard

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `packages/code-review/evals/promptfooconfig.yaml:138`; `tests/unit/eval-asserts.test.ts:143-146`
- **Detail**: Phase 5 fixed the "all six criteria" drift in the precision rubric, but nothing
  prevents the next one — the guard only covers the three `flaw_*` rubrics sourced from
  `flaws.ts`. The plan flagged this as informational and this change carried it as such.
- **Fix**: Extend the transcription guard to assert the precision rubric's criterion count
  against `Object.keys(reviewSchema.shape.criteria.shape).length`.
- **Decision**: FIXED (`df0fe60`) — the transcription guard now pins the precision rubric's criterion count to `Object.keys(reviewSchema.shape.criteria.shape).length`. Break-checked: reverting the YAML to "six" turns it red.

### O3 — Corpus ships 10 files beyond the plan's contract

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `packages/code-review/evals/corpus/pr-*.{title,body}`
- **Detail**: The plan specified `pr-<n>.diff` + `pr-<n>.json` only. The `.title`/`.body` files
  duplicate JSON fields so the CLI can be fed without a `jq` step; the corpus README documents
  the JSON as the record, and all ten files currently match their JSON — but nothing enforces
  that, so a JSON edit can silently leave them stale.
- **Fix**: Either drop them and pipe through `jq`/`python -c`, or assert the match in a test.
- **Decision**: FIXED via "assert the match in a test" (`df0fe60`) — new `tests/unit/corpus.test.ts` pins the five byte sizes, pins `.title`/`.body` to the JSON record, requires a citation on every baseline verdict, and pins the corrected baseline so PR #3's correction cannot be silently reverted. Break-checked on a drifted `pr-3.json`.

## Verified clean

- All 15 automated success criteria re-run and passing: doc + five names + fifteen anchors;
  criteria block 3,156 ≤ 3,323 with no `Covers:` text; three criteria citations →
  `docs/criteria.md` and seven gate citations still → `requirements.md`; prettier; typecheck;
  lint; 118 tests; all five corpus byte sizes exact; eval results with six metric keys and no
  `HARNESS ERROR`.
- Root and package prettier configs **agree** on the new markdown — the config ping-pong the
  plan warned about (criterion 1.5's note) does not occur.
- `docs/criteria.md`'s "Why these five" is fully grounded in `research.md`: §C3 for
  `blast-radius` as the absent dimension, the old→new mapping table for each collapse, and
  lines 187-193 for the missing-design-rationale claim about `idiomaticity`/`complexity`. Checked
  specifically because that section was written without `research.md` in context.
- No credential patterns in the corpus fixtures; all five diffs are already-public history.
- Scope guardrails held: the eleven-value string score scale, the four thresholds (5/3/5/3), the
  five blocking categories and their scoping sentence, the workflow, the label mapping,
  `MAX_DIFF_BYTES` and `MAX_BODY_CHARS` are all untouched.
- Manual rows 1.6–1.8, 3.5, 3.6, 4.4, 4.5, 4.8, 4.9, 5.3–5.5 each have observable evidence in
  the diff or in `change.md`. 4.7 was flipped on an inverted premise (PR #5 fired _no_
  conditions rather than the expected `data-retention` tag) but the deviation is recorded
  explicitly in `change.md`, so it is not a rubber-stamp.

## Overall

The change delivers what it set out to: a canonical spec that did not previously exist, five
auditable criteria replacing two that had no recorded rationale, a reusable calibration corpus,
and better findings on two of five corpus PRs. What it does **not** deliver is a measurably
better gate — verdict agreement is tied 4-of-5 against 4-of-5, no PR failed in either arm, and
criterion 4.6 remains unmet. F1 adds to that picture: one of the four gate conditions is now
inert. None of this is a reason to revert; it is a reason not to describe this change as a gate
improvement, and to treat the `n/a`-floor and score-scale work the research proposed (both
scoped out here) as the actual next step.
