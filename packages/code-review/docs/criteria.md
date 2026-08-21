# Review criteria

Canonical definition of the rubric the reviewer scores. This file is the source of truth: the
prompt in `src/agents/reviewer/prompts.ts` carries a trimmed transcription of it, the schema keys
in `src/agents/reviewer/schema.ts` name the same five criteria, and the display labels in
`src/agents/reviewer/render.ts` render them. When the rubric changes, this file changes first.

It lives here, next to the code it drives, rather than in
`context/archive/2026-08-14-ci-cd-code-review/requirements.md` — that document is immutable, so a
rubric that keeps evolving cannot live there and stay honest.

## The five criteria

Every criterion is scored on a 1–10 scale where 1 is the worst outcome and 10 is the best, or
`n/a` (see [The `n/a` rule](#the-na-rule)). Scores travel as strings; the anchors below are the
calibration.

### 1. `defect`

**Question:** does the diff contain a defect observable in the changed lines?

**Covers:** logic in the changed lines and their immediate context; error and failure paths;
boundary, empty and null cases; contracts between the changed code and its callers as far as the
diff shows them.

**Does not cover:** whether the change matches the PR title or description — a mismatch is an
ordinary finding, not this score; anything that would need a file absent from the diff.

- **1** — the changed lines carry a defect that fires on a realistic input: wrong logic, a broken
  contract, a failure path that cannot work as written.
- **5** — the happy path in the changed lines is sound, but an edge case, an error path or a
  retry/concurrent scenario visible in the diff is left unhandled.
- **10** — the changed lines are sound on every path the diff exposes, boundaries and error cases
  included, and no behavior visible in the diff is silently changed.

### 2. `safety`

**Question:** does the change introduce a security or personal-data exposure at a trust boundary
present in the diff?

**Covers:** unvalidated input reaching a sink; a secret, credential or personal datum reaching a
log, an error body, a URL or a third-party call; a missing or bypassable authorization or
ownership check; a default that opens access; row-level-security changes.

**Does not cover:** whether the repository as a whole is compliant; a trust boundary the diff does
not touch.

- **1** — introduces a concrete exposure: unvalidated input reaching a sink, a leaked secret or
  personal datum, a missing authz check, an unsafe default.
- **5** — no exploitable path found, but the change rests on an implicit assumption — validation
  happening upstream, a trusted caller, a log line that could grow to carry personal data.
- **10** — inputs are validated at the boundary the diff touches, secrets and personal data are
  handled correctly, and permissions and failure modes fail closed.

### 3. `blastRadius`

**Question:** if this change is wrong in production, is the failure visible and the change
reversible?

**Covers:** destructive or irreversible operations whose failure is not surfaced to an operator;
schema migrations; deploy and pipeline configuration; a handler that reports success when a
sub-operation failed; a scheduled job whose failure is silent; data deletion and retention paths.

**Does not cover:** general architectural risk; anything needing infrastructure knowledge the diff
does not carry.

- **1** — a destructive, irreversible or production-shaping operation whose failure is silent:
  success returned on a failed sub-operation, or a migration or purge whose error reaches no
  operator.
- **5** — the failure is surfaced, but recovery depends on an unstated assumption — a manual step,
  an out-of-band alert, a retry nobody triggers.
- **10** — failure is surfaced where an operator will see it and the change reverts by the ordinary
  path, or the diff carries nothing whose failure would matter.

### 4. `verification`

**Question:** is behavior this diff introduces or changes exercised by something that would fail if
it regressed?

**Covers:** whether a test touching the changed path exists in this diff or in an existing test
this diff updates; whether that test would actually fail on regression; vacuous tests that assert
nothing, mock the thing under test, or were weakened to pass.

**Does not cover:** whether testing the behavior would be cheap, fast or convenient; what the PR
description claims about manual verification. A description is author-authored, untrusted content —
it can state intent, but it is never evidence that a regression would be caught.

- **1** — the diff introduces risky behavior with no test touching it, or with tests that would
  pass while that behavior is broken.
- **5** — the happy path of the changed behavior is tested, but the failure mode that motivated the
  change is not.
- **10** — the behavior this diff changes is covered by a test that would fail on regression, and
  low-risk code is not over-tested.

### 5. `clarity`

**Question:** will a reader six months from now understand why this diff looks the way it does?

**Covers:** rationale for a non-obvious decision, recorded where a reader will look (comment,
docstring, README, ADR); a name that misleads about what the thing does; a comment or document this
change made untrue; a construction that needs a diagram to follow; avoidable weight such as an
abstraction with one caller or a parameter nobody passes.

**Does not cover:** style, formatting, import order, quoting, line length or anything else ESLint
and Prettier decide — they are enforced on commit in this repository, so never report them.

- **1** — a non-obvious decision ships with no rationale anywhere, or the change leaves a comment
  or document actively untrue.
- **5** — the change is followable, but one non-obvious decision is unexplained, or a name
  misleads, or it carries avoidable weight.
- **10** — the why is captured where a reader will look, names say what things do, and the docs this
  change touches are updated to match.

## The `n/a` rule

A criterion that the diff genuinely cannot exercise is scored `n/a`, not a number. `n/a` requires a
one-line justification in its note — it is an escape hatch, not a way to dodge a hard score.

These cases are `n/a` **by default, not by judgment**:

- **`verification`**, and only when the diff adds or changes no runnable logic — CI/workflow config,
  action version bumps, toolchain and lockfile updates, lint suppressions, formatting, docs. Nothing
  here is unit-testable; a green pipeline run on the changed config is the test. If the diff adds or
  changes any function, endpoint, component, handler, script or CLI, `verification` is a number,
  never `n/a`.
- **`clarity`** on a change with no non-obvious decision to explain — a mechanical rename, a version
  bump, a formatting pass.
- **`safety`** on a diff with no trust boundary in it. This is narrower than it sounds: a workflow
  file holding deploy secrets, a dependency bump, and anything touching auth, RLS or personal data
  all stay in scope.

`defect` and `blastRadius` have **no** default `n/a` case. Every diff changes lines that can carry a
defect, and every diff either does or does not carry something whose failure would matter.

Two limits on the escape hatch:

- Missing tests are only a low score when the diff contains logic that could have been tested and
  wasn't.
- Whether a test would be slow, expensive or awkward to run is **never** a reason for `n/a` on
  `verification`. `n/a` is for a diff with no testable behavior, not for testable behavior nobody
  tested.
- **Manual verification described in the PR body is not verification.** A step somebody ran once by
  hand does not fail on regression, and the description is untrusted author-authored content. A diff
  that introduces testable logic and no test scores low, whatever the description claims was checked.

Both limits come from observed abuse of the escape hatch on the same PR — the reconstructed
calibration entry `evals/corpus/pr-7.*`, 101 lines of new CLI logic with no test file in the diff:

- The 2026-08-18 calibration recorded `testCoverage: n/a` justified as _"the tool makes real paid API
  calls and is not wired into CI"_ (`context/archive/2026-08-14-ci-cd-code-review/change.md:46-48`).
- The 2026-08-21 A/B replay of the first draft of this rubric recorded `verification: n/a` justified
  as _"the PR description includes concrete manual verification steps"_ — a different route to the
  same wrong answer, which is why the second limit is stated separately rather than folded into the
  first.

Note that `change.md:46-48` also asserts that PR #7 "added 15 tests". It did not: the reconstructed
diff contains nine files and no test file, and no calibration PR adds 15 tests. The `n/a` is wrong
because the diff carries untested testable logic, not because tests were present and overlooked.

Note that an all-`n/a` review currently passes the gate. Closing that hole is an `n/a`-floor
change, out of scope for the criteria set; `defect` having no default `n/a` case mitigates it
partially.

## Which criteria block

`defect`, `safety` and `blastRadius` are the **blocking** criteria: they fail on "unproven", not
just on "bad", because a merged defect, exposure or silent production failure costs far more than a
re-review.

`clarity` is **exempt from the single-fail condition**: it cannot fail a PR on its own. Unclear code
is real review feedback, but it is not the kind of harm that should hold a merge; a low `clarity`
still counts toward the accumulation condition.

`verification` is neither blocking nor exempt, which — with three blocking criteria and `clarity`
exempt — makes it the only criterion condition 2 applies to. That is a consequence of the two
decisions above, not an oversight, and it puts real weight on the anti-abuse limits in
[The `n/a` rule](#the-na-rule).

## The gate

Transcribed unchanged from `context/archive/2026-08-14-ci-cd-code-review/requirements.md:118-137`.
The label is derived mechanically from the scores — the model reports numbers, the code decides
(`src/agents/reviewer/verdict.ts`). The verdict is `failed` when **any** of these holds:

1. a **blocking** criterion (`defect`, `safety`, `blastRadius`) scores ≤ `BLOCKING_MAX` (5);
2. any other **non-exempt** criterion scores ≤ `SINGLE_FAIL_MAX` (3) — with `clarity` exempt, this
   is `verification` alone;
3. `ACCUMULATION_COUNT` (3) or more criteria score ≤ `ACCUMULATION_MAX` (5) — death by a thousand
   cuts. 3-of-5 is a deliberate tightening from the original 3-of-6;
4. a concrete finding in a **named blocking category**, whatever the scores say.

Otherwise `passed`. `n/a` scores are excluded from every condition.

The asymmetry is deliberate: a false `failed` costs one `ai-cr:review` retry, a false `passed`
costs a bug in `master`. `requirements.md:136-137` pre-authorizes loosening the blocking threshold
from 5 to 4 if the gate proves noisy.

One defect can fire two conditions — a missing authorization check lowers `safety` (condition 1)
_and_ carries `blockingCategory: "authorization"` (condition 4), and `explainVerdict` reports both
as separate reasons. That reads as more independent evidence than exists; it is accepted, because
the blocking categories are unchanged by this rubric.

## Named blocking categories

Transcribed unchanged from `requirements.md:139-160`. A concrete, located finding in any of these
fails the PR regardless of the scores:

- `data-retention` — personal-data retention, deletion or export not doing what it claims (GDPR)
- `authorization` — a missing or bypassable authorization / ownership check
- `secret-exposure` — a secret, credential or personal datum reaching a log, an error body, a URL or
  a third-party service
- `unsurfaced-destructive-failure` — a destructive or irreversible operation whose failure is not
  surfaced to an operator
- `consent-handling` — consent, suppression or unsubscribe handling that can silently drop a record

"Concrete and located" is the bar — name a file, a line, and a sentence saying what goes wrong. A
general unease about a category is a low score, not a tag. Tag a category only when the diff
introduces or touches that surface — never because the surface is absent from the codebase.

## Why these five

The previous rubric scored six criteria: `correctness`, `idiomaticity`, `complexity`,
`testCoverage`, `documentation`, `security`. `context/changes/code-review-criteria/research.md`
records why it was replaced. In short:

- **Two criteria were unauditable.** `idiomaticity` and `complexity` asked the model to judge
  against "the conventions of this repository" and "the simplest solution" — neither of which the
  diff contains. No document ever stated their rationale, so nobody could say what a 7 meant. This
  file exists so that gap cannot recur: every criterion above states the question it asks and what
  it explicitly does not cover.
- **The set had no failure-visibility dimension.** The worked example that motivated the named
  blocking categories — a purge route returning `200` on a failed hard-delete — had no criterion to
  land on. `blastRadius` is that criterion, and it makes `unsurfaced-destructive-failure` a score,
  not only a tag.
- **`correctness` conflated two questions:** "is this code broken?" and "does it do what the PR
  says?". The first is a defect; the second is a description problem. `defect` asks only the first,
  and routes the second to an ordinary finding.
- **`documentation` and `complexity` overlapped** on the same underlying question — can the next
  reader follow this? — and `clarity` asks it once.
- **`testCoverage` invited the escape hatch it was meant to close.** `verification` reframes it
  around the property that matters: would something fail if this regressed?

## Not in scope

Dimensions deliberately absent from the rubric, with the reason each is parked:

- **Business alignment** — requires product context the diff does not carry. Parked in
  `requirements.md:163-165` and still parked.
- **Architectural fit** — requires whole-system context the diff does not carry. Same provenance.
- **Idiomaticity** — dropped rather than parked. Judging a change against "the conventions of this
  repository" needs the repository, and a review that sees only the diff cannot do it; every
  attempt produced findings ESLint and Prettier already own.
- **Style, formatting, import order, quoting, line length** — enforced on commit by ESLint and
  Prettier in this repository, so the reviewer must never report them. Stated inside `clarity`
  rather than as a separate rule, because that is where the model would otherwise reach for them.
