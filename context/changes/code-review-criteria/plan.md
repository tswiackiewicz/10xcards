# Code Review Criteria Swap — Implementation Plan

## Overview

Replace the six scored criteria in `packages/code-review` with the five from
`context/changes/code-review-criteria/research.md`. The flow, the architecture and the
scoring mechanics stay exactly as they are: one review call, the eleven-value string score
enum, the four-condition gate with its named thresholds, the five blocking categories, the
`n/a` escape hatch, the advisory posture, and the workflow that maps a verdict to a label.

Only the **set of criteria** changes — their names, their definitions, their 1/5/10 anchors,
which of them block, and which of them default to `n/a`.

## Current State Analysis

The rubric is a static string, not data. Four files each hold one facet of the criteria set,
and none is the source of truth for the others — consistency is held by pinning tests.

| Facet | Location | What changes |
|---|---|---|
| Rubric prose + anchors | `src/agents/reviewer/prompts.ts:19-51` | rewritten |
| `n/a` default cases | `src/agents/reviewer/prompts.ts:54-64` | rewritten |
| Schema keys + descriptions | `src/agents/reviewer/schema.ts:44-49` | 6 keys → 5 |
| Blocking dimension list | `src/agents/reviewer/verdict.ts:24` | 2 → 3 entries |
| Display labels | `src/agents/reviewer/render.ts:8-15` | rewritten |

Seven test files reference the criterion keys and would fail to compile or fail assertions:
`tests/unit/prompts.test.ts`, `verdict.test.ts`, `schema.test.ts`, `render.test.ts`,
`cli.test.ts`, `eval-asserts.test.ts`, `tests/integration/agent.test.ts`.

### Key Discoveries:

- **The eval suite is criterion-agnostic and survives almost untouched.**
  `evals/asserts/verdict.ts:40-50` and `evals/asserts/anchors.ts:44-46` only check that
  `criteria` and `findings` exist on the output; they never name a criterion. The three flaw
  rubrics in `evals/fixtures/react19-migration.flaws.ts:24-84` say *"at least one finding or
  criterion note"*, also without names. The compile-time hits are both in
  `tests/unit/eval-asserts.test.ts`: the criteria literal at `:31-38`, and — independently — the
  cast at `:28` (`as Review["criteria"]["correctness"]`), which a rename of `correctness` breaks
  on its own. Treat `:27-41` as the region to edit.
- **`EXPECTED_VERDICT = "failed"` still holds** (`react19-migration.flaws.ts:90`). The planted
  authz defect is tagged `authorization`, so gate condition 4 fires regardless of which
  criteria exist.
- **The calibration corpus is reconstructible byte-for-byte.** All five calibration PRs are
  merge commits — `d155801` (#1), `1fd7b1e` (#3), `12b612f` (#5), `48fcbd7` (#6), `e276ca0`
  (#7). `git diff --merge-base <merge>^1 <merge>^2 -- . ':(exclude)context/**'` reproduces
  2581 / 10129 / 34831 / 1164 / 82567 bytes, matching the sizes recorded in
  `context/archive/2026-08-14-ci-cd-code-review/change.md:19-25` exactly. Titles and bodies
  come from `gh pr view <n> --json title,body`. This contradicts
  `context/changes/code-review-evals/research.md:177-179` and is what makes Phase 4 possible.
- **`context/archive/**` is immutable** (`AGENTS.md`, "Don't touch"), and every source file
  comment currently points at `requirements.md:NN-NN` line ranges. Those pointers all become
  wrong; the spec needs a new home inside the package.
- **Scores must stay strings.** `schema.ts:3-13` — OpenRouter sends `strict: true`, whose
  JSON-Schema subset excludes `minimum`/`maximum`/`minLength`/`pattern`. Nothing in this plan
  may reintroduce a numeric bound or a `.min(1)`.
- **`note` cannot be required non-empty** for the same reason; `render.ts:23` supplies the
  visible placeholder.

## Desired End State

The reviewer scores five criteria — `defect`, `safety`, `blastRadius`, `verification`,
`clarity` — on the unchanged 1–10 + `n/a` scale. Three of them block at ≤5. `clarity` cannot
fail a PR on its own. The rubric's canonical text lives in `packages/code-review/docs/criteria.md`,
and every source comment points there instead of at the archived requirements. The five
blocking categories, the four gate conditions and their thresholds, the workflow and the
advisory posture are bit-for-bit what they are today.

Verified by: `npm run lint && npm run typecheck && npm test` green from inside the package;
the A/B replay in Phase 4 producing a verdict table for both rubrics on the same five PRs;
and a fresh eval sweep baseline in Phase 5.

## What We're NOT Doing

- **Not changing the score scale.** It stays 1–10 plus `n/a`, eleven string values. The
  research argued the scale is the primary cause of the collapse (85% of recorded scores on
  {9,10}); that argument is out of scope by explicit instruction and is recorded in
  "Open Risks" in the brief instead.
- **Not changing the gate mechanics.** Four conditions, `BLOCKING_MAX = 5`,
  `SINGLE_FAIL_MAX = 3`, `ACCUMULATION_MAX = 5`, `ACCUMULATION_COUNT = 3` all keep their
  values. The only structural edit is a second exemption list so `clarity` sits out of
  condition 2.
- **Not changing the five blocking categories**, their names, or the "concrete and located"
  bar, or the scoping sentence at `prompts.ts:77`.
- **Not touching the prompt's block structure.** Six blocks assembled at `prompts.ts:82-84`
  stay six blocks; no new "what not to flag" block — that guidance goes inside the `clarity`
  criterion text.
- **Not separating the claim from the suggested fix.** The research recommended moving fix
  prescriptions out of `findings[].message` into their own field. That is a schema and
  mechanics change, so it is out of scope here.
- **Not adding an `n/a` floor** (today an all-`n/a` review passes). Out of scope as a
  mechanics change; the `defect` criterion having no default `n/a` case mitigates it partially.
- **Not touching** the workflow, the composite action, the `context/**` diff exclusion, the
  installed-versions ground truth, `MAX_DIFF_BYTES`, `MAX_BODY_CHARS`, the model default, or
  the label mapping.
- **Not un-parking** business alignment or architectural fit.

## Implementation Approach

Write the spec first so the prompt is a transcription of a reviewed document rather than the
other way round — the same discipline the original change used, just with a spec that lives
next to the code. Then swap the criteria set in one sweep across the four source files
(Phases 1–2), because the arity change from six keys to five breaks `Record<Criterion, …>` in
`render.ts` and the `satisfies readonly Criterion[]` in `verdict.ts` the moment `schema.ts`
changes — there is no green intermediate state. Then bring the seven test files back, reading
every pinned assertion rather than mass-replacing names. Then measure, on the corpus that
turns out to be reconstructible.

## Critical Implementation Details

**Ordering.** `schema.ts` is the type root: `Criterion` is `keyof Review["criteria"]`. Editing
it red-lines `verdict.ts:24` and `render.ts:8-15` immediately. Phases 1 and 2 therefore land
as one commit; the plan splits them only so the criteria prose and the gate wiring get
separate review attention.

**Condition 2 degenerates to a single criterion.** With three blocking criteria and `clarity`
exempt, condition 2 (`≤ SINGLE_FAIL_MAX`) applies to `verification` alone. This is a direct
consequence of two accepted decisions, not an oversight — but it means a `verification` score
of 3 is the only non-blocking path to `failed`, so the anti-`n/a`-abuse sentence in that
criterion's text is doing more work than it looks.

**One defect can still fire two conditions.** A missing authorization check lowers `safety`
(condition 1) and carries `blockingCategory: "authorization"` (condition 4), and
`explainVerdict` reports both as separate reasons — reading as more independent evidence than
exists. Accepted deliberately (blocking categories stay unchanged); worth knowing when reading
a `failed` comment.

---

## Phase 1: Spec and rubric

### Overview

Establish `docs/criteria.md` as the canonical definition of the five criteria, then transcribe
it into the prompt and the schema.

### Changes Required:

#### 1. Canonical criteria spec

**File**: `packages/code-review/docs/criteria.md` (new)

**Intent**: Give the rubric a home that versions with the code it drives, replacing the
pointers into the immutable `context/archive/2026-08-14-ci-cd-code-review/requirements.md`.
It must record not just the five criteria but *why* these five — the gap that made
`idiomaticity` and `complexity` unauditable was that no document ever stated their rationale.

**Contract**: Sections, in this order — the five criteria (each with: the question it asks,
the areas it covers, what it explicitly does **not** cover, and its 1/5/10 anchors); the
`n/a` rule and its default cases; which criteria block and why; the four gate conditions and
their thresholds (transcribed, unchanged); the five blocking categories (transcribed,
unchanged); a "Why these five" section citing `research.md`; and a "Not in scope" section
naming the parked dimensions (business alignment, architectural fit, idiomaticity) with the
reason each is parked.

The five criteria below are the **spec form**. `docs/criteria.md` carries them in full; the
prompt carries a trimmed form (see §2) — the `Covers:` enumerations largely restate the anchors,
and shipping them twice costs input tokens on every review for no added signal:

```
1. defect — does the diff contain a defect observable in the changed lines?
   Covers: logic in the changed lines and their immediate context; error and failure paths;
   boundary, empty and null cases; contracts between the changed code and its callers as far
   as the diff shows them.
   Does not cover: whether the change matches the PR title or description — a mismatch is an
   ordinary finding, not this score; anything that would need a file absent from the diff.
   - 1: the changed lines carry a defect that fires on a realistic input — wrong logic, a
     broken contract, a failure path that cannot work as written.
   - 5: the happy path in the changed lines is sound, but an edge case, an error path or a
     retry/concurrent scenario visible in the diff is left unhandled.
   - 10: the changed lines are sound on every path the diff exposes, boundaries and error
     cases included, and no behavior visible in the diff is silently changed.

2. safety — does the change introduce a security or personal-data exposure at a trust
   boundary present in the diff?
   Covers: unvalidated input reaching a sink; a secret, credential or personal datum reaching
   a log, an error body, a URL or a third-party call; a missing or bypassable authorization or
   ownership check; a default that opens access; row-level-security changes.
   Does not cover: whether the repository as a whole is compliant; a trust boundary the diff
   does not touch.
   - 1: introduces a concrete exposure — unvalidated input reaching a sink, a leaked secret or
     personal datum, a missing authz check, an unsafe default.
   - 5: no exploitable path found, but the change rests on an implicit assumption —
     validation happening upstream, a trusted caller, a log line that could grow to carry
     personal data.
   - 10: inputs are validated at the boundary the diff touches, secrets and personal data are
     handled correctly, and permissions and failure modes fail closed.

3. blast radius — if this change is wrong in production, is the failure visible and the change
   reversible?
   Covers: destructive or irreversible operations whose failure is not surfaced to an
   operator; schema migrations; deploy and pipeline configuration; a handler that reports
   success when a sub-operation failed; a scheduled job whose failure is silent; data
   deletion and retention paths.
   Does not cover: general architectural risk; anything needing infrastructure knowledge the
   diff does not carry.
   - 1: a destructive, irreversible or production-shaping operation whose failure is silent —
     success returned on a failed sub-operation, or a migration or purge whose error reaches
     no operator.
   - 5: the failure is surfaced, but recovery depends on an unstated assumption — a manual
     step, an out-of-band alert, a retry nobody triggers.
   - 10: failure is surfaced where an operator will see it and the change reverts by the
     ordinary path — or the diff carries nothing whose failure would matter.

4. verification — is behavior this diff introduces or changes exercised by something that
   would fail if it regressed?
   Covers: whether a test touching the changed path exists in this diff or in an existing test
   this diff updates; whether that test would actually fail on regression; vacuous tests that
   assert nothing, mock the thing under test, or were weakened to pass.
   Does not cover: whether testing the behavior would be cheap, fast or convenient.
   - 1: the diff introduces risky behavior with no test touching it, or with tests that would
     pass while that behavior is broken.
   - 5: the happy path of the changed behavior is tested, but the failure mode that motivated
     the change is not.
   - 10: the behavior this diff changes is covered by a test that would fail on regression,
     and low-risk code is not over-tested.

5. clarity — will a reader six months from now understand why this diff looks the way it does?
   Covers: rationale for a non-obvious decision, recorded where a reader will look (comment,
   docstring, README, ADR); a name that misleads about what the thing does; a comment or
   document this change made untrue; a construction that needs a diagram to follow; avoidable
   weight such as an abstraction with one caller or a parameter nobody passes.
   Does not cover: style, formatting, import order, quoting, line length or anything else
   ESLint and Prettier decide — they are enforced on commit in this repository, so never
   report them.
   - 1: a non-obvious decision ships with no rationale anywhere, or the change leaves a
     comment or document actively untrue.
   - 5: the change is followable, but one non-obvious decision is unexplained, or a name
     misleads, or it carries avoidable weight.
   - 10: the why is captured where a reader will look, names say what things do, and the docs
     this change touches are updated to match.
```

#### 2. Prompt rubric

**File**: `packages/code-review/src/agents/reviewer/prompts.ts`

**Intent**: Replace the six-criterion block with the five above, and rewrite the `n/a` block
for the new set. The doc comments currently citing `requirements.md:36-91` and
`requirements.md:93-117` must point at `docs/criteria.md` instead.

**Contract**: `const criteria` (`:19-51`) carries, per criterion, **the definition line and the
three anchors only** — not the `Covers:` enumerations, which live in `docs/criteria.md`. Three
negative clauses are load-bearing and do travel into the prompt, appended to their criterion's
definition line:

- `defect` — "a mismatch with what the PR title or description claims is an ordinary finding,
  not this score"
- `clarity` — "never report style, formatting, import order, quoting or line length; ESLint and
  Prettier decide those and are enforced on commit"
- `verification` — its clause is already going into the `n/a` block below, so nothing extra here

Budget: the resulting block must be **at or below today's 3,323 characters**. Five criteria in
today's shape is ~4/6 of today's content, so the three clauses fit with room to spare; if the
block exceeds the budget, the `Covers:` text has leaked back in.

The block still ends with the key-mapping sentence, updated to
`The schema keys map to the criteria in this order: defect, safety, blastRadius, verification, clarity.`
`const notApplicable` (`:54-64`) keeps its opening rule verbatim and replaces the three default
cases with these three, plus one added sentence:

```
- verification on a change whose verification is the pipeline run — CI/workflow config,
  action version bumps, toolchain and lockfile updates, lint suppressions, formatting.
  Nothing here is unit-testable; a green run on the changed config is the test. Also "n/a"
  for docs-only changes.
- clarity on a change with no non-obvious decision to explain — a mechanical rename, a
  version bump, a formatting pass.
- safety on a diff with no trust boundary in it. Note this is narrower than it sounds: a
  workflow file holding deploy secrets, a dependency bump, and anything touching auth, RLS or
  personal data all stay in scope.

Missing tests are only a low score when the diff contains logic that could have been tested
and wasn't. Whether a test would be slow, expensive or awkward to run is never a reason for
"n/a" on verification — "n/a" is for a diff with no testable behavior, not for testable
behavior nobody tested.
```

`defect` and `blastRadius` get no default `n/a` case. The `scale`, `conduct`,
`blockingCategories` and `untrustedMetadata` blocks and the `reviewInstructions` assembly at
`:82-84` are untouched.

The final sentence of the `notApplicable` block is the direct fix for the sharpest defect in
the calibration record — `testCoverage: n/a` justified as *"the tool makes real paid API calls
and is not wired into CI"* on a PR that added 15 tests
(`context/archive/2026-08-14-ci-cd-code-review/change.md:46-48`).

#### 3. Schema keys

**File**: `packages/code-review/src/agents/reviewer/schema.ts`

**Intent**: Rename the five criterion keys and rewrite their one-line `describe()` text, which
is what the model sees in the JSON Schema.

**Contract**: `reviewSchema.criteria` (`:43-50`) becomes exactly five keys in rubric order —
`defect`, `safety`, `blastRadius`, `verification`, `clarity` — each still built by the
`criterion(description)` helper. `SCORE_VALUES`, `BLOCKING_CATEGORIES`, the `findings` shape,
the `note` field without `.min(1)`, and the exported `Review` / `Criterion` /
`BlockingCategory` types keep their current definitions. Nothing may add a JSON-Schema keyword
outside the strict subset.

### Success Criteria:

#### Automated Verification:

- `docs/criteria.md` exists and contains all five criterion names and fifteen anchors
- The prompt's `criteria` block is at or below 3,323 characters, and contains none of the
  `Covers:` enumeration text
- The three criteria-specific citations now point at `docs/criteria.md`: `prompts.ts:18`
  (was `requirements.md:36-91`), `prompts.ts:53` (was `:93-117`), `render.ts:7` (label names)
- The seven citations to the **unchanged** gate and blocking-category spec are untouched:
  `verdict.ts:11`, `:12`, `:58`, `:83` and `prompts.ts:66`. `context/archive/**` is immutable,
  so those line ranges still resolve and are the provenance for thresholds this change must not
  touch — driving the `requirements.md` count to zero would delete correct information
- Prettier is clean on the new doc: `npx prettier --check docs/criteria.md` from inside the
  package. Note there is **no** `format` script here — `package.json` has only `start`, `dev`,
  `test`, `eval`, `typecheck`, `lint`, `lint:fix`, and `eslint .` does not lint `.md`. Root
  lint-staged will rewrite the file on commit using the **root** prettier config

#### Manual Verification:

- Read `docs/criteria.md` end to end: each criterion's "does not cover" section actually rules
  out the failure mode it is meant to rule out
- The `clarity` text unambiguously forbids reporting anything ESLint or Prettier owns
- The `verification` text unambiguously forbids `n/a` for "testing would be expensive"

---

## Phase 2: Gate wiring and rendering

### Overview

Point the gate at the three blocking criteria, exempt `clarity` from the single-fail
condition, and relabel the PR comment. Typecheck goes green again at the end of this phase.

### Changes Required:

#### 1. Blocking list and the clarity exemption

**File**: `packages/code-review/src/agents/reviewer/verdict.ts`

**Intent**: Three criteria now fail on "unproven" rather than two, and `clarity` must not be
able to fail a PR by itself. The four threshold constants and the four-condition structure do
not change.

**Contract**: `BLOCKING_CRITERIA` (`:24`) becomes
`["defect", "safety", "blastRadius"] as const satisfies readonly Criterion[]`. A second
exported list — `SINGLE_FAIL_EXEMPT = ["clarity"] as const satisfies readonly Criterion[]` —
is added next to it, and condition 2 (`:67`) filters on
`!blocking.has(name) && !exempt.has(name) && score <= SINGLE_FAIL_MAX`. Conditions 1, 3 and 4
keep their current predicates; `clarity` still counts toward condition 3. `BLOCKING_MAX`,
`SINGLE_FAIL_MAX`, `ACCUMULATION_MAX` and `ACCUMULATION_COUNT` keep the values `5, 3, 5, 3`.

Four comment sites in this file state facts that the change falsifies, and all four must be
rewritten with it:

- `:21-23` — "The **two** dimensions that fail on 'unproven'… partition the **six** criteria"
- `:65-67` — "'Other' because condition 1 already fails **the two** blocking dimensions"; it
  also needs to explain the new `clarity` exemption, which is why condition 2 is no longer
  simply "every non-blocking criterion"
- `:72` — "accumulation across **all six** criteria"
- the `ACCUMULATION_COUNT` doc comment gains one sentence recording that 3-of-5 is a deliberate
  tightening from 3-of-6, so a future reader does not read it as an oversight

#### 2. Comment labels

**File**: `packages/code-review/src/agents/reviewer/render.ts`

**Intent**: The score table in the PR comment should read as prose, not as schema keys.

**Contract**: `CRITERION_LABELS` (`:8-15`) maps the five keys to
`local defect`, `security and data handling`, `blast radius and reversibility`,
`risk-proportional verification`, `clarity of the change`. Everything else in the file —
`COMMENT_MARKER`, `SEVERITY_ORDER`, `NO_NOTE`, the section order in `renderMarkdown`, the
blocking-findings section — is untouched.

#### 3. Repository README

**File**: `README.md` (repository root)

**Intent**: `:195` documents the reviewer as running "against a six-criterion rubric". It is the
only prose outside `context/` that states the count — `.github/**` and
`packages/code-review/evals/README.md` are criterion-agnostic, and
`packages/code-review/README.md` does not exist.

**Contract**: `:195` says five, and points at `packages/code-review/docs/criteria.md` for the
definitions.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` from inside `packages/code-review`
- Linting passes: `npm run lint` from inside `packages/code-review`
- No prose outside `context/` still claims a six-criterion rubric

#### Manual Verification:

- The four rewritten comments in `verdict.ts` each state something now true

---

## Phase 3: Tests

### Overview

Bring the seven affected test files back to green by reading each pinned assertion and
deciding what it should now assert — not by renaming keys mechanically.

### Changes Required:

#### 1. Rubric pins

**File**: `packages/code-review/tests/unit/prompts.test.ts`

**Intent**: Re-pin the prompt to the new rubric, keeping the tests that guard things which did
not change.

**Contract**: `:78-89` pins five criterion names instead of six. `:91-94` pins two anchor
fragments drawn from the new text. `:96-98` additionally pins the new anti-`n/a`-abuse
sentence. `:100-102` (eleven score values), `:104-115` (five blocking categories and the
scoping clause), `:117-119` (untrusted metadata) and `:121-125` (version guardrail) must pass
**unchanged** — if any of them needs editing, Phase 1 or 2 changed something it was told not
to.

#### 2. Gate table

**File**: `packages/code-review/tests/unit/verdict.test.ts`

**Intent**: Rebuild the case table for three blocking criteria and an exempt `clarity`, and
add the cases the new structure makes possible.

**Contract**: `reviewWith` (`:17-31`) builds five criteria. The table (`:43-112`) covers, at
minimum: threshold and threshold+1 for each of the three blocking criteria; `verification` at
3 and 4; **`clarity` at 1 with every other criterion at 9 yielding `passed`** (the exemption, moved here
from Phase 2 where the suite is still red); **`blastRadius` at 5 with every other criterion at 9
yielding `failed`**; `clarity` contributing to a three-criteria accumulation failure; a blocking-category finding overriding perfect scores;
`n/a` on blocking criteria not failing; and the all-`n/a` review. The constants test (`:147-151`)
asserts `[5, 3, 5, 3]`, `BLOCKING_CRITERIA` equal to
`["defect", "safety", "blastRadius"]`, and `SINGLE_FAIL_EXEMPT` equal to `["clarity"]`.

The all-`n/a` case at `:92-102` keeps its `passed` expectation. It documents a real hole, but
closing it is an `n/a`-floor change, explicitly out of scope — the test should gain a comment
saying so and pointing at the research, so the expectation is not mistaken for an endorsement.

#### 3. Fixtures in the remaining five files

**Files**: `tests/unit/schema.test.ts`, `tests/unit/render.test.ts`, `tests/unit/cli.test.ts`,
`tests/unit/eval-asserts.test.ts`, `tests/integration/agent.test.ts`

**Intent**: Update the criteria fixtures to the five new keys and refresh the notes so they
read as plausible justifications for the criterion they sit under. In `eval-asserts.test.ts`
there are two independent couplings — the literal at `:31-38` and the cast at `:28`.

**Contract**: each file's criteria literal carries the five keys. `schema.test.ts:62-67`
(missing-key rejection) targets one of the new keys; `:83-86` (an `n/a` that parses) targets
`safety`; `:92-95` (empty note tolerated) targets any criterion. `render.test.ts:56-61` asserts
the five new display labels. `agent.test.ts:152` keeps asserting that the compiled score
property is `{ type: "string", enum: [...SCORE_VALUES] }` — the strict-subset guard, which must
not need editing.

### Success Criteria:

#### Automated Verification:

- Unit and integration tests pass: `npm test` from inside `packages/code-review`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The strict-subset guard in `tests/integration/agent.test.ts:132-165` passes unedited

#### Manual Verification:

- Every removed assertion was removed because the thing it pinned genuinely no longer exists,
  not because it was inconvenient
- The five criteria notes in each fixture are plausible for their criterion — a reader of
  `render.test.ts` output should not spot a note filed under the wrong dimension

---

## Phase 4: A/B replay on the reconstructed calibration corpus

### Overview

Reconstruct the five calibration PRs, persist them as fixtures, and run both the old and the
new rubric against them. This is the measurement the original calibration could not repeat and
the reason this phase exists at all.

### Changes Required:

#### 1. Corpus fixtures

**File**: `packages/code-review/evals/corpus/` (new directory)

**Intent**: Persist the five calibration inputs so any future rubric change can be regression-
checked against a hand-scored baseline. Their absence is what made the original calibration a
one-shot.

**Contract**: One `pr-<n>.diff` and one `pr-<n>.json` (`{ number, title, body, handScored }`)
per PR, for n ∈ {1, 3, 5, 6, 7}. Diffs are generated by
`git diff --merge-base <merge>^1 <merge>^2 -- . ':(exclude)context/**'` with merges
`d155801` (#1), `1fd7b1e` (#3), `12b612f` (#5), `48fcbd7` (#6), `e276ca0` (#7); titles and
bodies by `gh pr view <n> --json title,body`. Expected sizes, as a self-check: 2581, 10129,
34831, 1164, 82567 bytes. `handScored` carries the baseline verdict from
`context/archive/2026-08-14-ci-cd-code-review/change.md:19-25` — **with one correction**:
#1 passed, #3 **passed**, #5 passed, #6 passed, #7 failed.

The correction is not a judgment call. `change.md:37-39` records that PR #3's `failed`
baseline was itself a false positive — *"no test infrastructure existed at that commit…
Arguably better than the baseline"* — so scoring against the raw table would penalise correct
behavior on one of five cases. Each entry's JSON must carry the citation for its verdict, and
#3's must carry this correction, so nobody silently reverts it. Restating the old rubric
against the corrected baseline: it agreed on **3 of 5** (#1, #6, #3), not 2 of 5. **3-of-5 is
the number to beat**, and the plan's earlier phrasing of "2-of-5" was arithmetic on the
uncorrected table.

A short `README.md` in the directory must record the reconstruction commands and the byte
sizes, so a later reader can verify the fixtures were not hand-edited.

#### 2. Replay procedure

**File**: `packages/code-review/evals/corpus/README.md` (the procedure is documented, not coded)

**Intent**: Run both rubrics over the same five inputs without adding a harness. `src/cli.ts`
already *is* this tool, so the A/B is a shell procedure over two git worktrees rather than a new
script — which also keeps the comparison free of any coupling to the criteria shape. A script
typed against the five new keys could not run at the pre-change commit at all, where
`Review["criteria"]` still has six.

**Contract**: `src/cli.ts` takes the diff on stdin (`:99-112`), `--title-file`, `--body-file`
and `--cwd` on argv (`:27-39`), and emits one JSON `{verdict, review, markdown}` on stdout
(`:84`). The procedure, recorded in the corpus README so it is repeatable:

1. `git worktree add` one tree at the pre-change commit and one at the post-change commit.
2. `npm ci` inside `packages/code-review` in each — a standalone package with its own lockfile,
   so a fresh worktree has no `node_modules`.
3. Per PR and per worktree: pipe that PR's corpus diff into
   `npm start -- --cwd <worktree-root>` with `--title-file` / `--body-file` pointing at the
   corpus metadata, and `OPENROUTER_MODEL` pinned to the same value in both trees.
4. Collect `.verdict` and `.review.criteria` from each JSON into the comparison table.

Two things a reader needs to know. `evals/ground-truth.ts:27-46` falls back to the root
`package-lock.json`, so the React-version ground truth still resolves in a worktree that was
never built. And `agent.ts:14-19` records that the provider ignores `seed` — "no replay story
may be built on the seed alone" — so a single reading per cell is not evidence.

### Success Criteria:

#### Automated Verification:

- Each generated diff matches its recorded byte size
- Both worktrees pass `npm ci && npm run typecheck && npm test` inside the package before any
  replay call — an A/B across one broken build is not a comparison
- `OPENROUTER_MODEL` resolves to the same value in both trees, and that value is recorded

#### Manual Verification:

- The procedure runs against all five entries in both worktrees without a CLI error
- The comparison table is recorded in `context/changes/code-review-criteria/change.md`
- **PR #7 is the decisive case**: the new `verification` criterion must not score `n/a` on a PR
  that added 15 tests. If it does, the anti-abuse sentence from Phase 1 did not work and the
  criterion text needs another pass before this change ships
- **PR #5 is the second case to read**: it failed on an over-tagged `data-retention` category.
  Since the categories are unchanged, a still-`failed` result there is expected, not a
  regression
- Every cell is read from **at least two runs per rubric**, not one. `agent.ts:14-19` records
  that the provider ignores `seed` — "no replay story may be built on the seed alone" — so a
  single-run delta of one case is noise, not a result
- A judgment is recorded **per PR**, naming which criterion moved the verdict and why, not just
  a count. The corrected baseline puts the old rubric at 3 of 5; a bare count that ties or
  beats it is not on its own evidence that the new rubric is better

---

## Phase 5: Eval sweep and new baseline

### Overview

Run the paid promptfoo sweep on the new rubric, record a fresh baseline, and clear the two
stale numbers carried since the last impl-review.

### Changes Required:

#### 1. Criterion count inside the precision rubric

**File**: `packages/code-review/evals/promptfooconfig.yaml`

**Intent**: The precision rubric tells the judge that "the schema requires [a note] for **all
six criteria**" (`:137-138`). That becomes false, and it sits in text the judge actually reads,
so it must be corrected before the sweep runs.

**Contract**: `:137-138` says five, not six. Note for the implementer: this rubric is **outside**
the coverage of the transcription guard at `tests/unit/eval-asserts.test.ts:143-146`, which
only checks the three `flaw_*` rubrics sourced from `flaws.ts` — nothing would have flagged this
drift, and nothing will flag the next one.

#### 2. Sweep and recorded baseline

**File**: `context/changes/code-review-criteria/change.md`

**Intent**: Record the new baseline so later sweeps have something to compare against, and
settle the two numbers `impl-review.md:141` and `:195-197` flagged as needing a billed run.

**Contract**: Run `npm run eval` from inside the package with `OPENROUTER_API_KEY` set, on the
three configured models. Append to `change.md`: the six metric columns per model, the date, the
commit, and an explicit note that these supersede the pre-change baseline and are not
comparable with it. The un-committed working-tree edit to
`evals/fixtures/react19-migration.diff` must be resolved — committed or reverted — before the
sweep, otherwise the run measures an unrecorded fixture.

### Success Criteria:

#### Automated Verification:

- `npm run eval` completes and writes `evals/out/results.json` and the CSV
- No metric row carries a `HARNESS ERROR:` reason

#### Manual Verification:

- The `verdict` assert still scores 1 for all three models — the fixture's planted authz defect
  must still trip the gate through the unchanged `authorization` category
- The baseline is recorded in `change.md` with its date and commit
- A judgment is recorded on whether `flaw_defaultprops` still fails to discriminate (the F3
  problem from `impl-review.md:148-157`); if it does, that is pre-existing and out of scope
  here, but it should be named rather than silently carried

---

## Testing Strategy

### Unit Tests:

- The gate table is the centre of gravity: three blocking criteria at threshold and
  threshold+1, `verification` at 3 and 4, `clarity` at 1 passing, `clarity` contributing to
  accumulation, blocking-category override, `n/a` exclusion, all-`n/a`
- Prompt pins: five criterion names, anchors from the new text, the anti-`n/a`-abuse sentence
- Unchanged-by-contract pins that must pass untouched: eleven score values, five blocking
  categories plus scoping clause, untrusted-metadata sentence, version guardrail, strict-subset
  JSON Schema shape

### Integration Tests:

- `tests/integration/agent.test.ts` — the compiled wire schema stays inside OpenRouter's strict
  subset with five criteria instead of six

### Manual Testing Steps:

1. From inside `packages/code-review`: `npm ci && npm run lint && npm run typecheck && npm test`
2. Generate the corpus and check all five diffs against their recorded byte sizes
3. From each worktree, pipe every corpus diff through `npm start` with the matching title and
   body files, then diff the two verdict tables
4. Read PR #7's `verification` score and note; read PR #5's fired conditions
5. Run the paid eval sweep; confirm no `HARNESS ERROR:` rows
6. Open a throwaway PR against `master` and confirm the sticky comment renders five rows with
   the new display labels and that exactly one `ai-cr:*` label is applied

## Performance Considerations

Today `reviewInstructions` is 6,290 characters (~1,573 tokens) on every call, of which the
`criteria` block is 3,323 and the `n/a` block 1,017.

The first draft of this plan claimed the prompt would shrink. It would not have: carrying the
spec's `Covers:` / `Does not cover:` enumerations into the prompt measured 4,923 characters —
**+48% on that block, ~+29% on the whole instruction text**, paid on every review. The trimmed
prompt form specified in Phase 1 §2 exists to avoid that, with a hard budget of 3,323
characters for the criteria block; at five criteria instead of six that should land slightly
below today's figure. No change to `MAX_DIFF_BYTES` (400,000) or
`MAX_BODY_CHARS` (4,000). Phase 4 costs ten review calls on Haiku across two runs; Phase 5
costs one full sweep — 3 review calls plus 12 judge calls, historically well under a dollar.
Per-review cost remains unobservable because `agent.ts:58-59` discards `usage`; that is
unchanged and out of scope.

## Migration Notes

There is no data or schema migration — the reviewer is stateless and each run is independent.
Two discontinuities are worth stating:

- **Old PR comments become non-comparable.** Comments already posted show six rows with the old
  labels. Nothing rewrites them, and the `ai-cr:*` labels on merged PRs keep whatever they were
  given. Re-running review on an open PR (via the `ai-cr:review` label) replaces its sticky
  comment with a five-row table.
- **The prior eval baseline is void.** Sweep numbers recorded before this change measured a
  different rubric. Phase 5 records the replacement and must say so explicitly.

Rollback is a git revert of the source and test changes; nothing external holds state keyed to
the criteria set. `docs/criteria.md` and `evals/corpus/` are additive and can be left in place.

## References

- Research: `context/changes/code-review-criteria/research.md`
- Original spec (immutable): `context/archive/2026-08-14-ci-cd-code-review/requirements.md:30-165`
- Calibration record: `context/archive/2026-08-14-ci-cd-code-review/change.md:14-107`
- Eval triage: `context/changes/code-review-evals/reviews/impl-review.md:106-234`
- Rubric today: `packages/code-review/src/agents/reviewer/prompts.ts:19-64`
- Gate today: `packages/code-review/src/agents/reviewer/verdict.ts:15-94`
- Criterion-agnostic eval asserts: `packages/code-review/evals/asserts/verdict.ts:40-50`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Spec and rubric

#### Automated

- [x] 1.1 `docs/criteria.md` exists and contains all five criterion names and fifteen anchors — 9c3ac74
- [x] 1.2 Prompt `criteria` block at or below 3,323 chars with no `Covers:` text — 9c3ac74
- [x] 1.3 Three criteria citations now point at `docs/criteria.md` — 9c3ac74
- [x] 1.4 Seven gate / blocking-category citations untouched — 9c3ac74
- [x] 1.5 `npx prettier --check docs/criteria.md` clean — 9c3ac74

#### Manual

- [x] 1.6 Each criterion's "does not cover" section rules out its intended failure mode — 9c3ac74
- [x] 1.7 `clarity` forbids reporting anything ESLint or Prettier owns — 9c3ac74
- [x] 1.8 `verification` forbids `n/a` for "testing would be expensive" — 9c3ac74

### Phase 2: Gate wiring and rendering

#### Automated

- [x] 2.1 Type checking passes — e22dd7f
- [x] 2.2 Linting passes — e22dd7f
- [x] 2.3 No prose outside `context/` still claims a six-criterion rubric — 31bc75b

#### Manual

- [x] 2.4 The four rewritten `verdict.ts` comments each state something now true — 657c158

### Phase 3: Tests

#### Automated

- [x] 3.1 Unit and integration tests pass — e22dd7f
- [x] 3.2 Type checking passes — e22dd7f
- [x] 3.3 Linting passes — e22dd7f
- [x] 3.4 Strict-subset guard passes unedited — e22dd7f

#### Manual

- [x] 3.5 Every removed assertion was removed because its subject no longer exists — e22dd7f
- [x] 3.6 Criteria notes in each fixture are plausible for their criterion — e22dd7f

### Phase 4: A/B replay on the reconstructed calibration corpus

#### Automated

- [x] 4.1 Each generated diff matches its recorded byte size — ce734fb
- [x] 4.2 Both worktrees pass `npm ci && npm run typecheck && npm test` before any replay call — ce734fb
- [x] 4.3 `OPENROUTER_MODEL` identical in both trees and recorded — ce734fb

#### Manual

- [x] 4.4 Procedure runs against all five entries in both worktrees without a CLI error — ce734fb
- [x] 4.5 Comparison table recorded in `change.md` — ce734fb
- [ ] 4.6 PR #7 does not score `verification` as `n/a`
- [x] 4.7 PR #5's fired conditions read as expected given unchanged categories — ce734fb
- [x] 4.8 Every cell read from at least two runs per rubric — ce734fb
- [x] 4.9 Per-PR judgment recorded, naming the criterion that moved each verdict, against the corrected 3-of-5 baseline — ce734fb

### Phase 5: Eval sweep and new baseline

#### Automated

- [x] 5.1 `npm run eval` completes and writes results — 31bc75b
- [x] 5.2 No metric row carries a `HARNESS ERROR:` reason — 31bc75b

#### Manual

- [x] 5.3 `verdict` assert still scores 1 for all three models — 31bc75b
- [x] 5.4 Baseline recorded in `change.md` with date and commit — 31bc75b
- [x] 5.5 Judgment recorded on whether `flaw_defaultprops` still fails to discriminate — 31bc75b
