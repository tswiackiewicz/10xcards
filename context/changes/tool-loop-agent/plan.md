# Tool Loop Agent — Modular Code Review Agent Implementation Plan

## Overview

Convert `packages/code-review/src/index.ts` from a single 102-line file mixing five concerns into seven focused modules, with the reviewer rebuilt on the AI SDK's `ToolLoopAgent`. Structured output schemas and prompts get their own modules. The agent becomes a reusable factory with an injectable model, so a future promptfoo eval can import and drive the reviewer without env setup, a live API call, or CLI coupling. No eval environment is configured in this change.

## Current State Analysis

`packages/code-review/src/index.ts` mixes five concerns in one file:

| Lines  | Concern                                                                                       |
| ------ | --------------------------------------------------------------------------------------------- |
| 8–16   | `envSchema` (zod) + `getModel()` — parses `process.env` on every call                          |
| 18–30  | `reviewSchema` structured output + `Review` type                                               |
| 33–56  | `installedVersions(cwd)` — reads `package.json`, then every `node_modules/<pkg>/package.json`  |
| 58–76  | `reviewDiff(diff, cwd)` — one-shot `generateText` with inline system/user prompt strings       |
| 78–101 | stdin reader + `main()`, guarded by `process.argv[1] === fileURLToPath(import.meta.url)`       |

Constraints discovered:

- **`src/` contains exactly one file, and nothing imports it.** The only observable contract is the CLI: `git diff | npm start` → JSON on stdout. There are no downstream consumers to keep compatible, which is what makes a clean-sheet module layout cheap now and expensive later.
- **`ai@7.0.64` is installed** (latest is 7.0.65 — same major, patch-level, no upgrade needed). Verified against the bundled, version-matched docs and source:
  - `ToolLoopAgent` is a public export of `ai` (`node_modules/ai/dist/index.d.ts:5147`).
  - The system-prompt field is **`instructions`, not `system`** (`node_modules/ai/src/agent/tool-loop-agent.ts:150-164`).
  - `output` takes an `Output` object — `Output.object({ schema })`, not a bare `{ schema }` (`node_modules/ai/docs/03-agents/02-building-agents.mdx:293-313`).
  - `Output.object` resolves to `responseFormat: { type: 'json', schema }` and parses the model's **text** as JSON (`node_modules/ai/src/generate-text/output.ts:110-140`). A malformed response throws `NoObjectGeneratedError`.
  - `agent.generate({ prompt })` delegates to `generateText` and returns a `GenerateTextResult`; the parsed object is on `.output`, typed from the schema.
  - `stopWhen` defaults to `isStepCount(20)` (`node_modules/ai/src/agent/tool-loop-agent.ts:130-134`), so with no tools the loop terminates after one step — behavior stays equivalent to today's `generateText` call.
  - `LanguageModel` accepts `GlobalProviderModelId | LanguageModelV4 | LanguageModelV3 | LanguageModelV2` (`node_modules/ai/dist/index.d.ts:112`), so `MockLanguageModelV4` from `ai/test` is assignable wherever a real model is.
- **`ai/test` ships mock models** — `MockLanguageModelV4` with a `doGenerateCalls` recording array (`node_modules/ai/dist/test/index.d.ts:103-120`). No extra dependency needed for a deterministic agent test.
- **`packages/` is outside root lint and CI** (`AGENTS.md` → Standalone packages). Verification is `cd packages/code-review && npm run lint && npm run typecheck`. New dependencies must be installed **from inside the package directory** — a root `npm install` silently rewrites the root manifest and lockfile.
- **ESLint here is `strictTypeChecked` + `stylisticTypeChecked`**, scoped to `src/**/*.ts` with `projectService: true` (`packages/code-review/eslint.config.js:9-19`). Files outside `src/` fall outside both the tsconfig `include` and the type-aware block — so tests belong under `src/`.
- **`tsconfig.json` sets `verbatimModuleSyntax` and `noUncheckedIndexedAccess`** — type-only imports must use `import type`, and indexed access yields `T | undefined`.
- **`.env.example:2` points at `src/index.ts`** for the default model id; that pointer goes stale once model resolution moves.

## Desired End State

`packages/code-review/src/` holds seven small modules, each with one reason to change. `agent.ts` exports `createReviewAgent(config)` returning a configured `ToolLoopAgent`, and `reviewDiff(diff, options)` returning a parsed `Review`. Neither reads env at import time nor requires a real API key when a model is injected — so a future promptfoo eval can import `reviewDiff` from `src/index.ts`, pass a pinned or mock model, and assert on typed output. The CLI keeps its exact contract: `git diff | npm start` prints the review as JSON, prints one readable line to stderr on failure, and exits non-zero. `npm test` runs a vitest suite that covers the two pure modules and the agent wiring.

Verified by: `npm run lint`, `npm run typecheck`, and `npm test` all green from inside the package, plus one real `git diff | npm start` run producing schema-valid JSON.

### Key Discoveries:

- **`ToolLoopAgent` with no tools is a deliberate choice.** The abstraction buys reusable configuration, co-located `instructions`/`output`, and a single object for evals to target — without handing filesystem capability to a model whose input (the diff) is semi-untrusted. The tool loop itself is unused, and that is the intended tradeoff.
- Because there are no tools, `toolsContext` is never required (it is mandatory only when a tool declares `contextSchema`) and `stopWhen` can stay at its default.
- **Version ground truth is per-call data** (it depends on `cwd`) while the agent is constructed **once** — so it belongs in the user prompt built per call, never in `instructions` baked at construction.
- `installedVersions()` currently swallows all read failures (`return []` / `return null`). That is correct behavior to preserve: a missing `package.json` or an unresolvable dependency must not fail a review.
- **`tsc` already catches the obvious wiring mistakes.** Probed against the installed SDK: `system:` on `ToolLoopAgentSettings` and a bare `output: { schema }` both fail with `TS2353`. So criterion 1.2 (`npm run typecheck`) covers them — the mock-model test must not be justified on that basis. What the mock test uniquely covers is what types cannot express: that the diff actually reaches the model as **user** content (not spliced into `instructions`), that the versions block is assembled into the same prompt, and that a JSON response parses into a typed `Review`.

## What We're NOT Doing

- **No promptfoo / eval environment** — no `promptfooconfig.yaml`, no eval provider shim, no eval scripts, no `callApi` adapter. Explicitly out of scope.
- **No tools on the agent** — no `getInstalledVersions` tool, no file-reading tool, no git tool. The eager version collection stays eager.
- **No `runtimeContext`, `toolsContext`, `callOptionsSchema`, `prepareCall`, `prepareStep`, `toolApproval`, or streaming** — none is needed for a tool-less single-step reviewer.
- **No `ai` upgrade** to 7.0.65 (patch-level, nothing relevant).
- **No prompt rewriting.** `instructions` text moves verbatim, including the "never judge dependency versions" guardrail. Review quality is deliberately held constant so that any later quality change is attributable to the prompt edit, not the restructure.
- **No schema changes** — `reviewSchema` moves unchanged, same fields, same `severity` enum.
- **No packaging** — no `main`, no `exports` field, no build step, no `dist/`. Consumers import `src/index.ts` by path.
- **No CI wiring** for the package's `lint`/`typecheck`/`test` scripts (`AGENTS.md` documents that `packages/` is outside the pipeline; changing that is a separate decision).
- **No package rename and no README.**

## Implementation Approach

Phase 1 is a behavior-preserving restructure: extract the pure pieces (schema, prompts) and the two impure ones (versions, model), build the agent on top of them, and move the CLI out of the module consumers import. Phase 2 adds the test harness.

The dependency direction is strictly one-way, so nothing imports the CLI:

```
cli.ts ──► index.ts ──► agent.ts ──► model.ts (env + provider)
                                 ├─► prompts.ts (instructions + user prompt)
                                 ├─► schema.ts (reviewSchema, Review)
                                 └─► installed-versions.ts (fs I/O)
```

`installed-versions.ts` is the only module that touches the filesystem, and `model.ts` is the only one that reads `process.env`. That isolation is what makes `prompts.ts` and `schema.ts` testable with no mocks, and what lets an eval inject a model and skip env entirely.

## Critical Implementation Details

**Prompt-injection posture.** The diff is model-facing input from a semi-untrusted source. Two guards must survive the refactor: the diff stays in the **user prompt** (never spliced into `instructions`), and the guardrail sentences stay in `instructions`. `ToolLoopAgent` rejects `role: "system"` messages in prompts by default as an injection guard — do not set `allowSystemInMessages`.

**`finishReason` is an object in v7, not a string.** Mock `doGenerate` results use `finishReason: { unified: 'stop', raw: undefined }` and a nested `usage` shape (`inputTokens: { total, noCache, ... }`). Remembered v4/v5 shapes will not typecheck. Copy the structure from the version-matched example at `node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx:105-130` rather than writing it from memory.

**Filesystem scoping (latent guard).** The FS-safety rule has no model-controlled path to defend today, since there are no tools. It applies to `installed-versions.ts` as a documented constraint: all reads resolve relative to the passed `cwd` and are limited to `package.json` and `node_modules/<name>/package.json` manifests. Record this as a comment in that module so the rule sits at the seam where a future tool would attach.

## Phase 1: Modular conversion

### Overview

Split `index.ts` into seven modules, rebuild the reviewer on `ToolLoopAgent`, and move the CLI to its own entry point. No change to review behavior; the CLI contract is preserved and its error path improved.

### Prerequisite: capture the review baseline

**Before touching any code**, run the current implementation against a fixed diff and keep the output:

```bash
cd packages/code-review && git diff HEAD~1 > /tmp/review-baseline.diff
npm start < /tmp/review-baseline.diff > /tmp/review-baseline.json
```

Criterion 1.8 compares against this file. Once the refactor lands there is no way to regenerate it without stashing the whole change, so capturing it afterwards is not an option. Both files stay outside the repo.

### Changes Required:

#### 1. Structured output schema

**File**: `packages/code-review/src/schema.ts` (new)

**Intent**: Give the review output schema its own module so evals and future consumers can import it for assertions without pulling in the agent, env parsing, or filesystem code.

**Contract**: Exports `reviewSchema` (moved verbatim from `index.ts:18-28`, including the `.describe()` on `summary`) and `export type Review = z.infer<typeof reviewSchema>`.

#### 2. Prompts

**File**: `packages/code-review/src/prompts.ts` (new)

**Intent**: Hold the agent's static instructions and the per-call user-prompt construction, with no I/O, so prompt shape is unit-testable and promptfoo has one file to point at when varying prompts later.

**Contract**: Two exports, both pure.

- `reviewInstructions: string` — the sentences currently joined at `index.ts:63-70`, moved verbatim.
- `buildReviewPrompt({ diff, versions }: { diff: string; versions: string[] }): string` — reproduces the conditional at `index.ts:71`: with versions, the `Installed versions (ground truth):` block followed by `Diff:` and the diff; with an empty array, the bare diff. This branch is what Phase 2 pins.

#### 3. Installed versions collector

**File**: `packages/code-review/src/installed-versions.ts` (new)

**Intent**: Isolate the only filesystem I/O in the package, so it is the single seam to fake in tests and the single place the cwd-scoping rule is enforced.

**Contract**: `collectInstalledVersions(cwd: string): Promise<string[]>` — the body of `index.ts:33-56` moved unchanged, returning `["name@version", ...]`. Preserve both failure paths: an unreadable `package.json` yields `[]`, and an unresolvable dependency is dropped rather than throwing. Carry a short comment recording that reads resolve under `cwd` and are limited to manifest files (see Critical Implementation Details).

#### 4. Model resolution

**File**: `packages/code-review/src/model.ts` (new)

**Intent**: Confine env parsing and provider construction to one module, so importing the agent never touches `process.env` unless a model actually has to be resolved.

**Contract**: Exports `resolveModel(): LanguageModel` — the current `getModel()` body from `index.ts:8-16`, keeping the `envSchema` with its actionable `OPENROUTER_API_KEY is missing — copy .env.example to .env` message and the `anthropic/claude-haiku-4.5` default. Env is read **inside** the function, never at module scope. Import the `LanguageModel` type from `ai` with `import type` (`verbatimModuleSyntax` is on).

#### 5. The review agent

**File**: `packages/code-review/src/agent.ts` (new)

**Intent**: The reusable core. Build the `ToolLoopAgent` from the modules above and expose both a factory (for evals that want steps or usage, or a mock model) and a one-call convenience function (for the CLI and simple assertions).

**Contract**: Two exports plus a config type.

- `ReviewAgentConfig = { model?: LanguageModel }` — when `model` is omitted, `resolveModel()` supplies it. This is the seam that lets an eval inject a pinned or mock model with no env present.
- `createReviewAgent(config?: ReviewAgentConfig)` — returns `new ToolLoopAgent({ model, instructions: reviewInstructions, output: Output.object({ schema: reviewSchema }) })`. Synchronous, no I/O, no `cwd`, so one instance is safely reusable across calls. Leave `stopWhen` unset (the default is unreachable without tools) and set no other options — be minimal, per the AI SDK skill.
- `reviewDiff(diff: string, options?: ReviewAgentConfig & { cwd?: string }): Promise<Review>` — collects versions for `cwd` (default `process.cwd()`), builds the prompt with `buildReviewPrompt`, calls `agent.generate({ prompt })`, returns `.output`. It constructs its agent **per call** via `createReviewAgent(options)` — never a module-level singleton, since `options.model` varies per call. Construction is synchronous and does no I/O, so this is free. `.output` is non-optional and typed from the schema (`GenerateTextResult.output: InferCompleteOutput<OUTPUT>`), so no non-null assertion is needed.

`ToolLoopAgent` and `Output` both import from `ai`. Errors from zod validation and from the SDK propagate untouched — the CLI is what formats them.

#### 6. Public API surface

**File**: `packages/code-review/src/index.ts` (rewrite)

**Intent**: Become the package's public API — a re-export barrel with no side effects, so importing it never reads stdin, parses env, or runs a review.

**Contract**: Re-exports `createReviewAgent`, `reviewDiff`, `ReviewAgentConfig`, `reviewSchema`, `Review`, `buildReviewPrompt`, and `reviewInstructions`. The `main()` function, the `readStdin()` helper, and the `import.meta.url` guard all leave this file. Re-export the types with `export type` (`verbatimModuleSyntax`).

The two prompt exports are what make `createReviewAgent` usable on its own: a consumer holding a factory-built agent calls `.generate({ prompt })`, and without `buildReviewPrompt` it would have to re-implement the versions block and `Diff:` framing — testing its own prompt wiring instead of the reviewer's. `collectInstalledVersions` stays internal; a caller that wants ground-truth versions in the prompt should use `reviewDiff`.

#### 7. CLI entry point

**File**: `packages/code-review/src/cli.ts` (new)

**Intent**: Own the terminal contract — stdin in, JSON out, readable errors — separate from the importable library.

**Contract**: Holds `readStdin()` and `main()` moved from `index.ts:78-101`, preserving the empty-input path (`Usage: git diff | npm start` to stderr, `process.exitCode = 1`) and the `JSON.stringify(review, null, 2)` stdout format. Adds the error handling decided for this change: wrap the review call so a thrown error prints a single readable line to stderr and exits non-zero, rather than dumping a zod or SDK stack — the missing-API-key message exists precisely to be read by a human.

The `process.argv[1] === fileURLToPath(import.meta.url)` guard can go: this file is only ever the entry point. Keep the top-level `await`.

#### 8. Package scripts and env docs

**File**: `packages/code-review/package.json`

**Intent**: Point the CLI scripts at the new entry point.

**Contract**: `start` and `dev` change from `src/index.ts` to `src/cli.ts`; flags (`--env-file-if-exists=.env`, `--import tsx`, `--watch`) unchanged.

**File**: `packages/code-review/.env.example`

**Intent**: Fix the pointer this refactor makes stale.

**Contract**: Line 2's `see src/index.ts for the default` becomes `see src/model.ts for the default`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `cd packages/code-review && npm run lint`
- Type checking passes: `cd packages/code-review && npm run typecheck`
- No module reads env or does I/O at import time: with `OPENROUTER_API_KEY` unset, `cd packages/code-review && node --import tsx -e "await import('./src/index.ts'); console.log('clean import')"` succeeds
- `src/index.ts` exports the full public surface: `cd packages/code-review && node --import tsx -e "const m = await import('./src/index.ts'); console.log(Object.keys(m).sort().join(','))"` lists `buildReviewPrompt,createReviewAgent,reviewDiff,reviewInstructions,reviewSchema` (types erase at runtime)

#### Manual Verification:

- `git diff | npm start` from inside the package prints schema-valid JSON for a real diff, with findings anchored to files and lines
- Missing API key prints one readable line naming it, not a zod stack dump. **Unsetting the shell variable is not enough** — `npm start` runs `node --env-file-if-exists=.env` and `packages/code-review/.env` holds a real key, so the file must be taken out of the picture: `mv .env .env.bak && node --import tsx src/cli.ts < /tmp/review-baseline.diff; mv .env.bak .env`
- `npm start` with empty stdin still prints `Usage: git diff | npm start` and exits non-zero
- Review quality on `/tmp/review-baseline.diff` is unchanged from `/tmp/review-baseline.json` captured in the Prerequisite — same class of findings, no new version-related claims. Model output is non-deterministic, so compare classes of findings, not bytes.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Vitest harness

### Overview

Add a test runner to the package and lock in what Phase 1 built: the two pure modules, plus the agent wiring itself via a mock model — no live API calls, no tokens spent.

### Changes Required:

#### 1. Test runner

**File**: `packages/code-review/package.json`

**Intent**: Add vitest and a `test` script so the extracted modules have a fast regression signal.

**Contract**: `vitest` added to `devDependencies` via `npm install -D vitest` **run from inside `packages/code-review/`** — a root install rewrites the root manifest and lockfile (`AGENTS.md` → Standalone packages). Add `"test": "vitest run"`. No config file unless vitest needs one for this layout; default discovery of `src/**/*.test.ts` is expected to work out of the box.

#### 2. Prompt builder tests

**File**: `packages/code-review/src/prompts.test.ts` (new)

**Intent**: Pin the one branch in the prompt builder — the exact behavior a future prompt edit could silently break.

**Contract**: Covers `buildReviewPrompt` with a non-empty `versions` array (ground-truth block present, versions newline-joined, diff present under its `Diff:` label) and with an empty array (bare diff, no ground-truth block, no stray label). One assertion that the diff text appears verbatim in both cases.

#### 3. Schema tests

**File**: `packages/code-review/src/schema.test.ts` (new)

**Intent**: Confirm the review contract accepts a well-formed review and rejects the malformed shapes a model plausibly emits.

**Contract**: `reviewSchema.parse` succeeds on a review with a summary and one finding; fails on an invalid `severity` value, on a non-positive or non-integer `line`, and on a missing `summary`. Use `safeParse` for the failure cases.

#### 4. Agent wiring test

**File**: `packages/code-review/src/agent.test.ts` (new)

**Intent**: Prove what `tsc` cannot — that the diff reaches the model as **user** content rather than being spliced into `instructions`, that the versions block lands in the same prompt, and that a JSON response parses into a typed `Review`. (Field-name and `Output` mistakes are already caught by `npm run typecheck`; see Key Discoveries.)

**Contract**: Construct `new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(review) }], ... }) })` from `ai/test` and pass it as `reviewDiff(diff, { model, cwd })`. Assert the returned value deep-equals the review the mock emitted, and inspect the mock's `doGenerateCalls[0]` to confirm the diff text is present in the prompt and the instructions were sent. Use a `cwd` pointing at a directory with no `package.json` (e.g. `os.tmpdir()`) so `collectInstalledVersions` takes its empty path and the test does no real dependency walk.

The `doGenerate` result shape is non-obvious in v7 (`finishReason: { unified, raw }`, nested `usage`) — copy it from `node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx:105-130`, which is version-matched to the installed SDK.

#### 5. Lint and typecheck coverage for tests

**File**: `packages/code-review/eslint.config.js` and/or `packages/code-review/tsconfig.json`

**Intent**: Keep the new test files inside both gates rather than accidentally exempt.

**Contract**: Test files live under `src/`, so `tsconfig.json`'s `include: ["src/**/*.ts"]` and the ESLint `files: ["src/**/*.ts"]` type-aware block already cover them — verify this rather than assume it. Adjust only if a real error appears. Prefer explicit `import { describe, expect, it } from "vitest"` over enabling globals, which needs no config change at all.

### Success Criteria:

#### Automated Verification:

- Tests pass: `cd packages/code-review && npm test`
- Agent test makes no network call: `npm test` passes with `OPENROUTER_API_KEY` unset
- Lint still passes with test files present: `cd packages/code-review && npm run lint`
- Type checking still passes with test files present: `cd packages/code-review && npm run typecheck`
- Root lockfile untouched by the vitest install: from the repo root, `git status --short package.json package-lock.json` shows no changes

#### Manual Verification:

- Inverting the versions-block condition in `buildReviewPrompt` makes a prompt test fail; revert after confirming
- Widening `severity` to `z.string()` makes a schema test fail; revert after confirming
- Moving the diff out of the user prompt and into `instructions` makes the agent test fail; revert after confirming

**Implementation Note**: The three manual items are break-and-revert checks — they empirically prove each test catches the regression it claims to, rather than assuming it. The third must be a break that `tsc` cannot catch, otherwise it proves nothing about the test: renaming `instructions` to `system` would fail to compile (`TS2353`) and never reach the assertion. Passing the diff via `instructions` compiles fine and is the actual prompt-injection posture the plan commits to preserving, so it is the right break to test.

---

## Testing Strategy

### Unit Tests:

- `buildReviewPrompt` — versions present vs. absent; diff preserved verbatim in both
- `reviewSchema` — valid review parses; invalid severity, invalid line, missing summary all rejected

### Integration Tests:

- `reviewDiff` against `MockLanguageModelV4` — end-to-end through prompt assembly, agent construction, and output parsing, with no network and no API key. This is the closest thing to an integration test that stays deterministic; a live-model test is deferred to the promptfoo evals that are out of scope here.

### Manual Testing Steps:

0. **Before any code change**: capture `/tmp/review-baseline.diff` and `/tmp/review-baseline.json` (see Phase 1 Prerequisite)
1. `cd packages/code-review && npm start < /tmp/review-baseline.diff` — confirm schema-valid JSON on stdout
2. `mv .env .env.bak`, rerun via `node --import tsx src/cli.ts` — confirm one readable error line on stderr and a non-zero exit, then `mv .env.bak .env`
3. `echo "" | npm start` — confirm the usage message and non-zero exit
4. Break the versions-block condition, run `npm test`, confirm failure, revert
5. Widen the `severity` enum, run `npm test`, confirm failure, revert
6. Move the diff from the user prompt into `instructions`, run `npm test`, confirm failure, revert

## Performance Considerations

`collectInstalledVersions` reads one manifest per direct dependency in parallel via `Promise.all` — unchanged from today, and negligible next to a model round-trip. No new I/O is introduced. The agent test does no I/O at all.

## Migration Notes

Nothing imports `src/index.ts` today, so there is no consumer migration. The one externally visible move is `package.json`'s `start`/`dev` scripts pointing at `src/cli.ts`; `git diff | npm start` keeps working identically. Rollback is `git revert` of the phase commit — no state, no schema, no deployed artifact.

## References

- Change identity: `context/changes/tool-loop-agent/change.md`
- Current implementation: `packages/code-review/src/index.ts:1-101`
- `ToolLoopAgent` reference: `packages/code-review/node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`
- Agent + structured output: `packages/code-review/node_modules/ai/docs/03-agents/02-building-agents.mdx:293-313`
- `ToolLoopAgent` source (instructions handling, `stopWhen` default): `packages/code-review/node_modules/ai/src/agent/tool-loop-agent.ts:130-164`
- `Output.object` signature and JSON parsing: `packages/code-review/node_modules/ai/src/generate-text/output.ts:92-140`
- Mock model for structured output (version-matched): `packages/code-review/node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx:105-130`
- `MockLanguageModelV4` declaration: `packages/code-review/node_modules/ai/dist/test/index.d.ts:103-120`
- Standalone-package rules (install location, CI exclusion): `AGENTS.md` → Standalone packages
- AI SDK skill (do not write SDK code from memory): `packages/code-review/.claude/skills/ai-sdk/SKILL.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Modular conversion

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 No module reads env or does I/O at import time (clean import with `OPENROUTER_API_KEY` unset)
- [x] 1.4 `src/index.ts` exports the full public surface

#### Manual

- [x] 1.5 `npm start` prints schema-valid JSON for a real diff
- [x] 1.6 Missing API key (with `.env` moved aside) prints one readable line, not a zod stack dump
- [x] 1.7 Empty stdin still prints the usage message and exits non-zero
- [x] 1.8 Review quality on the baseline diff unchanged from the captured baseline

### Phase 2: Vitest harness

#### Automated

- [ ] 2.1 Tests pass: `npm test`
- [ ] 2.2 Agent test makes no network call (`npm test` passes with `OPENROUTER_API_KEY` unset)
- [ ] 2.3 Lint still passes with test files present
- [ ] 2.4 Type checking still passes with test files present
- [ ] 2.5 Root lockfile untouched by the vitest install

#### Manual

- [ ] 2.6 Inverting the versions-block condition makes a prompt test fail (revert after)
- [ ] 2.7 Widening the `severity` enum makes a schema test fail (revert after)
- [ ] 2.8 Moving the diff into `instructions` makes the agent test fail (revert after)
