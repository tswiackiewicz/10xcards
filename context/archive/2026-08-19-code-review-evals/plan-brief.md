# promptfoo Model Sweep for the Code Reviewer — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Add a committed promptfoo configuration to `packages/code-review` that runs the **same review
prompt across three models** against **one hard fixture** and reports, per model, which planted
flaws it caught. Today there is no way to answer "would a different model review better, or
cheaper?" except by hand-reading output — the only prior signal is a five-PR calibration replay
whose diffs and model outputs were never persisted, so it cannot be re-run.

## Starting Point

The package was explicitly built for this and then stopped short of it. The `ToolLoopAgent`
refactor was motivated by "running promptfoo evals against the reviewer"
(`tool-loop-agent/plan-brief.md:7`), and the harness was deferred with the exact artifacts
named — "no `promptfooconfig.yaml`, no eval provider shim, no `callApi` adapter"
(`plan.md:52`). Every seam exists and is tested: `reviewDiff` takes an injected `LanguageModel`
and needs no API key to import, `deriveVerdict` is pure, and prompt assembly is exported so an
eval never re-implements it. What is missing is any stored fixture at all — the repo contains
no `*.diff` anywhere.

## Desired End State

`npm run eval` inside `packages/code-review` runs one React 16→19 migration fixture against
Haiku 4.5, GLM 5.1 and DeepSeek V4 Flash, and writes `evals/out/results.csv` with one
`Metric:` column per flaw per model. Reading that file answers "which model missed which flaw,
and did the gate actually fail" at a glance. `npm test`, `lint` and `typecheck` behave exactly
as before, and `evals/` is covered by both typecheck and lint.

## Key Decisions Made

| Decision               | Choice                                                                      | Why (1 sentence)                                                                                                                                                  | Source   |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Tool                   | promptfoo 0.122.0                                                           | User's pick; its TS provider loads this ESM/`.ts` package natively — verified by execution.                                                                       | Plan     |
| Install shape          | `npx` only, nothing in `package.json`                                       | 500–825 transitive packages / ~1.7 GB against a package whose stated virtue is a small tree and no build step.                                                    | Plan     |
| Models                 | haiku-4.5 (incumbent) + glm-5.1 + deepseek-v4-flash                         | The incumbent is the only baseline that makes a challenger's result interpretable; all three IDs verified live on OpenRouter.                                     | Plan     |
| Fixture flaws          | Cleanup dropped · authz check lost · `defaultProps` on a function component | Spans three rubric criteria so scores are individually testable, plants one blocking-category finding, and one flaw needs real React 19 knowledge.                | Plan     |
| Judge                  | `openai/gpt-5` via native `openrouter:` prefix                              | The only strong judge sharing a vendor with none of the three candidates — removes family bias toward the incumbent.                                              | Plan     |
| Judge shape            | 3 per-flaw `llm-rubric` + 1 precision                                       | Per-flaw metrics answer "which flaw was missed"; the precision check stops a model winning on recall by spraying findings.                                        | Plan     |
| Test-level `threshold` | Deliberately omitted                                                        | Setting it silently absorbs hard deterministic failures — verified — so the "gate must fail" assert would stop being a gate.                                      | Plan     |
| `cwd` for the provider | Repo root, not the package dir                                              | The root manifest carries `react@^19.2.6`; without that ground-truth block the prompt forbids the model from reasoning about React 19, making flaw 3 unjudgeable. | Plan     |
| Where it runs          | Local script only                                                           | The package CI job has no `OPENROUTER_API_KEY` and is not a required check; a non-deterministic sweep there would bill PRs and go red-but-ignorable.              | Plan     |
| Cost instrumentation   | Out of scope                                                                | `reviewDiff` discards `usage` and the model is built without `usage: {include:true}`; fixing that changes the package's public surface.                           | Research |

## Scope

**In scope:** `evals/` directory (config, provider shim, two deterministic asserts, fixture,
flaw manifest, README); three config edits widening `tsconfig`/`eslint` globs and excluding
`evals/**` from vitest; an `eval` npm script; `evals/out/` gitignored.

**Out of scope:** promptfoo as a dependency; any CI wiring; cost instrumentation; changes to
the prompt, schema, rubric or gate thresholds; a clean-diff true-negative case; a second
fixture; `--repeat` runs; a response-caching middleware.

## Architecture / Approach

```
evals/promptfooconfig.yaml
   ├─ providers: 3 × file://./provider.ts, same id, distinct label + config.model
   ├─ tests[0].vars.diff: file://fixtures/react19-migration.diff
   ├─ deterministic asserts → asserts/verdict.ts, asserts/anchors.ts
   └─ 4 × llm-rubric  ──graded by──►  openrouter:openai/gpt-5

provider.ts → createOpenRouter(...)(config.model) → reviewDiff(diff, {model, cwd: REPO_ROOT})
            → returns the parsed Review object (promptfoo hands objects to asserts unparsed)
```

The provider is the only file that knows promptfoo exists, and it knows it through two
locally-declared interfaces rather than an import — so `evals/` typechecks without promptfoo
installed.

## Phases at a Glance

| Phase                       | What it delivers                                                   | Key risk                                                                                 |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1. Scaffolding & guardrails | `evals/` typechecked and linted, provably excluded from `npm test` | Widening the eslint glob surfaces strict type-aware errors in new files                  |
| 2. Fixture & flaw manifest  | The React 16→19 diff + typed manifest + a standalone smoke script  | The flaws land too obvious (no discrimination) or too subtle (all models miss all three) |
| 3. Provider shim & sweep    | Three attributable model columns, deterministic asserts only       | Provider wiring failures presenting as model failures                                    |
| 4. LLM-judge layer          | Per-flaw + precision metrics in CSV and JSON                       | A dead judge scores 0 and looks exactly like three bad models                            |

**Prerequisites:** `OPENROUTER_API_KEY` in `packages/code-review/.env` (already present),
network access to OpenRouter, Node 22+.
**Estimated effort:** ~2 sessions across 4 phases; phases 1–3 cost at most three cheap model
calls, judge spend starts in phase 4.

## Open Risks & Assumptions

- **The fixture's difficulty is unproven until it runs.** If all three models catch all three
  flaws, or none do, the sweep has no resolving power and the fixture needs re-tuning. Phase 2's
  manual read and Phase 4's "scores must differ" criterion are the checks.
- **Judge failures masquerade as model failures.** A 401 or rate-limit from the grader returns
  `pass: false, score: 0`, flagged only by `metadata.graderError: true`. Ruling that out is an
  explicit success criterion, not an afterthought.
- **`llm-rubric` passes when the grader omits `pass`** — every rubric therefore carries an
  explicit `threshold`. Forgetting one turns that flaw into a free pass for every model.
- **Every run pays.** promptfoo's disk cache does not fire for custom providers (verified), so
  there is no replay. Acceptable at one fixture; it is why this stays off CI.
- **`promptfoo eval` exits 1 whenever any test fails**, and with all-must-pass semantics that
  will be the normal outcome of a three-model sweep. The exit code is not the signal — the CSV
  is. Nothing should ever gate on it.

## Success Criteria (Summary)

- `npm run eval` produces a per-model, per-flaw score table naming which of the three planted
  flaws each model found.
- The deterministic assert confirms the mechanical gate actually returns `failed` on a diff
  that genuinely deserves it.
- `npm test`, `npm run lint` and `npm run typecheck` are unchanged in behaviour, and no eval
  file can ever be collected by the keyless CI job.
