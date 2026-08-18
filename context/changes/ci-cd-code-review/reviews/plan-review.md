<!-- PLAN-REVIEW-REPORT -->

# Plan Review: AI Code Review CI/CD Workflow (round 2)

- **Plan**: `context/changes/ci-cd-code-review/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-18
- **Verdict**: REVISE → **SOUND** after triage (all 8 findings fixed 2026-08-18)
- **Findings**: 3 critical, 4 warnings, 1 observation

Second review round, against the plan rewritten on 2026-08-18. The first round is preserved at
`reviews/plan-review-2026-08-14.md`; its findings are cited in the plan as `[F<n>]` and this round's as
`[R2-F<n>]`, so the two numbering schemes do not collide.

No finding challenged the approach. The pattern across all eight is narrower and more specific than
round one's: **the plan's reasoning was sound but three of its external references and one of its own
success criteria did not survive being checked.** R2-F1, R2-F2 and R2-F3 are all the same failure seen
three ways — an assertion carried forward from an earlier draft that nobody re-verified against the
actual artifact. R2-F4 and R2-F6 are the other class: two individually-correct decisions that compose
into a defect neither section noticed.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

## Grounding

14/14 existing paths ✓ · 4/4 new paths correctly absent ✓ · root lockfile claim verified 47/47 direct
deps at `lockfileVersion: 3` ✓ · `engines.node >= 22` ✓ · `restrict-template-expressions`
`allowNumber: false` confirmed in the installed plugin config ✓ · Progress↔Phase 5/5 headings, 44 items,
zero checkboxes outside `## Progress` ✓ · brief↔plan ✓ · `docs/reference/contract-surfaces.md` absent
(check skipped) · **2 external references failed to resolve — see R2-F2, R2-F3**

Live repo facts re-confirmed: `master` protection requires exactly `["ci"]` with `strict: true`;
`OPENROUTER_API_KEY` is not among the repo secrets; no `ai-cr:*` label exists; `actionlint` is not
installed locally.

## Findings

### R2-F1 — Phase 1 criterion 1.4 cannot pass against Phase 1's own schema

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #1 (contract) vs Phase 1 #6 / criterion 1.4
- **Detail**: Compiling the plan's own contract against the installed `zod@4.4.3` shows
  `note: z.string().min(1)` → `"minLength": 1` and `blockingCategory: z.enum([...]).nullable()` →
  `"anyOf"`. Criterion 1.4 required the compiled document to contain "no `anyOf`, `minimum`, `maximum` or
  `const`", so it was unsatisfiable against the schema the same phase mandates. It also forbade the wrong
  keyword: a nested `anyOf` is inside the strict-mode subset (only a root-level one is rejected), while
  `minLength`/`minimum`/`maximum`/`pattern`/`format` are the keywords actually outside it. The guard as
  written blocked a legitimate shape and permitted the one real hazard the plan introduced.
- **Fix A ⭐ Recommended**: Drop `.min(1)` from `note`; correct 1.4's keyword list
  - Strength: Makes the whole schema strict-safe, not just the score node. Non-emptiness moves to the
    prompt plus a renderer placeholder — where an empty note is a display problem, not a reason to
    discard an entire review.
  - Tradeoff: The schema no longer rejects an empty note, so the "rejects an empty note" test inverts.
  - Confidence: HIGH — compiled and inspected directly.
  - Blind spot: Whether OpenRouter 400s on `minLength` or silently drops it is provider-dependent and
    unverified.
- **Fix B**: Keep `.min(1)` and let Phase 1's live call adjudicate
  - Strength: Keeps the non-empty guarantee where it is enforceable.
  - Tradeoff: Makes one live call load-bearing for a keyword known to be out of subset; a 400 there means
    reworking a schema the renderer and CLI already depend on.
  - Confidence: MEDIUM — outcome genuinely unknown.
  - Blind spot: Anthropic-via-OpenRouter strict semantics may differ from the OpenAI-derived subset.
- **Decision**: FIXED via Fix A — 10 coordinated edits: `note` loses `.min(1)`, criterion 1.4 and the
  snapshot target the real keyword list and explicitly expect the nullable's `anyOf`, non-emptiness moves
  to the prompt and a renderer placeholder, and the empty-note test case is inverted.

### R2-F2 — `uses: rhysd/actionlint` is not a GitHub Action

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 #4; criteria 3.3, 3.4; Migration Notes third rollback lever
- **Detail**: `gh api repos/rhysd/actionlint/contents` returns no `action.yml` at the repo root — upstream
  ships a binary and a Docker image, not a composite action, so `uses: rhysd/actionlint@vN` fails with
  "Can't find action.yml". `raven-actions/actionlint` does carry `action.yml`. The bad reference was
  inherited: the 2026-08-17 plan said the same, and round one's F7 fix text prescribed it.
- **Fix**: Name a reference that resolves — `raven-actions/actionlint@v2`, or
  `docker://rhysd/actionlint:latest` as a step container, or a pinned binary download in a `run:` step.
- **Decision**: FIXED — `raven-actions/actionlint@v2`, with the two alternatives recorded and an explicit
  note not to reach for `rhysd/actionlint`.

### R2-F3 — The plan cited a lesson that does not exist

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 #2; References ("Silent-degradation lesson")
- **Detail**: `context/foundation/lessons.md` holds exactly one lesson — "Migrations aren't shipped until
  CI pushes them to production" at line 5; lines 5-10 are its heading plus Context/Problem/Rule/Applies-to.
  Grepping the file for silent / degrad / swallow returns nothing. The plan cited `lessons.md:5-10` twice
  as the silent-degradation rule behind the versions fallback, so an implementer following the citation
  reads about migrations — or worse, treats a fabricated rule as an accepted team invariant.
- **Fix**: Delete both citations; the argument stands on `installed-versions.ts:19-21,31-33` plus the
  guardrail at `prompts.ts:6-8`, which is the actual evidence. If the rule is worth having, write it via
  `/10x-lesson` first and cite the real line range.
- **Decision**: FIXED — both citations removed, argument re-grounded on the two real code references.

### R2-F4 — An output cap plus no-retry can make a PR permanently unreviewable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 #5 vs "What We're NOT Doing" (no retry)
- **Detail**: Two decisions made separately composed badly. Output was capped at 4000 tokens and there is
  no retry. Output exceeding the cap truncates mid-JSON → `NoObjectGeneratedError` → `verdict=error`, and
  the only recovery — `ai-cr:review` — re-runs with the identical cap and fails identically. That is a
  loop whose only exit is a code change, on precisely the large PRs that most need review. The plan got
  halfway there (the `toMessage` extension surfaces `finishReason: "length"`) but nothing connected that
  signal to a fix, and no Phase 5 row exercised it.
- **Fix A**: Make the cap escapable without a code change (action input + env override), plus a Phase 5 row.
  - Strength: Turns a dead end into a retry that can actually differ.
  - Tradeoff: One more input threaded through action → CLI → agent.
  - Confidence: HIGH — the `model`/`cwd` inputs establish the pattern.
  - Blind spot: Whether the caller can vary it per-run without editing the workflow is unverified.
- **Fix B**: Keep the cap fixed; add the verification row and have the error comment name the constant.
  - Strength: Zero new surface.
  - Tradeoff: Recovery still needs a commit, on an already-awkward PR.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: FIXED via a reviewer-directed third option — **drop `maxOutputTokens` entirely**. The
  decisive fact, surfaced during triage: omitting it does not mean "unbounded", because the Anthropic
  Messages API requires `max_tokens`, so OpenRouter supplies a default on our behalf. The real choice is
  between a ceiling we picked (and picked too low at 4000) and a ceiling the provider picked (almost
  certainly more generous). Applied as: `temperature: 0` + `seed` only, a prominent note in Phase 1 #5
  explaining why the cap must not be re-added "for tidiness", `MAX_DIFF_BYTES` as the remaining cost
  bound, and a new Phase 5 row measuring whether `finishReason: length` ever fires and at what diff size
  — the only way to learn where OpenRouter's default actually sits.

### R2-F5 — `deriveVerdict` and `explainVerdict` implement the same rule twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 #2
- **Detail**: Both were declared as independent exports, each walking the same four-condition table. A
  threshold edit or condition change has to land in both and nothing forces them to agree, so a comment
  could state reasons that contradict the label it explains. The plan rejects exactly this shape one
  bullet earlier, where `BLOCKING_CRITERIA` exists "so conditions 1 and 2 derive from one source rather
  than two hardcoded lists that can drift" — same argument, same file, not applied.
- **Fix**: One internal `evaluateGate(review) → {verdict, reasons}`; make `deriveVerdict` and
  `explainVerdict` thin projections. Add a test asserting `reasons` is non-empty exactly when `verdict`
  is `failed`.
- **Decision**: FIXED — single `evaluateGate` plus two projections, and the projection invariant is now
  the first assertion in `verdict.test.ts`, checked across every case in the file, so the shape is
  enforced rather than merely intended.

### R2-F6 — Dropping `paths-ignore` made `ai-cr:passed` often mean "nothing reviewed"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 #1 step 8 (`empty` → `ai-cr:passed`) vs the trigger decision
- **Detail**: The trigger was widened to every PR while the diff pathspec still excludes `context/**`, so
  a `context/**`-only PR now reaches the empty-diff branch _reliably_ → `verdict=empty` → the workflow
  added `ai-cr:passed`. In this repo that is a common PR shape, since the whole `context/` change workflow
  produces them, so a green label would regularly certify a change nothing looked at. The plan named the
  new token cost of markdown-only PRs but not this one, which is the more consequential of the two — it
  degrades what the label means.
- **Fix A ⭐ Recommended**: On `empty`, comment but add no verdict label.
  - Strength: `ai-cr:passed` keeps exactly one meaning — a review ran and passed. Mirrors the `error`
    branch, so the rule is uniform: no review outcome, no verdict label.
  - Tradeoff: A process-only PR shows no label, which someone may read as "the bot is broken" until they
    read the comment.
  - Confidence: HIGH — the same reasoning the plan already accepted for `error`.
  - Blind spot: None significant.
- **Fix B**: Keep the label; put the caveat in the comment and `AGENTS.md`.
  - Strength: Every PR ends with a label, so absence stays a real failure signal.
  - Tradeoff: The caveat lives in prose nobody reads at review time.
  - Confidence: MEDIUM
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `empty` now removes both labels and comments only, stated as a uniform
  rule ("a verdict label is applied only when a review actually produced a verdict"). The Desired End
  State in both plan and brief was amended to match, and the Phase 5 verification row updated.

### R2-F7 — The schema-snapshot criterion did not say which document to snapshot

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #6, criterion 1.4
- **Detail**: "Snapshot the compiled JSON Schema the provider will actually receive" has two
  implementations producing different documents, and the difference is exactly the criterion's subject.
  Verified: `@ai-sdk/provider-utils` recursively stamps `additionalProperties: false` after zod's
  conversion (`dist/index.js:1735-1742`), so calling `z.toJSONSchema` directly snapshots a document the
  provider never sees. Research §3 recommended the mock-model route; the plan lost that detail.
- **Fix**: Name the route — assert on `doGenerateCalls[0].responseFormat.schema` in `agent.test.ts`,
  reusing the harness the injection canary already uses.
- **Decision**: FIXED — mock-model route named explicitly with the reason, and the snapshot reassigned
  from `schema.test.ts` to `agent.test.ts` in the Testing Strategy so the two sections agree.

### R2-F8 — Both size caps were named in bytes but would be implemented in code units

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #4 (`MAX_BODY_BYTES`), Phase 2 #3 (`MAX_DIFF_BYTES`)
- **Detail**: Both constants said BYTES while the natural implementation (`str.length`, `str.slice`)
  counts UTF-16 code units. For a Polish-language PR body or a non-ASCII diff the two diverge, and slicing
  at a byte offset can split a multi-byte character — producing a replacement character in the prompt at
  exactly the truncation boundary the model is told to notice.
- **Fix**: Either specify `Buffer.byteLength` plus `Buffer.subarray` truncation, or switch the body cap to
  characters.
- **Decision**: FIXED — resolved as part of R2-F4's edit by switching to `MAX_BODY_CHARS = 4000`
  (characters), with the multi-byte-split rationale recorded inline. `MAX_DIFF_BYTES` stays byte-named: it
  guards a cost ceiling on an ASCII-dominant unified diff, where the distinction does not bite.
