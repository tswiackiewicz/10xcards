# Tool Loop Agent — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

`packages/code-review/src/index.ts` is a 102-line file doing five jobs at once: env parsing, schema definition, filesystem I/O, the review call, and the CLI. That shape blocks the next step — running promptfoo evals against the reviewer — because there is no way to import the reviewer without also importing stdin handling and an env read that throws when no API key is present. This change splits it into seven focused modules and rebuilds the reviewer on the AI SDK's `ToolLoopAgent` with an injectable model.

## Starting Point

One file, no consumers. The only observable contract is `git diff | npm start` → JSON on stdout. `ai@7.0.64` is installed with its full docs and source bundled in `node_modules`, and the package sits outside root lint and CI (`AGENTS.md` → Standalone packages), so it is verified by its own `lint` / `typecheck` scripts run from inside the directory.

## Desired End State

Seven modules, each with one reason to change. `agent.ts` exports `createReviewAgent(config)` and `reviewDiff(diff, options)`; both accept an optional model, so an eval can inject a pinned or mock model with no env present and assert on typed output. `index.ts` is a side-effect-free barrel. The CLI keeps its exact contract but now prints one readable line instead of a zod stack when something fails. `npm test` runs a vitest suite covering the pure modules and the agent wiring, with no network calls.

## Key Decisions Made

| Decision           | Choice                                            | Why (1 sentence)                                                                                                              |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Agent shape        | `ToolLoopAgent` with **no tools**                 | Buys reusable config and a single object for evals to target, without handing filesystem capability to a model reading semi-untrusted diff input. |
| Export API         | Factory **and** convenience function              | Evals call one async function and assert on typed output; the factory stays available when a test wants steps or usage.        |
| Model injection    | Optional override, env fallback                   | CLI stays zero-config while evals inject a mock model with no env present; importing never touches `process.env`.              |
| Granularity        | Seven flat modules                                | I/O and env are each confined to exactly one file, which is what makes the other modules testable without mocks.               |
| Test scope         | Pure modules **+ one mock-model agent test**      | The mock test covers what types cannot: the diff reaching the model as user content, and JSON parsing into a typed `Review`.   |
| CLI errors         | One readable stderr line, non-zero exit           | The `OPENROUTER_API_KEY is missing` message exists to be read by a human; today a zod trace buries it.                         |
| Prompt text        | Moved verbatim                                    | Keeps the refactor behavior-preserving, so later quality changes are attributable to the prompt edit and evals get a baseline. |
| Entry point        | Path import, no packaging                         | The package is `private: true` and runs from source via tsx — `exports` or a build step would be maintenance for no consumer.  |

## Scope

**In scope:**

- Seven modules: `schema.ts`, `prompts.ts`, `model.ts`, `installed-versions.ts`, `agent.ts`, `cli.ts`, `index.ts`
- Reviewer rebuilt on `ToolLoopAgent` (`instructions` + `Output.object`), model injectable
- CLI moved out of the importable module, with readable error handling
- Vitest harness: prompt branches, schema validation, agent wiring via `MockLanguageModelV4`
- `package.json` scripts and the stale `.env.example` pointer

**Out of scope:**

- promptfoo config, eval provider shim, eval scripts — deliberately deferred
- Tools on the agent, streaming, `runtimeContext`, `prepareCall`, `callOptionsSchema`
- Prompt rewriting, schema changes, `ai` upgrade
- Packaging (`exports`, build step, `dist/`), CI wiring, README

## Architecture / Approach

Strictly one-way dependencies, so nothing imports the CLI:

```
cli.ts ──► index.ts ──► agent.ts ──► model.ts (env + provider)
                                 ├─► prompts.ts (instructions + user prompt)
                                 ├─► schema.ts (reviewSchema, Review)
                                 └─► installed-versions.ts (fs I/O)
```

`installed-versions.ts` is the only module touching the filesystem; `model.ts` is the only one reading `process.env`. That isolation is the whole point — it is what lets `prompts.ts` and `schema.ts` be tested with no mocks, and what lets an eval skip env entirely.

## Phases at a Glance

| Phase                    | What it delivers                                                       | Key risk                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Modular conversion    | Seven modules, agent on `ToolLoopAgent`, CLI split out, scripts updated | Review quality drifting unnoticed. Field-name and `Output` mistakes are caught by `tsc`, but nothing automated compares review output before vs after — hence the baseline captured in the Phase 1 Prerequisite. |
| 2. Vitest harness        | Tests for prompts, schema, and agent wiring via a mock model            | v7's `doGenerate` result shape (`finishReason: { unified, raw }`, nested `usage`) differs from remembered versions; must be copied from bundled docs. |

**Prerequisites:** None. `ai@7.0.64` and its bundled docs are already installed; `ai/test` ships the mock models, so Phase 2 adds only `vitest`.
**Estimated effort:** ~1–2 sessions. Phase 1 is a mechanical split plus one API swap; Phase 2 is three small test files and one dependency.

## Open Risks & Assumptions

- **The tool-less `ToolLoopAgent` is an abstraction bet.** Today it buys config reuse and an eval target, not agency. If reviews later need repo context (reading files around a hunk), tools get added — and that brings real FS-sandboxing work the current design deliberately defers.
- **Assumed:** vitest discovers `src/**/*.test.ts` and typechecks under the existing `include` / ESLint `files` globs with no config change. Phase 2 verifies this rather than assuming it; a config tweak is the fallback.
- **Assumed:** review quality is unchanged by the restructure. There is no eval harness yet to prove it, so the check is a manual before/after against a baseline captured in the Phase 1 Prerequisite — the weakest verification in this plan (model output is non-deterministic, so it compares classes of findings, not bytes), and precisely what the deferred promptfoo work will fix.
- Installing `vitest` from the repo root instead of inside the package would silently rewrite the root lockfile; Phase 2 has an explicit success criterion guarding against it.

## Success Criteria (Summary)

- `reviewDiff` can be imported and driven with an injected model, no API key and no env file present — the precondition for promptfoo evals
- `git diff | npm start` behaves exactly as before, and failures print one readable line instead of a stack dump
- `npm run lint`, `npm run typecheck`, and `npm test` are all green from inside the package, with the agent test proving the wiring by break-and-revert
