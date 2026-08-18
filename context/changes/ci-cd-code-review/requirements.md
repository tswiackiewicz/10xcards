## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff, with `context/**` excluded

  Process artifacts (`change.md`, `plan.md`, `plan-brief.md`, `reviews/*`) routinely
  outweigh the code they describe — the dry-run's `chore(ci)` PR was 3 lines of code
  against 230 lines of plan markdown, which inflated its `documentation` score to a
  10 the code had not earned. Excluding `context/**` scores the change, not the
  paperwork shipped alongside it, and cuts input cost at the same time.

- installed dependency versions, as ground truth

  The reviewer must never judge whether a version, package, action or model id
  exists, is current, or looks plausible — its training data is older than the
  ecosystem, so such claims are guesses that read as findings. The dry-run diffs
  carried `actions/checkout@v7`, `actions/setup-node@v6`, `@types/node@^26` and
  `eslint@^10`; a model with an earlier cutoff will flag all four as nonexistent and
  sink `implementation correctness` on every chore PR. Two-part fix, mirroring what
  `packages/code-review/src/index.ts` already does: pass the resolved versions in
  the prompt, and instruct the model to say nothing about versions absent from that
  list.

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

A list of criterias:

1. **implementation correctness** — does the code actually do what the PR title
   and description claim, without breaking existing behavior?
   - 1: the change does not deliver what it claims, or introduces an obvious
     defect (wrong logic, broken contract, unhandled failure path on a
     realistic input).
   - 5: the happy path works as claimed, but an edge case, error path or
     concurrent/retry scenario is left unhandled.
   - 10: the stated intent is fully delivered, edge cases and error paths are
     handled, and no existing behavior is silently changed.

2. **idiomaticity** — does the code look like the rest of this repository and
   the conventions of its language/framework?
   - 1: fights the codebase — foreign patterns, ad-hoc style, reinvented
     helpers that already exist, conventions from a different stack.
   - 5: broadly conventional, with local deviations a maintainer would flag in
     review (naming, error handling, a helper duplicated instead of reused).
   - 10: indistinguishable from surrounding code — same naming, structure,
     error handling and idioms a maintainer would have used.

3. **complexity** — is the solution the simplest one that solves the stated
   problem?
   - 1: overengineered or unnecessarily convoluted — speculative abstraction,
     dead configurability, deep nesting, logic that needs a diagram to follow.
   - 5: solves the problem, but carries avoidable weight — an abstraction with
     one caller, a parameter nobody passes, a function that wants splitting.
   - 10: minimal and direct — every construct earns its place, and a reviewer
     understands the change on the first read.

4. **test / risk coverage** — are the risks introduced by this change covered
   by tests proportional to their impact?
   - 1: risky behavior ships untested, or tests are present but vacuous
     (assert nothing, mock the thing under test, weakened to pass).
   - 5: the happy path is tested, but the failure modes that actually motivated
     the change are not.
   - 10: the change's real failure modes are covered by tests that would fail
     if the behavior regressed, and low-risk code is not over-tested.

5. **documentation** — is the non-obvious part of the change explained where a
   future reader will look for it?
   - 1: unexplained magic — no rationale for a non-obvious decision, stale or
     misleading comments/docs, public API or config left undocumented.
   - 5: the code is self-explanatory as far as it goes, but one non-obvious
     decision is left unexplained, or a doc is technically correct yet stale
     in tone/detail.
   - 10: the _why_ is captured at the right altitude (comment, docstring,
     README/ADR), and existing docs are updated to match the change.

6. **security and safety** — does the change avoid introducing security or data
   handling regressions?
   - 1: introduces a concrete exposure — unvalidated input reaching a sink,
     leaked secret or PII, missing authz check, unsafe default.
   - 5: no exploitable path found, but the change relies on an implicit
     assumption — validation happening upstream, a trusted caller, a log line
     that could grow to carry personal data.
   - 10: inputs validated at the boundary, secrets and personal data handled
     correctly, permissions and failure modes fail closed.

### Not applicable

A criterion that the diff genuinely cannot exercise is scored `n/a`, not a
number, and is excluded from the pass/fail gate below. `n/a` requires a one-line
justification in the summary — it is an escape hatch, not a way to dodge a hard
score.

This rule carries more weight than it looks: in the dry-run, both `chore` PRs
passed **only** because `test / risk coverage` was `n/a`. Scored as a 3 — the
natural reflex when a diff contains no tests — a ten-line toolchain bump trips
the "≤ 3" rule and fails. So the cases below are `n/a` by default, not by
judgment:

- **`test / risk coverage`** on a change whose verification _is_ the pipeline
  run — CI/workflow config, action version bumps, toolchain and lockfile
  updates, lint suppressions, formatting. Nothing here is unit-testable; a green
  run on the changed config is the test. Also `n/a` for docs-only changes.
- **`documentation`** on a change with no non-obvious decision to explain — a
  mechanical rename, a version bump, a formatting pass.
- **`security and safety`** on a diff with no trust boundary in it. Note this is
  narrower than it sounds: a workflow file holding deploy secrets, a dependency
  bump, and anything touching auth, RLS or personal data all stay in scope.

Missing tests are only a _low score_ when the diff contains logic that could
have been tested and wasn't.

## Pass / fail gate

The label is derived mechanically from the scores — the model reports numbers,
the workflow decides. `ai-cr:failed` when **any** of these holds:

- `implementation correctness` ≤ 5 **or** `security and safety` ≤ 5 — blocking
  dimensions: a merged defect or exposure costs far more than a re-review, so
  they fail on "unproven", not just on "bad".
- any other criterion ≤ 3 — one clearly bad dimension is enough.
- three or more criteria ≤ 5 — death by a thousand cuts; individually
  tolerable, collectively not review-ready.
- a concrete finding in a **named blocking category**, whatever the scores say
  (see below).

Otherwise `ai-cr:passed`.

Rationale for the asymmetry: a false `failed` costs one `ai-cr:review` retry, a
false `passed` costs a bug in `master`. Start strict; loosen the ≤ 5 blocking
threshold to ≤ 4 if the gate turns out noisy in practice.

### Named blocking categories

Score thresholds alone let a real compliance risk through. The dry-run's
account-deletion PR is the worked example: its pre-fix state returned `200` from
the purge route even when a user's hard-delete failed, silently retaining that
account past the promised 30-day window. A recorded review caught it as a
warning; the numeric gate would have scored `security and safety` a 6 and
labelled the PR `passed`.

So a **concrete, located finding** in any of these categories fails the PR
regardless of the six scores:

- personal-data retention, deletion or export not doing what it claims (GDPR)
- a missing or bypassable authorization / ownership check
- a secret, credential or personal datum reaching a log, an error body, a URL or
  a third-party service
- a destructive or irreversible operation whose failure is not surfaced to an
  operator
- consent, suppression or unsubscribe handling that can silently drop a record

"Concrete and located" is the bar — a file and line, and a sentence naming what
goes wrong. A general unease about a category is a low score, not a block.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
