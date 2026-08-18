# AI Code Review CI/CD Workflow — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Requirements: `context/changes/ci-cd-code-review/requirements.md`
> Research: `context/changes/ci-cd-code-review/research.md` (2026-08-18, supersedes the 2026-08-14 version)
> Plan reviews: `reviews/plan-review-2026-08-14.md` (10 findings, all closed, cited as [F<n>]) ·
> `reviews/plan-review.md` (2026-08-18, cited as [R2-F<n>])

## What & Why

Give this repo its first AI code review in CI. `packages/code-review` already reviews a diff and returns
prose findings; `requirements.md` turns that into a scored rubric — six criteria on a 1–10 scale with
written anchors, `n/a` for criteria a diff cannot exercise, and a pass/fail label derived **mechanically**
from the numbers plus five named blocking categories that fail a PR regardless of score. This plan builds
that rubric and wires it to every same-repo PR to `master` as an advisory bot.

## Starting Point

The package is green and standalone (9 source files, 15 tests) but has no scores, no verdict, no rubric,
and reads only stdin. `.github/` holds two workflows and nothing else — no composite action, no
`permissions:`, no `concurrency:`, no YAML validation anywhere in the repo. Verified live: `master`
protection requires exactly one check (`ci`), `OPENROUTER_API_KEY` is not a repo secret, and no `ai-cr:*`
label exists. Two prior plan versions exist; this one is written against research that explicitly
supersedes the research the second was built on.

## Desired End State

A PR to `master` gets one sticky comment within ~2 minutes carrying a summary, a six-row score table with
a note per criterion, and findings anchored to files and lines — plus, whenever a review produced a
verdict, exactly one of `ai-cr:passed`
(green) / `ai-cr:failed` (red). Re-adding `ai-cr:review` re-runs it and rewrites the same comment. When
the review cannot run, the PR gets an explanatory comment and **no** label, never silence plus a stale
`passed`.

## Key Decisions Made

| Decision             | Choice                                              | Why (1 sentence)                                                                                                                                              | Source                                 |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Score encoding       | String enum `"1"…"10","n/a"`                        | The only encoding inside the provider's strict-mode keyword subset; makes out-of-range scores unrepresentable and sidesteps `restrict-template-expressions`   | Research §4 → Plan                     |
| Verdict location     | Computed in `verdict.ts`, absent from the schema    | If the model authors its own verdict, "derived mechanically" is defeated                                                                                      | Research §10                           |
| Schema-miss handling | No retry — route to the action-level `error` state  | Keeps resilience in one visible place instead of doubling review cost invisibly; a human re-triggers with `ai-cr:review`                                      | Plan                                   |
| Error diagnosability | `toMessage` unwraps `NoObjectGeneratedError`        | With no retry, that one line is the entire diagnostic budget                                                                                                  | Research §5 → Plan                     |
| Determinism          | `temperature: 0` + `seed`, **no** `maxOutputTokens` | Removes sampling as a source of score drift; an output cap would compose badly with no-retry, making a large PR permanently unreviewable                      | Research §6 → R2-F4                    |
| Model                | `anthropic/claude-haiku-4.5`, escalation documented | Don't pay for a bigger model before the calibration replay shows the small one can't carry the rubric                                                         | Plan                                   |
| Package CI placement | Separate **non-required** job                       | A step in `ci` would block production deploys too (`deploy` has `needs: ci`), not just merges                                                                 | Research §finding 4 → Plan             |
| Blocking categories  | Keep all five, scope them in the prompt             | The PR that first adds unsubscribe or data-export is exactly the one that must be blocked, not the one after which we widen the contract                      | Plan                                   |
| PR body input        | Full body capped at `MAX_BODY_CHARS` (4000 chars)   | `implementation correctness` is defined against the description; ~1k tokens against a 250–21,000-token diff, and characters avoid splitting a multi-byte char | Requirements `?? cost tradeoff` → Plan |
| Trigger scope        | No `paths-ignore`                                   | `requirements.md:3` says every PR; the diff pathspec and the empty-diff branch already handle process-only changes                                            | Plan                                   |
| Fork PRs             | Skip silently, document in `AGENTS.md`              | PUBLIC repo withholds secrets and gives a read-only token, so even a "skipped" comment would 403                                                              | Research §7d → Plan                    |

## Scope

**In scope:** six-criterion schema + gate + rubric prompt; determinism settings; markdown renderer; CLI
flags, envelope and size caps; lockfile fallback for the versions input; composite action; label
bootstrap; the repo's first `actionlint`; the review workflow; a non-required package CI job; corrections
to `AGENTS.md` / `README.md`; live verification and a five-PR calibration replay.

**Out of scope:** making anything a required check; `workflow_run` privilege separation;
`pull_request_target` (rejected as unsafe — it would hand fork code the API key); reviewing fork PRs; the
two parked criteria (business alignment, architectural fit); a promptfoo eval harness; a package build
step or `dist/`; any action-version bump.

## Architecture / Approach

```
pull_request → ai-code-review.yml
  consume ai-cr:review → checkout (fetch-depth: 0) → git diff --merge-base ':(exclude)context/**'
  → gh pr view title/body → files
  → .github/actions/ai-code-review  (npm ci in package → tsx CLI → jq)
  → resolve outputs  (passed | failed | empty | error)  ← single source of truth
  → sticky comment (marker-scoped PATCH/POST)  +  verdict label       both if: always()

packages/code-review:  schema(criteria + blockingCategory) → verdict.ts(deriveVerdict/explainVerdict)
                       → render.ts → cli.ts(envelope)
```

The verdict is computed inside the package so it is typed and unit-tested; `jq` only extracts two
top-level strings, so no markdown is ever composed in shell.

## Phases at a Glance

| Phase                              | What it delivers                                                    | Key risk                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Rubric core                     | Schema, gate, rubric prompt, determinism levers                     | Strict-mode rejection of the schema — mitigated by the enum encoding, a JSON-Schema snapshot test, and one live call closing the phase |
| 2. CLI surface                     | Renderer, argv, envelope, size caps, lockfile fallback              | The versions input degrading silently to `[]` in CI, re-opening version hallucination                                                  |
| 3. Action + labels + actionlint    | Composite action, label bootstrap, smoke workflow, first YAML check | Composite-action manifest gotchas; the `.gitignore` `10x-` prefix trap making a file silently untracked                                |
| 4. Workflow + package job + docs   | The review workflow, a non-required package job, doc corrections    | A broken package can now reach `master`, since nothing requires the job                                                                |
| 5. Live verification + calibration | Run URLs per risk row; five-PR replay vs the hand-scored baseline   | Haiku not carrying six anchored criteria — answer is a one-line `OPENROUTER_MODEL` change                                              |

**Prerequisites:** local `.env` with `OPENROUTER_API_KEY` (Phase 1); local `actionlint` (Phase 3);
`OPENROUTER_API_KEY` as a **repo secret** (confirmed absent — needed before Phase 3). One
`workflow_dispatch` run of the label bootstrap before Phase 4.
**Estimated effort:** ~4–5 sessions across 5 phases; Phase 5 is calendar-bound by live PR runs.

## Open Risks & Assumptions

- The five-PR calibration is the only eval signal; a systematic divergence means escalating the model, and
  the plan budgets for that answer rather than treating it as failure.
- Dropping `paths-ignore` means markdown-only PRs now cost a review — a new line item to watch in Phase 5.
- Fork-PR and Dependabot skipping cannot be self-tested; they are verified by reading the `if:`, not a run.
- `seed` is set for self-documentation only — Anthropic models expose no sampling seed, so no replay story
  may be built on it.
- Carried-forward debt: `allowImportingTsExtensions` bakes `.ts` specifiers into every import, so bundling
  a `dist/` into the action later requires a package-wide rewrite first.

## Success Criteria (Summary)

- Opening a PR with a deliberate defect produces `ai-cr:failed` with the defect named and every fired gate
  condition traceable to a numbered rule; pushing the fix flips the label and rewrites the same comment.
- A PR that cannot be reviewed gets an explanatory comment and no verdict label — never a stale `passed`.
- The two chore PRs in the calibration corpus score `test / risk coverage` as `n/a` and pass, and a repeat
  run reproduces identical scores.
