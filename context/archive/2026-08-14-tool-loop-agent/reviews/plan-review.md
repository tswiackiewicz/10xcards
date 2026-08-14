<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Tool Loop Agent — Modular Code Review Agent

- **Plan**: `context/changes/tool-loop-agent/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE → **SOUND** after triage (all 5 findings fixed in the plan, 2026-08-14)
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | WARNING |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

5/5 paths ✓, 5/5 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (2 phases, 16 items, no checkbox leakage outside `## Progress`), no external consumers of the package ✓.

Verified against the installed SDK (`ai@7.0.64`), not from memory:

- `ToolLoopAgent`, `Output.object`, `MockLanguageModelV4`, and `instructions` handling all confirmed present and shaped as the plan describes.
- `result.output` is non-optional and typed (`GenerateTextResult.output: InferCompleteOutput<OUTPUT>`, `dist/index.d.ts:4477`) — probed with a throwaway file, `tsc --noEmit` exit 0. `reviewDiff` can `return result.output` with no assertion.
- `system` is an accepted alias for `instructions` inside `standardizePrompt` (`src/prompt/standardize-prompt.ts:37`), but is **not** accepted on `ToolLoopAgentSettings` — see F1.

## Findings

### F1 — Agent test's stated rationale is false; check 2.8 is unperformable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Key Discoveries; Phase 2 §4; Phase 2 criterion 2.8
- **Detail**: The plan claims the mock-model test is "the only automated check that catches `system:` vs `instructions:` and a missing `Output.object`". Both are in fact caught by `tsc`, which is already criterion 1.2. Type probe against `ai@7.0.64`:
  - `error TS2353: 'system' does not exist in type 'ToolLoopAgentSettings<...>'`
  - `error TS2353: 'schema' does not exist in type 'Output<any, any, any>'`

  Consequently manual check 2.8 ("rename `instructions` to `system`, confirm the agent test fails") cannot be performed — the rename fails to compile, so it proves nothing about the test. The test still earns its place: it verifies the diff reaches the model as user content and that a JSON response parses into a typed `Review`, neither of which `tsc` can check. But the rationale that justified its inclusion during planning was wrong.
- **Fix**: Rewrite the rationale to what the test uniquely covers (prompt assembly reaching the model + output parsing), and replace 2.8 with a break `tsc` cannot catch — e.g. pass the diff via `instructions` instead of the user prompt, which is also the prompt-injection posture the plan says must survive.
  - Strength: Restores an honest justification and makes the break-and-revert check actually able to fail.
  - Tradeoff: None — the test itself is unchanged.
  - Confidence: HIGH — verified by direct type probe against the installed SDK.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — Exported factory is unusable without the prompt builder

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §6 (Public API surface); Phase 1 criterion 1.4
- **Detail**: `index.ts` re-exports `createReviewAgent`, `reviewDiff`, `ReviewAgentConfig`, `reviewSchema`, `Review` — but not `buildReviewPrompt`, `reviewInstructions`, or `collectInstalledVersions`. And `reviewDiff` does not accept a prebuilt agent. So a consumer holding a `createReviewAgent()` instance can only call `.generate({ prompt })` with a prompt it assembled itself, duplicating the versions block and the `Diff:` framing. That is exactly the downside attributed to the "Factory only" option that was rejected during planning: every eval re-implements prompt assembly, so evals end up testing their own wiring rather than the reviewer's.
- **Fix A ⭐ Recommended**: Also export `buildReviewPrompt` and `reviewInstructions` from the barrel.
  - Strength: Factory consumers assemble the real prompt from the same code path the CLI uses; keeps `reviewDiff`'s signature narrow.
  - Tradeoff: Wider public surface — the prompt shape becomes a semi-public contract.
  - Confidence: HIGH — pure re-export, no design risk.
  - Blind spot: Criterion 1.4's expected export list needs updating alongside.
- **Fix B**: Let `reviewDiff` accept an optional prebuilt `agent`.
  - Strength: Evals reuse one agent across N cases and still get real prompt assembly for free.
  - Tradeoff: A third way to configure the same call (model / agent / neither); the plan explicitly dropped this parameter as speculative.
  - Confidence: MEDIUM — clean, but adds a config path with no consumer yet.
  - Blind spot: Whether promptfoo actually benefits from agent reuse is unverified — construction does no I/O, so likely not.
- **Decision**: FIXED via Fix A

### F3 — Criterion 1.8 can't be performed: no baseline is captured first

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 Manual Verification (1.8)
- **Detail**: "Review quality on a known diff unchanged from before the refactor" requires a before-output, but no step captures one — and once Phase 1 lands, producing it means stashing the whole change. The plan-brief already calls this the weakest verification in the plan; as written it is not merely weak but unperformable.
- **Fix**: Add a pre-Phase-1 step: on the current code, run `git diff <fixed ref> | npm start > /tmp/baseline.json` and keep it for the 1.8 comparison.
- **Decision**: FIXED

### F4 — Criterion 1.6 doesn't unset anything: `.env` is auto-loaded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Manual Verification (1.6)
- **Detail**: "Running with `OPENROUTER_API_KEY` unset" — but `npm start` runs `node --env-file-if-exists=.env`, and `packages/code-review/.env` exists and contains `OPENROUTER_API_KEY`. Unsetting the shell variable changes nothing; the key still loads from the file. The step as written will silently pass while testing the opposite of what it claims.
- **Fix**: Specify the actual command — temporarily rename `.env`, or run `node --import tsx src/cli.ts` directly without the `--env-file-if-exists` flag.
- **Decision**: FIXED

### F5 — `reviewDiff`'s agent lifecycle is unspecified

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §5
- **Detail**: The plan says a `createReviewAgent()` instance "is safely reusable across calls" but never says whether `reviewDiff` builds one per call or holds a module-level singleton. A singleton would be wrong — `config.model` varies per call — so per-call construction is the only correct reading, but the implementer shouldn't have to derive it.
- **Fix**: State that `reviewDiff` constructs an agent per call (construction is synchronous and does no I/O, so it's free).
- **Decision**: FIXED

## What held up under verification

- All 5 file paths the plan modifies exist.
- `ToolLoopAgent` / `Output.object` / `MockLanguageModelV4` / `instructions` confirmed in `ai@7.0.64`.
- `result.output` non-optional and typed — `reviewDiff` needs no non-null assertion (probed, `tsc --noEmit` exit 0).
- Progress↔Phase contract mechanically valid: 2 phases, 16 items, phase names match, no `- [ ]` outside `## Progress`.
- No external consumers of the package — the "no migration needed" claim holds.
- Architectural fitness clean: one-way dependency graph, single filesystem module, single env module.
