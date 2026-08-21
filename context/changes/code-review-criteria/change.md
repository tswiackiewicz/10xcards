---
change_id: code-review-criteria
title: Code review criteria
status: impl_reviewed
created: 2026-08-20
updated: 2026-08-21
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

## A/B replay on the reconstructed calibration corpus — 2026-08-21

Phase 4. Two git worktrees, `38feec8` (pre-change, six criteria) and `e22dd7f` + the Phase 4
prompt fixes (post-change, five criteria), each with its own `npm ci`, both green on
`typecheck` and `test` before any replay call (pre: 111 tests, post: 117). `OPENROUTER_MODEL`
= `anthropic/claude-haiku-4.5` in **both** trees, at `temperature: 0`. Corpus fixtures in
`packages/code-review/evals/corpus/` — five diffs matching their recorded byte sizes exactly
(2581 / 10129 / 34831 / 1164 / 82567), plus title, body and hand-scored baseline per PR.

Every cell below is **two runs per rubric**; both runs agreed byte-for-byte in all ten cells,
so `temperature: 0` is in effect and no cell rests on a single reading. PR #7 was read across
**eight** runs (two per rubric plus two per self-fix attempt).

### Verdicts

| PR  | Baseline (corrected) | Old rubric | New rubric | Agreement |
| --- | -------------------- | ---------- | ---------- | --------- |
| #1  | passed               | passed     | passed     | both ✓    |
| #3  | passed               | passed     | passed     | both ✓    |
| #5  | passed               | passed     | passed     | both ✓    |
| #6  | passed               | passed     | passed     | both ✓    |
| #7  | **failed**           | passed ✗   | passed ✗   | both ✗    |

**Old rubric 4 of 5. New rubric 4 of 5. Tied, and the single disagreement is the same PR for
substantially the same reason.**

The plan set "3 of 5" as the number to beat, computed from the _recorded_ 2026-08-18 replay
where PR #5 failed on an over-tagged `data-retention` category. Replayed fresh today, the old
rubric does **not** reproduce that tag — PR #5 passes with four findings and no blocking
category in either rubric. So the honest comparison is fresh-vs-fresh, 4 of 5 either way, and
the old rubric's recorded weakness on #5 turns out not to be stable behavior. That is itself a
result: **the provider drifts across months even at `temperature: 0`**, which is consistent
with `agent.ts:14-19` ("no replay story may be built on the seed alone") and means any future
rubric comparison must re-run both arms rather than cite an old table.

### Scores

Old rubric (correctness / idiomaticity / complexity / testCoverage / documentation / security):

| PR  | Scores                       | Findings       |
| --- | ---------------------------- | -------------- |
| #1  | 10 / 10 / 10 / n/a / 10 / 10 | 0              |
| #3  | 10 / 10 / 10 / 5 / 10 / 10   | 2              |
| #5  | 8 / 9 / 9 / 8 / 9 / 8        | 4 (0 blocking) |
| #6  | 10 / 10 / 10 / n/a / 10 / 10 | 0              |
| #7  | 10 / 9 / 10 / 5 / 10 / 9     | 2              |

New rubric (defect / safety / blastRadius / verification / clarity):

| PR  | Scores                  | Findings       |
| --- | ----------------------- | -------------- |
| #1  | 10 / 10 / 10 / n/a / 10 | 0              |
| #3  | 10 / 10 / 10 / 5 / 9    | 2              |
| #5  | 7 / 7 / 8 / 5 / 9       | 4 (0 blocking) |
| #6  | 10 / 10 / 10 / n/a / 10 | 0              |
| #7  | 10 / 10 / 10 / n/a / 10 | 1              |

### Per-PR judgment

- **#1 (toolchain bump, 2.6 KB) — no criterion moved.** `verification: n/a` under both rubrics,
  correctly: a Node version bump adds no runnable logic, which is the one case the `n/a` default
  is for. Both rubrics agree with the baseline. No signal either way.
- **#6 (CI bump, 1.2 KB) — no criterion moved.** Same shape as #1, same correct `n/a`.
- **#3 (manual flashcard creation, 10.1 KB) — `verification` improved the note, not the verdict.**
  Old `testCoverage: 5` and new `verification: 5` both pass the gate (5 > `SINGLE_FAIL_MAX`), so the
  verdict is unchanged. The new note is materially better: it names the _specific_ claim it is
  refusing to credit — "PR claims manual verification … but no automated test covers the endpoint
  logic or form behavior". That is the anti-abuse text working as designed on this PR. The new
  rubric also found a real `defect`-class issue the old one missed (`createClient()` can return
  null but the guard treats it as falsy).
- **#5 (account deletion, 34.8 KB) — `defect` and `safety` moved, tightening the scores without
  moving the verdict.** Old `correctness: 8 / security: 8`; new `defect: 7 / safety: 7`, and
  `verification` dropped 8 → 5 with a note distinguishing what `verify-rls.mjs` actually covers
  from what it does not. The new rubric surfaced a timing side-channel in the constant-time bearer
  comparison (early-out on length mismatch leaks secret length) that the old rubric did not report.
  Predicted-and-confirmed: since the five blocking categories are unchanged, category behavior did
  not change — no tag fired in either rubric, so the `data-retention` over-tagging the plan
  expected to see again did not recur in either arm.
- **#7 (new code-review CLI, 82.6 KB) — the decisive case, and the new rubric does not fix it.**
  `verification: n/a` on a diff of 101 new lines of CLI logic with no test file, justified across
  eight runs as some combination of "not wired into CI", "requires an API key and a paid call", and
  "the PR description includes concrete manual verification steps". The old rubric scored
  `testCoverage: 5` here — **the old rubric is better on this PR**, and 5 is also not enough to fail
  it, so both arms disagree with the `failed` baseline. See "Unresolved" below.

### Baseline correction of record

`context/archive/2026-08-14-ci-cd-code-review/change.md:46-48` states that PR #7 "added 15
tests". **It did not.** The reconstructed diff is nine files — `AGENTS.md`, two eslint configs,
`.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json` and
`src/index.ts` (101 lines) — with **no test file**, and no calibration PR adds 15 tests (#6 is
the only one touching a test-named file at all). The archive is immutable and stays as it is;
the correction lives here, in `evals/corpus/pr-7.json`, and in `docs/criteria.md`.

This matters because the plan's Phase 4 criterion 4.6 was phrased as "must not score `n/a` on a
PR that added 15 tests". On the corrected facts, `n/a` is still wrong — the diff carries
untested testable logic, which `docs/criteria.md` says is a low score — but it is wrong for a
different reason than the plan assumed.

### Unresolved: criterion 4.6

`verification: n/a` on PR #7 survived two rounds of prompt strengthening (the self-fix budget
this run allowed):

1. **Attempt 1** — added "manual verification described in the PR body is not verification" to
   both the spec and the prompt's `n/a` block. Result: still `n/a`, and the note grew to cite
   _both_ forbidden justifications at once ("requires an API key … so automated testing is not
   feasible" **and** "manual verification steps are documented").
2. **Attempt 2** — replaced the prohibition with a positive closed-list precondition: `n/a` only
   when the diff adds or changes no runnable logic; if it adds any function, endpoint, component,
   handler, script or CLI, `verification` is a number. Result: still `n/a`, now reasoned as "diff
   adds no testable logic — it is a CLI entry point and a thin wrapper".

The verbose variant of attempt 2 was reverted (it cost +712 prompt characters on every review
for zero measured effect); the concise form of both fixes is kept, because the text is correct
regardless of whether Haiku obeys it, and it demonstrably _did_ work on #3 and #5.

**Assessment.** This is not an anti-abuse-sentence problem any more — three explicit
prohibitions and a mechanical precondition are all in the prompt and all read. The model has
decided that a CLI entry point is not testable logic. Two routes remain, both out of scope for a
criteria swap and both recorded here rather than attempted:

- **Mechanics**: refuse `n/a` on `verification` when the diff touches a non-config source path,
  in code rather than in the prompt. Deterministic, and the gate already owns the coercion layer.
- **Model**: escalate `OPENROUTER_MODEL` to a Sonnet-class model, which
  `context/archive/2026-08-14-ci-cd-code-review/change.md:100-107` already pre-authorizes for the
  over-tagging case.

**Criterion 4.6 is left unchecked.** The five-criterion rubric ships with better findings and a
tighter `verification` note on three of five PRs, and with a known blind spot on the fourth.

## Eval sweep baseline — 2026-08-21

Phase 5. `npm run eval` from inside `packages/code-review`, three configured models, on the
**five-criterion** rubric at commit `ce734fb` plus the Phase 5 fix to `promptfooconfig.yaml`.
Eval id `eval-Lz4-2026-08-21T11:12:15`. 27,440 grading tokens, 1m45s, no errors.

| Model             | verdict | precision | flaw_authz | flaw_cleanup | flaw_defaultprops | anchors |
| ----------------- | ------- | --------- | ---------- | ------------ | ----------------- | ------- |
| haiku-4.5         | 1       | 1         | 1          | 1            | **0**             | 1       |
| glm-5.1           | 1       | 1         | 1          | 1            | 1                 | 1       |
| deepseek-v4-flash | 1       | 1         | 1          | 1            | **0**             | 1       |

No metric row carries a `HARNESS ERROR:` reason. All six metric keys are present on all three
providers.

**These numbers supersede the pre-change baseline and are not comparable with it.** The earlier
sweep measured a different rubric — six criteria, different names, different anchors, a
different blocking set. Any comparison across that boundary is meaningless; this table is the
new zero point.

Two numbers the previous impl-review flagged as needing a billed run are now settled:

- **`precision` (`impl-review.md:141`)** — deepseek's recorded 0.50 was caused solely by the
  `invents a file or symbol` clause, corrected on 2026-08-20 to `invents a file it anchors to`.
  Re-measured: **deepseek scores 1**, as do the other two. The clause was the whole cause.
- **`flaw_defaultprops` (`impl-review.md:195-197`)** — see below; still unsettled, for a reason
  outside this change.

### `flaw_defaultprops` still fails to discriminate, and F3's remediation is still uncommitted

`flaw_defaultprops` scores **0 / 1 / 0** (haiku / glm / deepseek) — bit-for-bit the split the
F3 triage recorded (`impl-review.md:148-157`). So the metric is still discriminating on
willingness to speculate past the diff rather than on flaw detection, and it is still the only
metric separating the three models. **This is pre-existing and out of scope for a criteria
swap**, but the reason it did not move is worth stating precisely:

F3's recommended Fix A — add a call site that omits `pageSize`, so the empty-page break is
visible in the diff rather than inferable from it — **was written but never committed.** It sat
in the working tree as an unstaged edit to `evals/fixtures/react19-migration.diff`, which is
why `impl-review.md:190-193` describes the fixture as "now 281 lines" while the committed
fixture is not. The plan required that edit to be resolved before this sweep, so that the
baseline measures a recorded fixture rather than an unrecorded one.

**Resolution: reverted, not committed.** The sweep above therefore measures the _committed_
fixture. The edit itself was not discarded — it is preserved verbatim at
`context/changes/code-review-criteria/uncommitted-fixture-edit.patch` and restored to the
working tree after this phase's commit, exactly as it was found.

That leaves the F3 item where its own change left it: `code-review-evals` still owes a billed
sweep against the fixed fixture, and the `flaw_defaultprops` row above is not evidence about
Fix A either way. Committing another change's unreviewed fixture mutation into this change would
have made the new baseline measure something nobody signed off on — the opposite of a baseline.

## Impl-review triage — 2026-08-21

`reviews/impl-review.md`, verdict NEEDS ATTENTION: 0 critical, 4 warnings, 3 observations.
Decisions recorded there; the two that changed shipped behavior or accepted a cost:

- **F1 — gate condition 3 is structurally dead** (fixed, `5bb7a17`). Making `blastRadius`
  blocking left only two non-blocking criteria, so condition 3 cannot reach a count of three
  without including a blocking criterion — which fires condition 1 first. Exhaustive over all
  7,776 score combinations: 3,888 firings, none without condition 1. The same sweep shows no
  `clarity` score can flip a verdict. Three comments claimed the opposite (including one calling
  it "a deliberate tightening from 3-of-6") and were corrected; `ACCUMULATION_COUNT` stays at 3,
  since the plan forbade gate changes and the condition goes live again the moment a rubric adds
  a third non-blocking criterion.
- **F4 — the `n/a` prompt block grew 47%** (accepted). 1,017 → 1,493 characters, most of the
  +309 on `reviewInstructions` (6,290 → 6,599, +5%), paid on every review. The plan budgeted only
  the `criteria` block, so this went unmetered. Kept, because the added `verification` limits
  measurably tightened that score on PR #3 (8 → 5) and PR #5 (9 → 5) — the change's only measured
  win — even though they did not move PR #7. Recorded in a doc comment on the block itself so the
  next edit budgets the whole string.

The other five: F2 re-stamped criterion 2.4 to `5bb7a17`, the commit that actually made it true
(it was first flipped at `657c158`, which introduced the untrue comment). F3 added a dated
correction to `research.md` §C4 — the "PR #7 added 15 tests" premise is false, and that sentence
was the headline argument for the `testCoverage` → `verification` reframe, which is why criterion
4.6 failed across eight runs. O1–O3 are observations; see the report for their disposition.
