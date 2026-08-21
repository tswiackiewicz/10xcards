# Code Review Criteria Swap — Plan Brief

> Full plan: `context/changes/code-review-criteria/plan.md`
> Research: `context/changes/code-review-criteria/research.md`

## What & Why

Replace the six scored criteria in `packages/code-review` with five, keeping the flow, the
architecture and the scoring mechanics untouched. The research found that three of the six
(`idiomaticity`, `complexity`, `documentation`) never moved the verdict except through the
accumulation rule, and that two of them have no recorded design rationale at all — while the
one failure mode that actually reached production, a purge route returning `200` on a failed
hard delete, had no criterion covering it. The swap trades three near-constant dimensions for
one real one (`blastRadius`) and folds the rest into a single `clarity` dimension.

## Starting Point

The rubric is a static template literal at `src/agents/reviewer/prompts.ts:19-51`, a verbatim
transcription of `context/archive/2026-08-14-ci-cd-code-review/requirements.md:36-91` — zero
drift. Its facets are spread across four files (prompt, schema keys, blocking list, display
labels) with no single source of truth; consistency is held by ~40 assertions across seven test
files. The recorded calibration shows the scale collapsing: 23 of 27 scored cells landed on 9
or 10, and `idiomaticity`, `complexity` and `security` each used two of eleven legal values.

## Desired End State

The reviewer scores `defect`, `safety`, `blastRadius`, `verification` and `clarity` on the same
1–10 + `n/a` scale, through the same four-condition gate, with the same five blocking
categories and the same advisory label. Three criteria block at ≤5; `clarity` cannot fail a PR
on its own. The rubric's canonical text lives in `packages/code-review/docs/criteria.md`
alongside the code it drives, and the five calibration PRs are persisted as a corpus so this
rubric change — and every later one — can be regression-checked.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Criteria set | 5: defect, safety, blastRadius, verification, clarity | Three old dimensions never moved the verdict; the one that mattered was missing. | Research |
| `defect` ↔ PR description | Link broken | "Does the code match the description" is the worst-measured criterion in the literature and fails toward false accusation. | Plan |
| Blocking dimensions | 3 (defect, safety, blastRadius) | Leaving `blastRadius` off recreates the exact hole that let the purge-route defect pass. | Plan |
| `clarity` in the gate | Cannot fail alone | Blocking on polish is the mode that makes authors stop reading review comments. | Plan |
| `ACCUMULATION_COUNT` | Stays 3 (now 3-of-5) | Deliberate tightening, consistent with "a false failed costs one retry". | Plan |
| Default `n/a` cases | verification, clarity, safety | Mirrors today's three; `defect` gets no escape hatch. | Plan |
| Canonical spec location | `packages/code-review/docs/criteria.md` | `context/archive/**` is immutable, so every source comment pointing there would rot. | Plan |
| Scale, gate, categories | Unchanged | Explicit constraint: only the criteria change. | Plan |
| Verification method | A/B replay on the five calibration PRs | The corpus turned out to be reconstructible byte-for-byte, so a real comparison is possible. | Plan |
| Eval sweep | In scope, final phase | Clears the two stale numbers from the last impl-review and sets a new baseline. | Plan |

## Scope

**In scope:** rubric prose and anchors; `n/a` default cases; schema keys and descriptions; the
blocking-criteria list plus a `clarity` exemption for condition 2; PR-comment labels; seven test
files; a new canonical spec doc; a persisted calibration corpus and a documented replay procedure; one paid
eval sweep.

**Out of scope:** the 1–10 scale; the four gate conditions and their thresholds; the five
blocking categories and the "concrete and located" bar; the prompt's block structure;
separating the finding's claim from its suggested fix; an `n/a` floor; the workflow, composite
action, `context/**` exclusion, version ground truth, model default and label mapping;
un-parking business alignment or architectural fit.

## Architecture / Approach

Nothing structural moves. `schema.ts` stays the type root — `Criterion` is
`keyof Review["criteria"]` — so editing it red-lines `verdict.ts` and `render.ts` at once;
Phases 1 and 2 therefore land as one commit. Spec first, so the prompt is a transcription of a
reviewed document rather than the reverse. Then tests, read assertion by assertion. Then
measurement against a corpus reconstructed from merge commits.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Spec and rubric | `docs/criteria.md`, new prompt rubric and `n/a` block, five schema keys | The criterion prose *is* the product; a vague "does not cover" clause reintroduces the failure it was written to stop |
| 2. Gate wiring and rendering | Three blocking criteria, `clarity` exemption, new labels | Condition 2 degenerates to a single subject (`verification`) |
| 3. Tests | Seven files green, gate table rebuilt | Mass-renaming keys instead of re-reading each pinned assertion |
| 4. A/B replay | Persisted corpus + verdict comparison vs the hand-scored baseline | PR #7 scoring `verification: n/a` again would mean the fix did not take |
| 5. Eval sweep | New three-model baseline, stale numbers cleared | Spends real money on a sweep whose main discriminator is already known broken |

**Prerequisites:** `OPENROUTER_API_KEY` for Phases 4–5; `gh` authenticated for corpus metadata;
the un-committed edit to `evals/fixtures/react19-migration.diff` resolved before Phase 5.
**Estimated effort:** ~2–3 sessions. Phases 1–3 are one session; Phase 4 is the largest single
piece of work; Phase 5 is one command plus a recorded judgment.

## Open Risks & Assumptions

- **The scale is untouched, and the research says the scale is the primary problem.** 85% of
  recorded scores landed on {9,10}, and the head-to-head literature puts 1–10 last among common
  scales. The realistic gain here is better *area coverage* and a shorter prompt, not better
  score resolution. Accepted by explicit instruction; recorded so it is not later read as an
  oversight.
- **Condition 2 has exactly one subject.** With three blocking criteria and `clarity` exempt,
  `verification ≤ 3` is the only non-blocking route to `failed`. That puts unusual weight on the
  anti-`n/a`-abuse sentence in the `verification` text.
- **One defect can still fire two gate conditions.** A dropped authz check lowers `safety` and
  carries a blocking category; `explainVerdict` reports both as independent reasons. Accepted,
  since the categories are unchanged.
- **An all-`n/a` review still passes.** A known hole, out of scope; partially mitigated by
  `defect` having no default `n/a` case.
- **Assumption:** the reconstructed corpus reproduces what the original calibration actually
  sent. The five diff byte-sizes match `change.md:19-25` exactly, but the PR bodies come from
  the GitHub API today and could have been edited since the replay.

## Success Criteria (Summary)

- A PR comment shows five rows whose labels a maintainer reads as questions worth asking, and
  no row reports something ESLint or Prettier already enforces.
- On the five reconstructed calibration PRs, read over at least two runs per rubric, the new
  rubric agrees with the **corrected** hand-scored baseline at least as often as the old one's
  3-of-5, with a per-PR reason recorded — and PR #7 no longer scores verification as `n/a`.
- `docs/criteria.md` answers "why these five" for a reader who was not part of this change.
