<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: promptfoo Model Sweep for the Code Reviewer

- **Plan**: `context/changes/code-review-evals/plan.md`
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-08-19 (triaged 2026-08-20)
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Context for the verdict: no finding is a shipping risk — `evals/` is hand-run tooling that no
CI job touches and no production path imports. Every warning is either an _eval-validity_
concern (the sweep may mis-score a model) or a _misattribution_ concern (a harness bug reads as
a model result). Those matter because the artifact's entire purpose is to be believed when
choosing a model.

## Verification performed

All Phase 1–4 automated success criteria were re-run and pass:

| Criterion                                                           | Result                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1.1 `npm test` — same 7 files                                       | 7 files, 87 tests pass                                                                          |
| 1.2 `npm run typecheck`                                             | clean                                                                                           |
| 1.3 `npm run lint`                                                  | clean                                                                                           |
| 1.4 `npx vitest list --filesOnly`                                   | exactly the 7 pre-existing files; nothing from `evals/`                                         |
| 2.1 Fixture is a well-formed unified diff                           | `git apply --stat` parses it (3 files, +79/−108)                                                |
| 2.4 150+ lines, exactly 3 files                                     | 273 lines, `grep -c '^diff --git'` = 3                                                          |
| 3.2/3.3/3.4 Three labelled providers, `verdict` + `anchors` present | `haiku-4.5`, `glm-5.1`, `deepseek-v4-flash`, all metrics present                                |
| 3.6 At least one `verdict` = 1                                      | all three = 1                                                                                   |
| 3.7 No provider `error`                                             | none (the `error` strings in `results.json` are failing-assert reasons, not transport failures) |
| 4.2 CSV carries all six `Metric:` columns                           | ×3 providers = 18 metric columns                                                                |
| 4.3 Every provider row carries all six metrics                      | confirmed                                                                                       |
| 4.4 No `metadata.graderError: true`                                 | none anywhere in `results.json`                                                                 |
| 4.6 Models score visibly differently                                | glm 6/6; haiku and deepseek both miss `flaw_defaultprops` and fail `precision` (0.67 / 0.50)    |

`npm run eval` was **not** re-run — it makes billed calls and the plan records that every run
pays in full. Phase 3/4 criteria were verified against the on-disk artifacts from the
2026-08-19 18:49 run instead, which reflect the intact fixture (`glm-5.1` scores
`flaw_defaultprops` = 1, so the deliberate-break edit was reverted before that run).

Contract compliance was verified line by line: no test-level `threshold` (confirmed `null` in
the recorded testCase), `verdict` weight 2, four rubrics at `threshold: 0.7`, no `weight: 0`
anywhere, judge = `openrouter:openai/gpt-5` at `temperature: 0` with no per-assert override.
The three rubric strings are byte-identical between `flaws.ts` and `promptfooconfig.yaml`
(modulo one YAML-clip trailing newline). Scope guardrails: 15/16 planned items MATCH, 0
MISSING, 0 scope violations — no `src/` change, no `.github/` change, promptfoo absent from
`dependencies` and `devDependencies`.

The `anchors` assert was confirmed **live**, not vacuously passing: `results.json` stores
`vars.diff` as the unresolved 38-character `file://…` literal, but the assert scored 1 with
reason "all 3 finding(s) anchored to a file in the diff" — which is only reachable if promptfoo
resolved the var to file contents at assert time.

## Findings

### F1 — Harness and config errors are scored as model failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `packages/code-review/evals/asserts/verdict.ts:22,26`; `packages/code-review/evals/asserts/anchors.ts:37,45`
- **Detail**: The plan devotes a whole section to "a failed grader is indistinguishable from a
  failed model" and puts a guard in the README for it — but the two deterministic asserts have
  the same weakness in four places, each reproduced empirically:
  1. `verdict.ts:26` consumes `context.vars.expected_verdict` as `unknown` and compares it
     directly. With the var missing or mistyped (`"Failed"`), all three models fail a
     **weight-2** assert with the reason "…the fixture's planted defects did not trip the
     gate" — i.e. a one-word YAML typo reads as "the gate is broken on every model".
  2. `verdict.ts:22` guards with `typeof output !== "object"`, but `typeof null === "object"`,
     so a `null` output reaches `"criteria" in output` and throws
     `TypeError: Cannot use 'in' operator … in null` — exactly the harness-error-vs-model-result
     confusion the comment above it says the guard exists to prevent.
  3. `anchors.ts:45` — if `changedFiles()` returns an empty set (a fixture regenerated with
     `git diff --no-prefix`, a custom `--src-prefix`, or plain `diff -u`), _every_ finding is
     counted fabricated and the metric reads 0, indistinguishable from total hallucination.
     Reproduced: stripping `b/` from the fixture flips `anchors` from 1 to 0.
  4. `anchors.ts:37` collapses "provider output is not a `Review`" into the reason "review
     reported no findings, but the fixture contains planted defects" — a shape regression
     charged to the model as the worst possible result.
- **Fix**: Validate `vars` at the top of both asserts (`expected_verdict` against
  `"passed" | "failed"`), fix the `null` guard order, and give each harness-error path its own
  distinct reason string that says _harness_, not _model_.
  - Strength: Preserves the one property the sweep's conclusions rest on — that a 0 means the
    model missed something. Every case above is a few lines, and `verdict.ts:22` already
    demonstrates the intended idiom.
  - Tradeoff: Four small edits across two files; slightly more code in files the plan
    deliberately kept thin.
  - Confidence: HIGH — all four cases were reproduced by direct invocation, not inferred.
  - Blind spot: Whether promptfoo surfaces a distinct reason string prominently enough in the
    terminal table to be noticed, or only in `results.json`.

- **Decision**: FIXED (2026-08-20) — `expected_verdict` validated against `"passed" | "failed"`, both asserts now take `output: unknown` and narrow it (the `null` guard bug came from typing it as `Review`), an empty `changedFiles()` set is caught before scoring, and every harness path returns a reason prefixed `HARNESS ERROR:`. Regression-guarded by the tests added under F5.

### F2 — Precision rubric penalizes the fix suggestion, not just the claim

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `packages/code-review/evals/promptfooconfig.yaml:153`
- **Detail**: The plan's contract for this assert is that the rubric "asks whether every
  reported finding describes a defect actually present in the changed lines". The implemented
  rubric adds `invents a file or symbol` to the fail conditions, which extends it from _claims
  about the diff_ to _remediation text_. This is not hypothetical — it fired: `deepseek-v4-flash`
  scored `flaw_cleanup` = 1 (it correctly found the missing cleanup) yet `precision` = 0.50,
  with the judge's stated reason being solely that its message "prescribes calling
  `deckStore.unsubscribe`, a symbol not present in the diff". A correct finding was downgraded
  for its suggested fix. Fabricated _file anchors_ are already covered deterministically by
  `anchors.ts`, so the clause is also partly redundant.
- **Fix A ⭐ Recommended**: Scope the clause to assertions about the diff — fail on "misstates
  what the diff does" and "invents a file it anchors a finding to", not on symbols appearing in
  remediation advice.
  - Strength: Restores the metric the plan specified, and keeps `precision` measuring what it
    is named for. Fabricated anchors stay covered by the deterministic assert.
  - Tradeoff: Invalidates the recorded `precision` scores; needs a re-run to get comparable
    numbers (≈ one sweep's spend).
  - Confidence: HIGH — the judge's own reason string names the clause it applied.
  - Blind spot: Whether haiku's 0.67 also hinges on this clause, or purely on its genuine
    false positive about the dependency array (the reason text suggests the latter).
- **Fix B**: Keep the strictness and rename/redocument the metric so it explicitly covers
  remediation accuracy.
  - Strength: A reviewer that invents APIs in its fix text _is_ worse; this arguably measures
    something real and costs no re-run to justify.
  - Tradeoff: `precision` then conflates two axes, so "which model is more precise" stops
    having a single meaning, and the plan's contract no longer describes the assert.
  - Confidence: MEDIUM — defensible, but it makes the metric harder to act on.
  - Blind spot: Whether a judge can reliably separate "invented API in advice" from "reasonable
    idiomatic suggestion" at all.

- **Decision**: FIXED via Fix A (2026-08-20) — the `precision` rubric now says explicitly to judge only what a finding CLAIMS about the diff and never the fix it suggests; the fail clause is `invents a file it anchors to` rather than `invents a file or symbol`. **The recorded `precision` scores are no longer comparable — deepseek's 0.50 was caused solely by this clause.** A re-run is needed for numbers that reflect the corrected rubric.

### F3 — `flaw_defaultprops` requires the model to assert past the diff

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `packages/code-review/evals/fixtures/react19-migration.diff:192,210,219,228,237,246`
- **Detail**: Every call site _visible in the diff_ passes `pageSize={25}` explicitly, so a
  reviewer reading only the diff can defensibly conclude the dangling
  `DeckSettingsPanel.defaultProps` is now dead code rather than a runtime break — while the
  rubric fails any review that does not call it broken. This is the one metric two of three
  models failed (haiku 0, deepseek 0, glm 1), so it is currently the main discriminator in the
  sweep, and it may be discriminating on willingness to speculate rather than on flaw
  detection. Note this interacts with the plan's own reasoning: the system prompt forbids
  asserting things the ground-truth block does not support, so the fixture is asking for a
  claim the prompt discourages.
- **Fix A ⭐ Recommended**: Add one call site in the diff that omits `pageSize`, making the
  empty-page break real and visible.
  - Strength: Turns the flaw into something a careful reviewer can _see_ rather than infer,
    which is what the plan says the fixture is for ("independently detectable").
  - Tradeoff: Fixture edit invalidates the recorded scores; needs a re-run plus a repeat of the
    deliberate-break check for this flaw.
  - Confidence: MEDIUM — likely to change the two zeros, but it is a live-model outcome, not a
    provable one.
  - Blind spot: Whether the flaw then becomes _too_ obvious and stops discriminating between
    models at all.
- **Fix B**: Widen the rubric to pass a review that flags the dangling `defaultProps` as
  ineffective-under-React-19, whether or not it claims a runtime break.
  - Strength: No fixture change, and it measures React 19 knowledge — which is what the flaw
    was chosen to test.
  - Tradeoff: Weakens the flaw to "spot a removed API" rather than "trace the consequence".
  - Confidence: MEDIUM — depends on whether the two failing models actually mentioned
    `defaultProps` at all; worth checking their findings before choosing this.
  - Blind spot: Not verified whether haiku/deepseek noticed `defaultProps` and declined to call
    it a break, or missed it entirely — that distinction decides between A and B.

- **Decision**: REOPENED, then FIXED via Fix A (2026-08-20). First triaged as SKIPPED: the
  premise was tested against the 2026-08-19 `out/results.json` and did not hold there —
  neither haiku nor deepseek mentioned `defaultProps` or React 19 anywhere, so both missed the
  flaw outright rather than noticing it and declining to speculate.

  A re-run the same day overturned that. With the fixture and this rubric untouched, `glm-5.1`
  dropped from `flaw_defaultprops` = 1 to 0 — it **found** the dangling `defaultProps` at the
  right line and gave the right fix (`pageSize = 25`), but framed it as "deprecated (React
  18.3+)" and a style preference, never asserting the break. That is exactly the failure mode
  F3 described, and it left all three models tied at 0, so the sweep had no discriminator left.

  Fix A applied: the diff now **adds** a test, `pages the override list with the component's
  default page size`, that renders `<DeckSettingsPanel deck={deck} currentUser={owner} />`
  with 60 overrides and asserts `toHaveLength(25)`. Under React 19 that assertion fails, so the
  break is visible in the diff rather than inferable from it. Fixture is still 3 files, now 281
  lines, `+87/−108`; `git apply --stat` parses it from the repo root.

  **Outstanding:** the recorded `flaw_defaultprops` scores predate this fixture, and the
  deliberate-break check for this flaw has not been repeated against the new call site. Both
  need a billed sweep.

### F4 — `flaw_defaultprops`'s ground truth depends on the host repo, unasserted

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `packages/code-review/evals/provider.ts:41`; `packages/code-review/evals/check-fixture.ts:28`
- **Detail**: `REPO_ROOT = path.resolve(import.meta.dirname, "../../..")` makes the reviewed
  prompt depend on the **host application's** root manifest. It works today —
  `collectInstalledVersions` returns 47 rows including `react@19.2.6` — and the plan documents
  why it must be the repo root. But nothing asserts it. Drop React from the root app, or
  extract this package (which AGENTS.md's InnerSource framing actively invites), and all three
  models score 0 on `flaw_defaultprops` while looking like three model failures. Secondary
  effect: those 47 rows drift as root dependencies change, so sweeps months apart are not
  strictly comparable — the harness has an invisible input.
- **Fix A ⭐ Recommended**: Add a precondition that fails loudly when the ground-truth block
  does not contain a React 19 entry — in `check-fixture.ts`, and as an early `{ error }` in the
  provider.
  - Strength: Cheapest change that converts a silent, misattributed zero into a named harness
    failure, and it costs nothing at runtime.
  - Tradeoff: Detects but does not remove the coupling; sweeps remain non-comparable across
    root-dependency changes.
  - Confidence: HIGH — the failure mode and its current-passing state were both verified.
  - Blind spot: Which other planted flaws quietly depend on root manifest contents (only
    flaw 3 was traced).
- **Fix B**: Give the fixture its own manifest (`evals/fixtures/repo/package.json` carrying
  only react) and point `cwd` at it.
  - Strength: Makes the harness self-contained and reproducible; removes the invisible input
    entirely and survives package extraction.
  - Tradeoff: Shrinks the ground-truth block from 47 rows to ~1, which materially changes the
    prompt and invalidates comparability with every run recorded so far.
  - Confidence: MEDIUM — clearly more correct in principle, but it changes what the model sees,
    which is the one thing the plan wanted held constant.
  - Blind spot: Whether the reviewer prompt behaves differently with a near-empty versions
    block (e.g. becomes more cautious across the board).

- **Decision**: FIXED via Fix A (2026-08-20) — new `evals/ground-truth.ts` resolves react from the root manifest (installed manifest, lockfile fallback, mirroring `collectInstalledVersions`, which stays internal by design) and fails loudly when it is missing or below 19. Wired as an early `{ error }` in `provider.ts` (before the key check, so it costs nothing) and as an `exit(1)` in `check-fixture.ts`. The coupling is detected, not removed.

### F5 — Nothing mechanically guards the rubric source-of-truth or the asserts' logic

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `packages/code-review/evals/fixtures/react19-migration.flaws.ts:1-10,90`; `packages/code-review/vitest.config.ts:15`
- **Detail**: `flaws.ts` declares itself the single source of truth "so a fixture edit that
  changes what a flaw _is_ has one obvious place to update", and its own docstring admits
  "Not imported by the config (promptfoo reads YAML, not TS)". The invariant is real and holds
  today (verified byte-identical), but it is enforced by discipline alone — and a drifted rubric
  still _scores_, it just silently tests the wrong thing. `EXPECTED_VERDICT` (`flaws.ts:90`) is
  duplicated the same way against `expected_verdict: failed` in the YAML, where drift produces
  the misleading all-model failure described in F1. Separately, the two asserts are pure
  functions with zero tests, because `evals/**` is excluded from vitest — and all four F1
  defects are precisely what a keyless unit test catches in seconds.
- **Fix**: Add `packages/code-review/tests/unit/eval-asserts.test.ts` that (a) unit-tests both
  asserts including the F1 edge cases and (b) parses `promptfooconfig.yaml` and asserts each
  rubric equals `PLANTED_FLAWS[].rubric` and `expected_verdict` equals `EXPECTED_VERDICT`.
  - Strength: Lives in `tests/`, so it is outside the excluded directory and inside the CI job,
    and it needs no API key — the keyless-CI invariant the whole Phase 1 guardrail protects is
    untouched. It also does not contradict the plan's "no new vitest tests" rationale, which was
    that assert inputs "come from a live model"; these assertions are pure.
  - Tradeoff: Adds a test file the plan did not call for, and couples a test to the YAML's
    structure (a config restructure would need the test updated).
  - Confidence: HIGH — the fixture, the manifest and the YAML are all on disk and parseable;
    nothing about this needs a model.
  - Blind spot: Whether a YAML parser is already available to the package's test deps, or needs
    adding.

- **Decision**: FIXED (2026-08-20) — `tests/unit/eval-asserts.test.ts`: 24 keyless tests covering both asserts including every F1 edge case, plus a transcription guard asserting each YAML rubric equals `PLANTED_FLAWS[].rubric` and `expected_verdict` equals `EXPECTED_VERDICT`. **Deviation from the fix as written:** no YAML dependency was added — the `value: |` block scalars are extracted by indentation, which compares the exact judge-facing text and keeps the package's dependency surface unchanged. The guard was verified by deliberate break: appending two words to one rubric in the YAML fails the run; reverting passes it. Suite: 87 → 111 tests.

### F6 — The provider duplicates model construction instead of reusing `src/providers/model.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `packages/code-review/evals/provider.ts:70-76`
- **Detail**: `createOpenRouter({ apiKey })(this.#model)` and the `OPENROUTER_API_KEY` check are
  re-implemented here, duplicating `src/providers/model.ts:15-18` and hand-rolling with
  `typeof` what that module does with zod. `model.ts`'s own doc comment asserts it is "the only
  place `process.env` is read" — that invariant is now false. The consequence is specific: any
  future change to `model.ts` (a `baseURL`, `HTTP-Referer`/`X-Title` headers, retry config)
  will silently not apply to the sweep, so the eval stops measuring the shipped code path while
  still reporting confident numbers.
- **Fix**: Extract a `createModel(apiKey, modelId)` helper in `src/providers/model.ts`, export
  it from `src/index.ts`, and call it from the provider — or at minimum share the zod schema for
  the key.
  - Strength: Restores "the eval measures the shipped path", which is the premise that makes
    the sweep's output actionable at all.
  - Tradeoff: Touches `src/` and widens the package's public surface — adjacent to the plan's
    "not touching the prompt, the schema, the rubric or the gate thresholds" guardrail (model
    construction is not on that list, but the spirit is "hold the reviewer constant"). Worth
    doing as its own commit rather than folded into an evals fix.
  - Confidence: HIGH — the duplication is literal and the broken invariant is stated in
    `model.ts`'s own comment.
  - Blind spot: Whether `resolveModel()`'s throw-on-missing-key behaviour can be factored out
    cleanly without the provider losing its `{ error }` return (promptfoo needs the object, not
    a throw).

- **Decision**: FIXED (2026-08-20) — `createModel(apiKey, modelId)` extracted in `src/providers/model.ts`, exported from `src/index.ts`, and used by `evals/provider.ts`, which no longer imports `@openrouter/ai-sdk-provider` itself. `resolveModel()` now calls the same helper. Its doc comment was corrected to "the only place `src/` reads `process.env`" and names why the eval provider reads the key itself (promptfoo needs a returned `{ error }`, not a throw) — the blind spot resolved rather than papered over.

### F7 — `evals/` bypasses the package's readable-error path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `packages/code-review/evals/provider.ts:84`; `packages/code-review/evals/check-fixture.ts:31,36`
- **Detail**: `provider.ts:84` hand-rolls `cause instanceof Error ? cause.message : String(cause)`
  instead of `toMessage` (`src/cli.ts:47`, the readable-error path added in a886c9f), discarding
  `NoObjectGeneratedError.finishReason` and `.text` — exactly the diagnostics the incident
  recorded at `evals/README.md:96-101` (`"No output generated."` from glm-5.1) needed.
  `check-fixture.ts` has no error handling at either boundary: with the key unset it dumps a raw
  12-line `ZodError` plus stack, making it the one entry point in the package that bypasses the
  readable path it exists to help diagnose.
- **Fix**: Export `toMessage` from `src/index.ts`, use it in `provider.ts`'s catch, and wrap
  `check-fixture.ts`'s body in a try/catch that prints it.

- **Decision**: FIXED (2026-08-20) — `toMessage` exported from `src/index.ts` (safe: `cli.ts` guards `main()` behind an entrypoint check, which the CLI tests already rely on), used in `provider.ts`'s catch, and `check-fixture.ts`'s body wrapped in a try/catch that prints one readable line and exits 1.

### F8 — promptfoo writes durable off-repo state and phones home

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `packages/code-review/package.json:13`
- **Detail**: Beyond the gitignored `evals/out/`, a run writes `~/.promptfoo/promptfoo.db`
  (2.0 MB after this one sweep), `~/.promptfoo/logs/` (54 debug logs) and `~/.promptfoo/cache/`
  — all holding the full fixture diff, rendered prompts and model outputs, outside any repo
  `.gitignore` and unmentioned in the README. promptfoo 0.122.0 also posts a PostHog `eval_ran`
  event (provider prefixes, assertion types, token counts, cost, latency, pass/fail counts)
  keyed to a persistent id in `~/.promptfoo/promptfoo.yaml`, plus a version check to
  `api.promptfoo.dev`, unless `PROMPTFOO_DISABLE_TELEMETRY=1` / `PROMPTFOO_DISABLE_UPDATE=1`.
  No key or prompt content is in that payload (verified). Also worth recording: `npx -y`
  auto-installs without prompting, and the `@0.122.0` pin binds only the top-level tarball —
  transitive resolution is unlocked, so runs weeks apart can install different trees.
- **Fix**: Add `PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1` to the `eval` script
  and one README line naming `~/.promptfoo/` as durable off-repo state and the pin as
  top-level-only.

- **Decision**: FIXED (2026-08-20) — `PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1` prepended to the `eval` script, and `evals/README.md` now documents both the suppressed telemetry and `~/.promptfoo/` as durable off-repo state holding the fixture diff, rendered prompts and model outputs, plus the pin being top-level-only.

### F9 — A billed, key-requiring script is undocumented in AGENTS.md

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `AGENTS.md` (Standalone packages section)
- **Detail**: `grep -rn "eval" AGENTS.md CLAUDE.md` returns nothing. AGENTS.md documents the
  package contract down to why `packages/code-review` needs its own `.prettierrc.json`, but a
  new `npm run eval` that spends real money, requires `OPENROUTER_API_KEY`, and installs
  500–825 transitive packages on first run is invisible to the next agent reading the onboarding
  doc. The plan never called for an AGENTS.md edit, so this is not drift — it is a gap the plan
  left open.
- **Fix**: One line under "Standalone packages" naming `npm run eval` as hand-run, billed, and
  deliberately outside CI, pointing at `packages/code-review/evals/README.md`.

- **Decision**: FIXED (2026-08-20) — one bullet added under "Standalone packages" in `AGENTS.md`, placed after the `code-review is the exception` line so that line's "the line above" reference still resolves. Names `npm run eval` as hand-run, billed, keyed, outside CI, with the `evals/**` vitest exclusion and a pointer to the eval README.

### F10 — Fixture is 273 lines against a planned ~180–220

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `packages/code-review/evals/fixtures/react19-migration.diff`
- **Detail**: The Phase 2 contract named "~180–220 line unified diff"; the file is 273 lines,
  about 24% over the upper bound. The measurable success criterion ("150+ lines, exactly three
  files") passes, and every other clause of the contract holds — 3 files, 3 distinct-region
  flaws, uncovered save path, correct `main.jsx` distractor. No functional consequence; recorded
  only because the plan stated a numeric range.
- **Fix**: None needed — amend the plan's stated range to match reality, or leave as recorded
  drift.

- **Decision**: SKIPPED (2026-08-20) — left as recorded drift; the plan's `~180–220` range is not amended.
