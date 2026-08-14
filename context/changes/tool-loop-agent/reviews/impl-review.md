<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tool Loop Agent — Modular Code Review Agent

- **Plan**: `context/changes/tool-loop-agent/plan.md`
- **Scope**: Full plan (Phase 1 + Phase 2, 16/16 Progress rows `[x]`)
- **Date**: 2026-08-14
- **Verdict**: APPROVED (1 warning, 3 observations)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

Commits reviewed: `109dda5` (p1), `51a2043` (p2), `6604af6` (epilogue) on `feat/code-review-tool-loop-agent`. 19 files changed vs `master`.

Success criteria re-run at review time — all green:

- 1.1 / 2.3 lint ✓ · 1.2 / 2.4 typecheck ✓ · 1.3 clean import with no key ✓
- 1.4 exports exactly `buildReviewPrompt,createReviewAgent,reviewDiff,reviewInstructions,reviewSchema` ✓
- 2.1 / 2.2 11 tests pass with `OPENROUTER_API_KEY` unset ✓ · 2.5 root manifest untouched ✓

Safety: no real credential in any commit (the only `sk-or-v1-` hit is the `xxxxxxxx` placeholder in `.env.example`); `.env` is gitignored and uncommitted. No injection surface, no destructive I/O, no unbounded iteration. `installed-versions.ts` reads only manifests under the passed `cwd`, as specified.

Architecture: dependency direction verified one-way (`cli → index → agent → {model, prompts, schema, installed-versions}`); nothing imports `cli.ts`. `model.ts` is the sole `process.env` reader, `installed-versions.ts` the sole filesystem toucher — both confirmed by criterion 1.3 passing with no key present.

## Findings

### F1 — The versions path is untested; all 11 tests pass when it is dropped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `packages/code-review/src/agent.test.ts:33,41,60` (all three tests use `tmpdir()`)
- **Detail**: Phase 2 §4's stated Intent is to prove "the diff reaches the model as user content … **that the versions block lands in the same prompt**, and that a JSON response parses into a typed `Review`". Its Contract, however, mandates a `cwd` with no `package.json` (`os.tmpdir()`) so `collectInstalledVersions` takes its empty path. The plan contradicts itself, and the implementation followed the Contract — so nothing asserts that collected versions reach the prompt.

  Verified empirically: replacing `buildReviewPrompt({ diff, versions })` with `buildReviewPrompt({ diff, versions: [] })` in `agent.ts:33` leaves **all 11 tests passing**. The ground-truth block — the whole reason `collectInstalledVersions` exists — has no regression guard.
- **Fix**: Add a fourth case to `agent.test.ts` that passes `cwd: process.cwd()` (the package has a real `package.json` and `node_modules`) and asserts the user prompt contains `Installed versions (ground truth):` and at least one `name@version` row. This closes the gap and incidentally covers `collectInstalledVersions`' happy path (see F3).
- **Decision**: FIXED — versions-path assertion added to agent.test.ts (verified by break-and-revert)

### F2 — `readStdin()` sits outside the try/catch, bypassing the readable-error path

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `packages/code-review/src/cli.ts:22`
- **Detail**: `const diff = await readStdin();` is outside the `try` block that formats errors into one readable line. A stdin read failure (EIO, prematurely closed pipe) therefore rejects out of `main()` at the top-level `await`, producing exactly the stack dump criterion 1.6 exists to eliminate. Rare in practice — piping from `git diff` doesn't normally fail — which is why this is an observation rather than a warning.
- **Fix**: Move the `readStdin()` call inside the existing `try`, or wrap `await main()` in a `.catch()` that routes through `toMessage`.
- **Decision**: PENDING

### F3 — `collectInstalledVersions` has no direct test despite being the designated test seam

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `packages/code-review/src/installed-versions.ts`
- **Detail**: Phase 1 §3's Intent calls this module "the single seam to fake in tests", and it carries two deliberate silent-failure paths (unreadable `package.json` → `[]`; unresolvable dependency → dropped). Phase 2 scoped tests to prompts, schema, and agent only, so this is not a deviation from the plan as written — but the module the plan singled out as the testing seam ended up with zero direct coverage, and its swallow-all-errors behavior is exactly the kind that rots silently.
- **Fix**: If F1's fix is applied it covers the happy path; add one case asserting `collectInstalledVersions(tmpdir())` returns `[]` to pin the missing-manifest path.
- **Decision**: PENDING

### F4 — `allowImportingTsExtensions` was added outside the plan's anticipated scope

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `packages/code-review/tsconfig.json:11`
- **Detail**: The plan's only sanctioned tsconfig edit (Phase 2 §5) was for keeping test files inside the typecheck gate, "adjust only if a real error appears". A real error did appear — `TS5097` on the `.ts` import specifiers — but in Phase 1, not the test-coverage context the escape hatch described. The flag is legal here (`noEmit` is set) and consistent with the plan's "no build step, no packaging" commitment. Recorded because it is a durable constraint, not a passing detail: with `.ts` specifiers baked into every import, the package cannot emit JS later without rewriting all of them.
- **Fix**: No code change needed. Note the constraint in the plan's Migration Notes so a future packaging decision doesn't rediscover it.
- **Decision**: PENDING

### F5 — Package tests lived in `src/`; project convention is `tests/`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `packages/code-review/tests/{unit,integration}/` (was `src/*.test.ts`)
- **Detail**: Raised by the user. The root project keeps all 20 test files in `tests/{unit,integration,e2e}/` with vitest `include: ["tests/**/*.test.ts"]` and zero co-located tests; this package deviated. The plan chose `src/` deliberately because the package's gates are narrow (`tsconfig include: ["src/**/*.ts"]`, eslint `files: ["src/**/*.ts"]`), unlike the root's wide ones (`include: ["**/*"]`, `files: ["**/*.{js,ts,…}"]`).

  Measured before moving: a file at `tests/probe.test.ts` containing `const x: number = "string"` passed `npm run typecheck` clean, and eslint reported *"File ignored because no matching configuration was supplied"*. Moving the files alone would have silently dropped all 12 tests out of both gates.
- **Fix**: Applied — moved to `tests/unit/` (prompts, schema) and `tests/integration/` (agent), mirroring the root layout and the plan's own Testing Strategy taxonomy. Widened `tsconfig.json` `include` and the eslint type-aware `files` to `["src/**/*.ts", "tests/**/*.ts"]`. Gate coverage re-verified by planting the same type error under the new location: `tsc` now fails with `TS2322` and eslint no longer ignores the file.
- **Correction**: the fix was proposed partly on the claim that `vitest.config.ts` could be deleted, since vitest 4's default include is already `tests/**/*.test.ts`. That was wrong. With no local config, vitest walks up and loads the **repo-root** `vitest.config.ts`, whose `globalSetup: ["tests/setup/env.ts"]` does not exist in this package — the run dies with `ERR_LOAD_URL`. The local config must stay to shadow the root one; it is now empty except for the comment explaining why. Net config change is neutral, not −8 lines.
- **Decision**: FIXED

### F6 — Flat layout does not mark the agent-specific / shared boundary

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: `packages/code-review/src/` (whole layout)
- **Detail**: Raised by the user, whose stated intent is that the package should host **multiple agents / other tools**, not just the reviewer. The current flat layout does not distinguish which modules belong to the reviewer and which are shared infrastructure:

  | Module | Scope | Lines |
  | --- | --- | --- |
  | `schema.ts`, `prompts.ts`, `agent.ts`, `installed-versions.ts`, `cli.ts` | reviewer-specific | 151 |
  | `model.ts` (`resolveModel`) | agent-agnostic / shared | 18 |
  | `index.ts` | barrel | 3 |

  5 of 7 modules are reviewer-specific. Their names (`agent.ts`, `prompts.ts`, `schema.ts`) read as if only one agent will ever exist — when a second arrives, `prompts.ts` becomes ambiguous. The instinct behind the question is correct.

  However the **by-kind** structure proposed (`agents/`, `prompts/`, `schemas/`, `providers/`) optimizes the wrong axis for that goal:
  - Every directory would hold exactly one file at current size (172 lines total, largest module 40 lines).
  - Adding a second agent would touch 3–4 directories; reading one agent would require visiting all of them.
  - `installed-versions.ts` fits none of the four buckets cleanly — a diagnostic sign that the taxonomy does not match the domain. It is reviewer-specific context gathering (a diff reviewer needs dependency versions; a summarizer would not).

  A **by-feature** structure serves the same goal better: `agents/reviewer/{agent,prompts,schema,installed-versions}.ts` plus a shared `providers/model.ts`. Adding agent #2 becomes one new directory with zero edits elsewhere, and the shared/specific boundary becomes visible in the tree.

  Relevant history: this exact choice was made during planning. "Directory-per-concern (`src/agent/`, `src/schemas/`, `src/prompts/`)" was offered and rejected in favour of "Seven flat modules", with the tradeoff recorded as *"Pure ceremony at current size — one file per directory."* Nothing in the code has changed since. What is new is the explicit multi-agent intent.

  No evidence of a concrete second agent exists anywhere in `context/foundation/` or `context/changes/`.
- **Fix A ⭐ Recommended**: Keep flat now; restructure by-feature when agent #2 actually arrives.
  - Strength: Deferring costs one `git mv` of 4 files plus import updates — mechanical and safe, with 12 tests guarding it. Restructuring now means guessing the shared/specific boundary from a single example, which is how premature layering goes wrong. Matches the project's own rule: "No abstractions for single-use code. Nothing speculative."
  - Tradeoff: Module names stay agent-implicit until then; a newcomer cannot tell from the tree which parts are reusable.
  - Confidence: HIGH — 172 lines across 7 modules is well below the size where layout costs anything.
  - Blind spot: If agent #2 is already scheduled, deferring just moves the same work later at slightly higher cost.
- **Fix B**: Restructure now, by-feature — `agents/reviewer/` + `providers/` — skipping by-kind entirely.
  - Strength: Makes the extension point explicit immediately; agent #2 is then a pure addition. Keeps each agent cohesive, unlike by-kind.
  - Tradeoff: Deeper import paths and a directory tree heavier than 172 lines of code warrants; the shared/specific split is inferred from one example.
  - Confidence: MEDIUM — the structure is sound, but the shared boundary is a guess until a second agent exists to generalize from.
  - Blind spot: Whether agent #2 would actually reuse `resolveModel` as-is, or need per-agent model config.
- **Decision**: FIXED via Fix B — restructured to `agents/reviewer/` + `providers/`, with a per-agent barrel so the root re-exports one path per agent. Public API surface unchanged; all 12 tests and both break-and-revert guards re-verified after the move.

## What held up

- **Prompt text is byte-identical to the original**, proven against `git show HEAD:packages/code-review/src/index.ts` rather than a remembered copy — instructions and both `buildReviewPrompt` branches. The plan's "no prompt rewriting" guarantee holds.
- **Every "What We're NOT Doing" boundary respected**: no promptfoo config, no tools on the agent, no `runtimeContext`/`prepareCall`/streaming, no `ai` upgrade, no schema change, no `exports`/`main`/build step, no CI wiring, no README.
- **Break-and-revert checks are genuine.** The 2.8 break (diff spliced into `instructions`) compiles cleanly at `tsc` exit 0 yet fails the agent test — confirming the test covers what types cannot, which was the point of the pre-implementation plan-review fix.
- **CLI contract preserved and improved**: empty stdin → usage message, exit 1; missing key → exactly one line (`OPENROUTER_API_KEY is missing — copy .env.example to .env`), exit 1, empty stdout.
