# promptfoo Model Sweep for the Code Reviewer — Implementation Plan

## Overview

Add a committed, `npx`-run promptfoo configuration to `packages/code-review` that runs the
**same review prompt across three models** against **one hard fixture** — a React 16 → 19
component migration carrying three planted flaws — and scores each model on whether it found
each flaw. An LLM judge (`openai/gpt-5`) rules per flaw; two deterministic asserts check that
the mechanical gate actually fails and that no finding points at a fabricated file.

This is a decision-support tool, not a CI gate. Its output is a per-model, per-flaw score
table you read when choosing a model or changing the prompt.

## Current State Analysis

The package was built for this. `context/archive/2026-08-14-tool-loop-agent/plan-brief.md:7`
names "running promptfoo evals against the reviewer" as the motivation for the
`ToolLoopAgent` refactor, and `plan.md:52` defers the harness itself — "no
`promptfooconfig.yaml`, no eval provider shim, no eval scripts, no `callApi` adapter" — as
explicitly out of scope. This change closes that.

Everything needed already exists and is tested:

- `reviewDiff(diff, { model, cwd, title, body })` (`src/agents/reviewer/agent.ts:54`) accepts
  an injected `LanguageModel` and needs no API key to import — asserted at
  `tests/integration/agent.test.ts:109-120`, because `src/providers/model.ts:15-18` parses
  `process.env` inside the call rather than at module scope.
- `deriveVerdict` (`src/agents/reviewer/verdict.ts:97`) is pure and importable.
- `reviewSchema` and the `Review` type are importable without pulling in the agent.
- Plain `node` resolves the package's `.ts` import chain natively (verified: `import()` of
  `src/index.ts` yields all 17 exports with no loader flags), and promptfoo bundles `tsx` and
  registers it lazily for `.ts` provider/assertion files.

What does not exist: any stored fixture corpus. Searched tree-wide — no `*.diff`, no
`__snapshots__`, no recorded model responses. The only diffs in the repo are one- and two-line
inline strings in tests plus a 12-line heredoc in `.github/workflows/ai-review-smoke.yml:25-40`.

Two constraints inherited from research (`research.md`):

- **`npm test` collision risk.** `vitest.config.ts:11` is `defineConfig({})`; vitest's default
  include is repo-wide `**/*.{test,spec}.?(c|m)[jt]s?(x)`. The `code-review-package` CI job
  runs `npm test` with no secrets. An eval file named `*.test.ts` would make billed calls in
  a job that has no key.
- **`tsconfig.json:15` and `eslint.config.js:10-11` are both scoped to
  `["src/**/_.ts", "tests/\*\*/_.ts"]`.\*\* A new top-level directory silently escapes both
  typecheck and type-aware lint.

## Desired End State

From inside `packages/code-review`, `npm run eval` runs one fixture against three models and
prints a per-model table, writing `evals/out/results.csv` and `evals/out/results.json`. The
CSV carries one `Metric: <name>` column per flaw per model, so "which model missed which
flaw" is readable at a glance. `npm test`, `npm run lint` and `npm run typecheck` are
unaffected in behaviour, and the new `evals/` directory is covered by both typecheck and lint.

Verification: `npm run eval` exits after three provider rows; `evals/out/results.csv` contains
`Metric: flaw_cleanup`, `Metric: flaw_authz`, `Metric: flaw_defaultprops`, `Metric: precision`,
`Metric: verdict` and `Metric: anchors` columns for each of the three labelled providers.

### Key Discoveries:

- **`label:` disambiguates providers; a shared `file://` id does not collide.** Three entries
  pointing at the same `provider.ts` with different `config.model` run independently. Without
  labels the data is still correct but the output columns are unattributable.
- **A test-level `threshold` silently absorbs hard assert failures.** Verified: with
  `threshold: 0.8`, an assert that fails with score 0 still yields `success: true` when the
  weighted mean clears the bar. Omitting the test-level threshold restores all-must-pass
  semantics. This plan therefore sets **no test-level `threshold`** and puts thresholds on the
  individual rubric asserts.
- **`llm-rubric` passes when the grader omits `pass`.** A grader returning `{"score": 0}` and
  nothing else is treated as a pass. Every rubric assert needs an explicit `threshold`.
- **A failed grader is indistinguishable from a failed model.** A 401 from the judge returns
  `pass: false, score: 0` with `metadata.graderError: true` as the only signal.
- **`weight: 0` coerces an assert to `pass: true`.** Never set it accidentally.
- **CSV is the only clean per-metric artifact.** `junit.xml` carries no metric data.
  Per-provider JSON `namedScores` are weight-multiplied _sums_ across tests and repeats, not
  means; per-result `results.results[i].namedScores` are the raw values.
- **`openrouter:` is a native promptfoo provider prefix** reading `OPENROUTER_API_KEY` — the
  same variable the package already uses, so the judge needs no new secret.
- **`cwd` must be the repo root, not the package directory.** `collectInstalledVersions` feeds
  an "Installed versions (ground truth)" block into the prompt, and the root manifest carries
  `react@^19.2.6`. Without it, flaw 3 is unjudgeable: the system prompt
  (`src/agents/reviewer/prompts.ts:6-8`) forbids the model from asserting whether a version
  exists, so it cannot reason about React 19 semantics it has no ground truth for.
- **Every model-graded component carries `metadata.renderedGradingPrompt`** — the exact text
  sent to the judge, and the calibration audit trail when a rubric misfires.

## What We're NOT Doing

- **Not adding promptfoo to `package.json`.** It is 500–825 transitive packages / ~1.7 GB, and
  `--omit=optional` makes it refuse to start (missing `@libsql/<platform>`). It runs via
  pinned `npx`. The provider declares the two promptfoo interfaces it needs locally rather
  than importing them, so nothing in `evals/` depends on promptfoo being installed to
  typecheck.
- **Not instrumenting cost.** `reviewDiff` discards `usage`/`providerMetadata`
  (`agent.ts:58`) and `resolveModel` never sets `usage: { include: true }`
  (`model.ts:17`), so per-review cost is unavailable without changing the package's public
  surface. That is research blocker B1 and belongs in its own change. Static per-1M prices
  are recorded in this plan so the sweep is still cost-aware by hand.
- **Not wiring this into CI.** No workflow file, no label trigger, no schedule. The
  `code-review-package` job keeps running exactly `lint → typecheck → test`.
- **Not gating on the exit code.** `promptfoo eval` exits 1 if any test fails, and with
  all-must-pass semantics a three-model sweep will usually have at least one model missing at
  least one flaw. The exit code is not the signal; the CSV is.
- **Not touching the prompt, the schema, the rubric or the gate thresholds.** Review quality is
  held constant so this run measures models, not a prompt edit.
- **Not building a clean-diff (true-negative) case, a second fixture, or `--repeat` runs.**
  One fixture, one run per model. `--repeat 3` is documented as the next knob, not used here.
- **Not adding a caching middleware.** Every run pays. At these fixture sizes that is cents.

## Implementation Approach

Four phases, each independently verifiable, with judge spend deferred to the last one. Phases
1–3 cost at most three cheap review calls; the judge only enters in Phase 4.

The layout keeps promptfoo at arm's length: `evals/` holds a YAML config, one provider shim,
two deterministic assert files, one fixture and one flaw manifest. Nothing under `src/` or
`tests/` changes. The provider is the only file that knows promptfoo exists, and it knows it
through two locally-declared interfaces rather than an import.

## Critical Implementation Details

**Threshold semantics are inverted from intuition and this plan depends on it.** Setting a
test-level `threshold` converts every per-assert pass/fail into advisory input to a weighted
average — a deterministic assert that hard-fails is then absorbed. Because the "the gate must
actually fail" assert has to be a real gate, the test carries **no** `threshold` key, which
restores all-must-pass. Thresholds live only on the four `llm-rubric` asserts.

**Judge health must be checked before results are believed.** Grader transport failures
(401, rate limit, model unavailable) present as ordinary assertion failures scoring 0. Any run
where a model scores 0 on all four rubrics should be checked for
`metadata.graderError: true` in `results.json` before being read as a model result.

---

## Phase 1: Scaffolding & guardrails

### Overview

Create the `evals/` directory and make it a first-class part of the package's quality tooling —
typechecked and linted — while guaranteeing it can never join `npm test`.

### Changes Required:

#### 1. Vitest exclusion

**File**: `packages/code-review/vitest.config.ts`

**Intent**: Defensively exclude `evals/**` from test collection so no file added there can ever
be picked up by `npm test` and make billed calls in the keyless `code-review-package` CI job.
Preserve the existing comment explaining why this config exists at all (it shadows the
repo-root config).

**Contract**: `test.exclude` = vitest's `configDefaults.exclude` spread, plus `"evals/**"`. No
other key is added; the config must stay otherwise empty.

#### 2. Typecheck and lint coverage

**File**: `packages/code-review/tsconfig.json`, `packages/code-review/eslint.config.js`

**Intent**: Add `evals/` to both globs so the provider and assert files get the same strict,
type-aware treatment as `src/`. Without this they compile and lint nowhere.

**Contract**: `tsconfig.json` `include` gains `"evals/**/*.ts"`. `eslint.config.js` gains
`"evals/**/*.ts"` in the type-aware block's `files` array. `projectService: true` already
covers the new files once tsconfig includes them.

#### 3. Eval script and ignored output

**File**: `packages/code-review/package.json`, `packages/code-review/.gitignore`

**Intent**: One script that runs the sweep with a pinned promptfoo version, writing both
machine-readable artifacts. Output is generated, not source.

**Contract**: script `eval` runs `promptfoo@0.122.0` via `npx` against
`evals/promptfooconfig.yaml`, emitting `-o evals/out/results.csv` and
`-o evals/out/results.json` (the flag is repeatable; format is inferred from the extension).
`.gitignore` gains `evals/out/`. The existing `test`, `lint`, `typecheck` scripts are unchanged.

#### 4. Directory placeholder

**File**: `packages/code-review/evals/README.md`

**Intent**: State what this directory is, that promptfoo is deliberately not a dependency, that
`OPENROUTER_API_KEY` is required for both the candidates and the judge, and that the run costs
real money. Record the three candidate prices so a reader can do the cost math the harness
does not.

**Contract**: Prose only. Names the pinned promptfoo version and the exact `npx` invocation.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass and collect the same 7 files: `npm test`
- Type checking passes with the widened include: `npm run typecheck`
- Linting passes with the widened files glob: `npm run lint`
- Vitest does not collect anything under `evals/`: `npx vitest list --filesOnly`

#### Manual Verification:

- `evals/README.md` reads as useful to someone who has never run promptfoo

---

## Phase 2: Fixture & flaw manifest

### Overview

Author the test case: a substantial React 16 → 19 migration diff with three planted flaws,
plus a manifest that names each flaw and supplies the rubric text the judge will use. No
promptfoo involved yet — the fixture is verified by running the existing reviewer against it.

### Changes Required:

#### 1. The fixture diff

**File**: `packages/code-review/evals/fixtures/react19-migration.diff`

**Intent**: A realistic, ~180–220 line unified diff migrating a React 16 class component to
React 19 hooks. The three flaws must be buried among genuinely correct migration work so the
task discriminates between models rather than being spot-the-obvious.

**Contract**: A valid unified diff (`diff --git` headers, `@@` hunks) touching three files:

- `src/components/DeckSettingsPanel.jsx` — the main migration. Class → function component:
  `this.state` → `useState`, `createRef` → `useRef`, lifecycle → effects, bound handlers →
  plain functions. This work is correct apart from the three planted flaws.
- `src/components/DeckSettingsPanel.test.jsx` — tests updated for the new component shape.
  Deliberately does **not** cover the save path whose authorization check was removed, giving
  the `testCoverage` criterion something true to say.
- `src/main.jsx` — `ReactDOM.render` → `createRoot(...).render(...)`, done **correctly**. A
  distractor: a model that flags this is producing a false positive, which the precision
  rubric should catch.

The three planted flaws, each independently detectable and anchored to a distinct region:

| #   | Flaw                                   | Shape                                                                                                                                                                                                                                | Rubric criterion                              |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1   | Effect cleanup dropped                 | `componentWillUnmount` unsubscribed from a store and removed a `focus` listener; the `useEffect` that replaces it registers both and returns nothing                                                                                 | correctness                                   |
| 2   | Authorization check lost               | `handleSave` in the class began with an owner check (`deck.ownerId !== currentUser.id` → refuse); the migrated handler calls the update API with no check                                                                            | security; `blockingCategory: "authorization"` |
| 3   | `defaultProps` on a function component | `static defaultProps = { pageSize: 25 }` is carried over as `DeckSettingsPanel.defaultProps = { pageSize: 25 }`; React 19 removed this for function components, so `pageSize` is `undefined` and the list slice yields an empty page | correctness (React-19-specific)               |

Flaw 3 is the one that requires the ground-truth versions block — see Key Discoveries.

#### 2. The flaw manifest

**File**: `packages/code-review/evals/fixtures/react19-migration.flaws.ts`

**Intent**: Single source of truth for what was planted, so the rubric text in the YAML and any
future assert never drift from the fixture. Exports one typed array.

**Contract**: Exports `const PLANTED_FLAWS` — for each flaw: a `metric` name
(`flaw_cleanup` | `flaw_authz` | `flaw_defaultprops`), the target file, a short human label,
and the `rubric` string used verbatim as an `llm-rubric` value. Rubric strings must be binary
and anchored — they ask whether the review reports _this specific defect in this specific
file_, not whether the review is good. Also exports `EXPECTED_VERDICT = "failed"`.

#### 3. Fixture smoke check

**File**: `packages/code-review/evals/check-fixture.ts`

**Intent**: A standalone `tsx`-run script that pipes the fixture through `reviewDiff` once with
the incumbent model and prints the review plus `deriveVerdict`. Confirms the fixture parses,
the prompt assembles, the versions block contains React, and the gate fails — before any
promptfoo machinery exists to confuse the diagnosis.

**Contract**: Reads the fixture, calls `reviewDiff` with `cwd` resolved to the repo root, prints
the parsed `Review` and the derived verdict. No assertions, no exit-code contract — a
diagnostic, run by hand.

### Success Criteria:

#### Automated Verification:

- The fixture is a well-formed unified diff: `git apply --check --reverse` reports no
  malformed-patch error against a scratch tree, or `git apply --stat` parses it cleanly
- Manifest and script typecheck: `npm run typecheck`
- Lint passes on the new files: `npm run lint`
- Fixture is 150+ lines and touches exactly three files: `grep -c '^diff --git'` returns 3

#### Manual Verification:

- `npx tsx evals/check-fixture.ts` prints a review whose "Installed versions" reasoning shows
  the model saw React 19
- The derived verdict is `failed`
- Reading the diff cold, the three flaws are non-obvious — a reviewer has to actually think

---

## Phase 3: Provider shim & three-model sweep

### Overview

Stand up the promptfoo config with three labelled providers and deterministic asserts only. No
judge yet, so this phase costs three review calls and nothing else, and any failure is
attributable to wiring rather than to a rubric.

### Changes Required:

#### 1. The provider shim

**File**: `packages/code-review/evals/provider.ts`

**Intent**: Adapt `reviewDiff` to promptfoo's provider interface, constructing a per-provider
OpenRouter model from `config.model` so one file serves all three candidates. Declares the two
promptfoo shapes it needs locally so `evals/` never depends on promptfoo for typecheck.

**Contract**: Default-exports a class with `id(): string` and
`callApi(prompt, context) => Promise<{ output: Review } | { error: string }>`. Reads the diff
from `context.vars.diff` (promptfoo resolves `file://` var values to file _contents_). Builds
the model with `createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })(config.model)` and
passes it to `reviewDiff` — env-based `resolveModel()` is bypassed so the model varies per
provider within one run. Returns the parsed `Review` object directly; promptfoo hands objects
to `javascript` asserts unparsed.

`cwd` is resolved from the provider's own location, not from the process working directory,
so the run is invariant to where it is launched from:

```ts
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
```

Note the docs' `options.id || "default-id"` self-naming pattern is dead code — promptfoo always
supplies the file path as `options.id`.

#### 2. Deterministic asserts

**File**: `packages/code-review/evals/asserts/verdict.ts`, `packages/code-review/evals/asserts/anchors.ts`

**Intent**: Two checks that need no judge. `verdict.ts` is the "does the review actually fail"
assert the sweep is partly built to answer. `anchors.ts` guards against fabricated file paths —
a finding pointing at a file not in the diff is a hallucination regardless of what it says.

**Contract**: Each default-exports `(output: Review, context) => { pass, score, reason }`.
`verdict.ts` imports `deriveVerdict` from `../../src/index.ts` and compares against
`context.vars.expected_verdict`; binary score. `anchors.ts` scores the fraction of
`output.findings` whose `file` appears among the diff's `+++ b/` paths; a review with zero
findings scores 0, since the fixture demonstrably contains defects.

#### 3. The promptfoo config

**File**: `packages/code-review/evals/promptfooconfig.yaml`

**Intent**: Three labelled providers over one prompt and one test case, deterministic asserts
only at this phase.

**Contract**: A single `{{diff}}` prompt; `tests[0].vars.diff` is
`file://fixtures/react19-migration.diff` (paths resolve relative to the config file);
`vars.expected_verdict: failed`. Providers as below — and critically, **no test-level
`threshold` key**, so every assert must pass:

```yaml
providers:
  - id: file://./provider.ts
    label: haiku-4.5
    config: { model: anthropic/claude-haiku-4.5 }
  - id: file://./provider.ts
    label: glm-5.1
    config: { model: z-ai/glm-5.1 }
  - id: file://./provider.ts
    label: deepseek-v4-flash
    config: { model: deepseek/deepseek-v4-flash }
```

Asserts at this phase: `{ type: javascript, value: file://./asserts/verdict.ts, metric: verdict, weight: 2 }`
and `{ type: javascript, value: file://./asserts/anchors.ts, metric: anchors, weight: 1 }`.

### Success Criteria:

#### Automated Verification:

- Typecheck and lint pass on the provider and asserts: `npm run typecheck && npm run lint`
- The sweep runs and produces three provider results: `npm run eval` then confirm
  `evals/out/results.json` has three entries in `results.results`
- Each result carries a distinct `provider.label`: `haiku-4.5`, `glm-5.1`, `deepseek-v4-flash`
- `results.results[].namedScores` contains `verdict` and `anchors` for every provider

#### Manual Verification:

- The terminal table shows three attributable columns, one per labelled model
- At least one model's `verdict` metric is 1 — confirming the fixture can fail the gate at all
- No provider returned an `error` field (which would indicate a wiring or key problem, not a
  model result)

---

## Phase 4: LLM-judge layer

### Overview

Add the four model-graded asserts — one per planted flaw plus one precision check — graded by
`openai/gpt-5`, chosen because it shares a vendor with none of the three candidates.

### Changes Required:

#### 1. Judge configuration

**File**: `packages/code-review/evals/promptfooconfig.yaml`

**Intent**: Point all model-graded asserts at a single neutral judge at `temperature: 0`.

**Contract**: `defaultTest.options.provider` = `{ id: "openrouter:openai/gpt-5", config: { temperature: 0 } }`.
The `openrouter:` prefix is native and reads `OPENROUTER_API_KEY`, so no new secret is
introduced. Per-assert `provider:` overrides are not used.

#### 2. Per-flaw rubric asserts

**File**: `packages/code-review/evals/promptfooconfig.yaml`

**Intent**: Three binary judgements, one per planted flaw, each separately reported so the
output answers "which flaw did this model miss" rather than "how good was this review".

**Contract**: Three `llm-rubric` asserts, values taken verbatim from `PLANTED_FLAWS[].rubric`,
with `metric:` set to `flaw_cleanup`, `flaw_authz`, `flaw_defaultprops` and `weight: 1` each.
**Every one carries an explicit `threshold`** (0.7) — without it a grader response that omits
`pass` is treated as a pass. `g-eval` is deliberately not used: it costs two grader calls per
criterion and its averaged 0–10 output blurs "caught 2 of 3" into a single mushy number.

#### 3. Precision assert

**File**: `packages/code-review/evals/promptfooconfig.yaml`

**Intent**: Catch a model that wins on recall by spraying findings. The rubric must not
penalise _additional true_ findings — only claims that misstate what the diff does. The
correct `createRoot` migration in `src/main.jsx` is the planted bait.

**Contract**: One `llm-rubric` assert, `metric: precision`, `threshold: 0.7`, `weight: 1`. The
rubric asks whether every reported finding describes a defect actually present in the changed
lines, explicitly instructing the judge that correctly-migrated code flagged as broken is a
precision failure, and that extra _genuine_ findings are not.

#### 4. Result-reading guidance

**File**: `packages/code-review/evals/README.md`

**Intent**: Tell the reader how to read the artifacts correctly — the two `namedScores` shapes
are easy to confuse, and a dead judge silently looks like three bad models.

**Contract**: Documents that `results.results[i].namedScores` are raw per-run values while
`results.prompts[i].metrics.namedScores` are weight-multiplied sums (divide by
`namedScoreWeights` for a mean); that the CSV's `Metric: <name>` columns are the intended
read; that `metadata.graderError: true` must be ruled out before believing an all-zero row;
and that `metadata.renderedGradingPrompt` holds the exact judge input for calibration.

### Success Criteria:

#### Automated Verification:

- The full sweep runs: `npm run eval`
- `evals/out/results.csv` contains a `Metric:` column for each of `verdict`, `anchors`,
  `flaw_cleanup`, `flaw_authz`, `flaw_defaultprops`, `precision`
- Every provider row in `results.results[].namedScores` carries all six metric keys
- No component in `results.json` has `metadata.graderError: true`
- Typecheck and lint still pass: `npm run typecheck && npm run lint`

#### Manual Verification:

- The three models produce visibly different per-flaw scores — if all three score identically
  on all six metrics, the rubrics are not discriminating and need sharpening
- Spot-check one `metadata.renderedGradingPrompt` to confirm the judge received the review
  object and the intended rubric
- The incumbent (`haiku-4.5`) result is consistent with the calibration record's characterisation
  of it: generous scores, occasional over-tagging of blocking categories
  (`context/archive/2026-08-14-ci-cd-code-review/change.md:53-59`)

---

## Testing Strategy

The eval harness is itself untested code, so verification leans on the existing suite staying
green plus staged manual inspection.

### Unit Tests:

No new vitest tests. The deterministic assert logic is thin and its inputs come from a live
model, so a unit test would only re-assert `deriveVerdict`, which
`tests/unit/verdict.test.ts` already covers exhaustively.

### Integration Tests:

`npx vitest list --filesOnly` must continue to report exactly the seven existing test files
after every phase — the guard that `evals/` never leaks into `npm test`.

### Manual Testing Steps:

1. After Phase 1: run `npm test`, `npm run lint`, `npm run typecheck` — all green, no new files
   collected by vitest.
2. After Phase 2: run `npx tsx evals/check-fixture.ts` and read the review. Confirm the verdict
   is `failed` and the model's notes reference React 19 behaviour.
3. After Phase 3: run `npm run eval` and confirm three attributable columns.
4. After Phase 4: run `npm run eval`, open `evals/out/results.csv`, and read the per-flaw
   matrix. Rule out `graderError` before drawing conclusions.
5. Deliberate-break check: temporarily remove one planted flaw from the fixture, re-run, and
   confirm the corresponding `flaw_*` metric drops for all three models. This proves the rubric
   measures the flaw rather than rewarding generic review prose.

## Performance Considerations

Per full run: 3 review calls (~2–4k input tokens each: fixture diff plus a ~1.6k-token system
prompt) and 12 judge calls (4 rubrics × 3 models), each carrying the review object plus one
rubric. Total well under a dollar.

Candidate prices per 1M tokens (OpenRouter, verified 2026-08-19): `anthropic/claude-haiku-4.5`
$1.00 in / $5.00 out; `z-ai/glm-5.1` $0.97 / $3.04; `deepseek/deepseek-v4-flash` $0.083 /
$0.165. Judge `openai/gpt-5` $1.25 / $10.00. DeepSeek is roughly twelve times cheaper on input
than the incumbent, which makes the cost axis a genuine output of the comparison even though
the harness does not measure it directly.

No caching: promptfoo's disk cache wraps its own HTTP client and does not fire for custom
providers (verified — an identical second run re-executed the provider). Every run pays in
full. This is acceptable at one fixture; it is the reason the sweep is not wired to CI.

## Migration Notes

Nothing to migrate. All changes are additive except three config edits (`vitest.config.ts`,
`tsconfig.json`, `eslint.config.js`) which widen globs and add an exclusion. Rollback is
deleting `evals/`, reverting those three files and the two `package.json` / `.gitignore` lines.

## References

- Related research: `context/changes/code-review-evals/research.md`
- Deferred here originally: `context/archive/2026-08-14-tool-loop-agent/plan.md:52`
- The seam that makes this possible: `context/archive/2026-08-14-tool-loop-agent/plan.md:147`
- Why prompt assembly is exported: `context/archive/2026-08-14-tool-loop-agent/reviews/plan-review.md:56`
- Model behaviour baseline: `context/archive/2026-08-14-ci-cd-code-review/change.md:14-72`
- Existing end-to-end fixture pattern: `.github/workflows/ai-review-smoke.yml:25-40`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scaffolding & guardrails

#### Automated

- [x] 1.1 Unit tests still pass and collect the same 7 files — 7192447
- [x] 1.2 Type checking passes with the widened include — 7192447
- [x] 1.3 Linting passes with the widened files glob — 7192447
- [x] 1.4 Vitest does not collect anything under `evals/` — 7192447

#### Manual

- [x] 1.5 `evals/README.md` reads as useful to a promptfoo newcomer — 7192447

### Phase 2: Fixture & flaw manifest

#### Automated

- [x] 2.1 The fixture is a well-formed unified diff — 9e721cc
- [x] 2.2 Manifest and script typecheck — 9e721cc
- [x] 2.3 Lint passes on the new files — 9e721cc
- [x] 2.4 Fixture is 150+ lines and touches exactly three files — 9e721cc

#### Manual

- [x] 2.5 `check-fixture.ts` shows the model saw React 19 — 9e721cc
- [x] 2.6 The derived verdict is `failed` — 9e721cc
- [x] 2.7 The three flaws are non-obvious on a cold read — 9e721cc

### Phase 3: Provider shim & three-model sweep

#### Automated

- [x] 3.1 Typecheck and lint pass on the provider and asserts — da1f9b6
- [x] 3.2 The sweep runs and produces three provider results — da1f9b6
- [x] 3.3 Each result carries a distinct `provider.label` — da1f9b6
- [x] 3.4 `namedScores` contains `verdict` and `anchors` for every provider — da1f9b6

#### Manual

- [x] 3.5 Terminal table shows three attributable columns — da1f9b6
- [x] 3.6 At least one model's `verdict` metric is 1 — da1f9b6
- [x] 3.7 No provider returned an `error` field — da1f9b6

### Phase 4: LLM-judge layer

#### Automated

- [x] 4.1 The full sweep runs
- [x] 4.2 CSV contains a `Metric:` column for all six metrics
- [x] 4.3 Every provider row carries all six metric keys
- [x] 4.4 No component has `metadata.graderError: true`
- [x] 4.5 Typecheck and lint still pass

#### Manual

- [x] 4.6 The three models produce visibly different per-flaw scores
- [x] 4.7 Spot-checked `renderedGradingPrompt` is correct
- [x] 4.8 Incumbent result is consistent with the calibration record
