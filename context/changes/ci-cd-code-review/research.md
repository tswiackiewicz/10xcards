---
date: 2026-08-18T09:30:45+02:00
researcher: tswiackiewicz
git_commit: 080553761c42f18eb48ae35bed67451e1c668ba1
branch: master
repository: tswiackiewicz/10xcards
topic: "CI/CD AI code review — rubric scoring, verdict gate and GitHub Actions wiring"
tags: [research, codebase, ci-cd, github-actions, code-review, packages, rubric, ai-sdk, security, gdpr]
status: complete
last_updated: 2026-08-18
last_updated_by: tswiackiewicz
---

# Research: CI/CD AI code review — rubric, gate and workflow wiring

**Date**: 2026-08-18T09:30:45+02:00
**Researcher**: tswiackiewicz
**Git Commit**: `0805537` — **unpushed** (HEAD is 1 commit ahead of `origin/master`, on no remote branch), so GitHub permalinks do not resolve at this commit. All references below are local `file:line`.
**Branch**: master
**Repository**: tswiackiewicz/10xcards

> **Supersedes** the 2026-08-14 research, which was written when the criteria list was still a
> `{{CR_CRITERIA}}` placeholder. `requirements.md` was fully specified on 2026-08-17; this document
> re-derives the whole change against that final spec. Two factual corrections to the old version are
> recorded in *Corrections to prior artifacts* below.

## Research Question

Introduce the first CI/CD workflow for PR code reviews, per
`context/changes/ci-cd-code-review/requirements.md`:

- GHA workflow on every PR to `master`; the review itself in a **composite action**.
- Inputs: PR title, PR body, and a git diff with `context/**` excluded, plus installed dependency
  versions as the only ground truth about versions.
- Six criteria scored 1–10 against written anchors, or `n/a` with a one-line justification, with
  `n/a`-by-default rules for config/docs/mechanical diffs.
- A four-condition pass/fail gate derived **mechanically** from the scores, plus five named blocking
  categories that fail a PR regardless of score.
- Side effects: PR comment with summary; labels `ai-cr:failed` (red) / `ai-cr:passed` (green).
- Behavior: on-demand retry when label `ai-cr:review` is added.

## Summary

The workflow wiring is the easy half. **The hard, unproven half is getting a small model to emit a
stable six-criterion rubric through a strict JSON-Schema channel**, and the single highest-risk
assumption in the current plan sits exactly there.

Five findings change what should be built:

1. **The score encoding is likely to be rejected by the provider.** `plan.md:205` commits to
   `z.union([z.int().min(1).max(10), z.literal("n/a")])`. The OpenRouter provider sends
   `strict: true` by default (`packages/code-review/node_modules/@openrouter/ai-sdk-provider/dist/index.js:3626`),
   and that union compiles to `{"anyOf":[{"type":"integer","minimum":1,"maximum":10},{"type":"string","const":"n/a"}]}`
   — `minimum`/`maximum`/`const` are outside OpenAI-style strict mode's keyword subset. A string enum
   of the eleven legal values is one node, strict-safe, and makes invalid scores unrepresentable.
2. **There is no repair and no validation retry on this code path.** A schema miss is a hard action
   failure, not a retried one — `repairText` exists only on the deprecated `generateObject`. A
   six-criterion schema is materially harder to satisfy than today's four-field one, so this matters
   more than it did.
3. **Nothing sets `temperature`.** AI SDK 5+ stopped defaulting it to 0, so every review currently
   runs at provider-default sampling. For a *scoring* task that is the wrong default, and it directly
   undercuts the five-PR calibration replay the plan schedules in Phase 5.
4. **Putting the package step inside the `ci` job blocks production deploys, not just merges.**
   `deploy` declares `needs: ci` (`.github/workflows/ci.yml:54`). `reviews/plan-review.md:114-118`
   named the merge-blocking cost; the deploy-blocking cost is unstated anywhere.
5. **Two of the five named blocking categories have no surface in this repository at all** — consent/
   suppression/unsubscribe, and the *export* half of GDPR. The reviewer will never legitimately fire
   them here, so they are prompt weight with no local recall.

Everything else the plan asserts about the working tree checked out. The package is green at HEAD
(`npm run lint`, `npm run typecheck`, `npm test` → 4 files / 15 tests passing, run from inside
`packages/code-review`).

## Detailed Findings

### 1. `packages/code-review` — the CLI contract as it stands

Nine source files, four test files, no build step, no `dist/`, no `bin`.

| Module | Contract | Reference |
| --- | --- | --- |
| `src/cli.ts` | No exports. Reads **stdin only**; `process.argv` is never touched anywhere in `src/`. Empty stdin → usage line + `exitCode = 1`. All throws → one readable stderr line + `exitCode = 1`. | `cli.ts:13-19`, `:25`, `:27-31`, `:35-39` |
| `src/agents/reviewer/agent.ts` | `reviewDiff(diff, options: ReviewAgentConfig & { cwd?: string })`. Already accepts `cwd`; already collects versions and builds the prompt. | `agent.ts:31-37` |
| `src/agents/reviewer/schema.ts` | `{ summary, findings[{file, line, severity, message}] }`. No scores, no verdict. Uses `z.number().int().positive()` and `z.enum`; **no `z.union`, no `z.literal`, no `z.int()` anywhere yet**. | `schema.ts:3-13` |
| `src/agents/reviewer/prompts.ts` | Static instructions joined with `" "`; `buildReviewPrompt` returns the **bare diff** when `versions` is empty, else a `Installed versions (ground truth):` block then `Diff:`. | `prompts.ts:2-9`, `:15-21` |
| `src/agents/reviewer/installed-versions.ts` | Reads `<cwd>/package.json` deps+devDeps, resolves each from `node_modules/<name>/package.json`. Swallows **every** failure by design. | `installed-versions.ts:15-38`, `:19-21`, `:31-33` |
| `src/providers/model.ts` | The **only** module reading `process.env`. `OPENROUTER_API_KEY` required; `OPENROUTER_MODEL` defaults to `anthropic/claude-haiku-4.5`. Parsed lazily inside `resolveModel()`. | `model.ts:5-8`, `:15-18` |

**The versions input already exists end to end** (`agent.ts:32` → `prompts.ts:20`). Of the two "new"
inputs in `requirements.md:6-28`, only PR title/body is genuinely new.

**`cwd` is never passed by the CLI.** `cli.ts:33` calls `reviewDiff(diff)` bare, so it falls through to
`process.cwd()` — which for `npm start` is `packages/code-review/`, i.e. the reviewer's own
dependencies, not the reviewed repo's. In CI the action must pass the repo root explicitly, or the
"ground truth" block will describe the wrong project.

### 2. Test suite — the choke points and the vacuous cases

Fifteen tests across four files. Three fixtures carry almost all of it:

- `review` (`tests/integration/agent.test.ts:8-11`) — consumed by **all four** integration tests.
- `validReview` (`tests/unit/schema.test.ts:5-8`) — consumed by **all five** schema tests.
- `diff` — two independent copies, `agent.test.ts:13` and `prompts.test.ts:5`.

**Adding any required field to `reviewSchema` breaks 6 of 15 tests**: `schema.test.ts:11-13`, `:15-17`,
and all four integration tests (`agent.test.ts:32-36`, `:38-52`, `:54-63`, `:65-76`). A required field
nested inside a *finding* breaks the same six.

**Four tests go vacuously green rather than red** — the dangerous case:

- `schema.test.ts:19-25`, all three `it.each` rows, assert only `success === false`. With a new required
  top-level field, `safeParse` fails on the *missing field*, not on the bad `severity`/`line` under
  test. They would keep passing even if severity/line validation were deleted outright.
- `schema.test.ts:27-29` ("rejects a review with no summary") degrades identically.

Fix shape: assert on `error.issues[0].path`, not on bare `success`.

**Exactly one strict whole-string prompt assertion exists**: `prompts.test.ts:20`,
`expect(prompt).toBe(diff)`. It survives only if `buildReviewPrompt` still returns the bare diff when
nothing optional is present — a design constraint on the new signature, not a test to rewrite. No test
asserts `reviewInstructions` content beyond a `toContain` (`agent.test.ts:50`), so rubric wording will
ship untested unless a case is added.

**Zero coverage**: `src/cli.ts` entirely (argv, exit codes, `toMessage`'s ZodError unwrapping at
`cli.ts:7-9`), `src/providers/model.ts` entirely, and both barrel files.

### 3. The injection guard, and how to extend it

`agent.test.ts:38-52` reaches the **wire-level** prompt through `MockLanguageModelV4.doGenerateCalls`
(`node_modules/ai/src/test/mock-language-model-v4.ts:20,46-47`), which records every
`LanguageModelV4CallOptions`. It filters `call.prompt` by role, `JSON.stringify`s each slice, and
asserts the diff canary `"items.length"` is in the **user** partition and not in the **system**
partition (`:46-51`).

The same technique extends to PR title/body with one canary each. Two assertions worth adding while
there: `expect(call.prompt.filter(m => m.role === "system")).toHaveLength(1)`, and a snapshot of
`call.responseFormat.schema` — that last one turns the strict-mode risk in §4 into a CI-visible
regression instead of a 400 in production.

`allowSystemInMessages` defaults to `false` (`node_modules/ai/src/prompt/prompt.ts:28-35`), which is a
real part of the boundary. The archived plan pins it: *"do not set `allowSystemInMessages`"*
(`context/archive/2026-08-14-tool-loop-agent/plan.md:79`). In CI the diff becomes attacker-influenced
input from a PR author, so this guard stops being theoretical.

### 4. Structured output under strict mode — the highest-risk assumption

The chain: `Output.object({schema})` sets `responseFormat: {type:'json', schema}`
(`node_modules/ai/src/generate-text/output.ts:106-113`); the OpenRouter provider converts that to
`{type:"json_schema", json_schema:{schema, strict: this.settings.structuredOutputs?.strict ?? true}}`
(`node_modules/@openrouter/ai-sdk-provider/dist/index.js:3622-3630`). **`strict: true` is the default.**

Zod→JSON-Schema goes through `z.toJSONSchema(schema, {target:'draft-7', io:'input', reused:'inline'})`
with `additionalProperties:false` stamped recursively, including inside `anyOf`
(`node_modules/@ai-sdk/provider-utils/src/schema.ts:232-265`).

Encodings, as actually compiled against the installed `zod@4.4.3`:

| Encoding | Emitted JSON Schema | Strict-mode risk |
| --- | --- | --- |
| **A** `z.union([z.int().min(1).max(10), z.literal("n/a")])` — *what `plan.md:205` commits to* | `{"anyOf":[{"type":"integer","minimum":1,"maximum":10},{"type":"string","const":"n/a"}]}` | `minimum`, `maximum`, `const` all outside the strict subset |
| **B** nullable int + `applicable: boolean` | `{"anyOf":[{"type":"integer","minimum":1,"maximum":10},{"type":"null"}]}` + a boolean | Same `anyOf`/`minimum` hazard; **and** `{applicable:false, score:7}` is representable, so the gate needs a branch for a state the rubric has no meaning for |
| **C** `z.discriminatedUnion` | `oneOf` | Worst — `oneOf` is the least strict-compatible, plus a nesting level |
| **D** `z.enum(["1"…"10","n/a"])` | `{"type":"string","enum":["1",…,"10","n/a"]}` | **None** — one node, one keyword, inside every provider's strict subset |

**Recommendation: D.** It is the only encoding that is inside strict mode, unambiguous to the model
("one of eleven choices" reads as exactly the mechanical framing the rubric wants), and makes
out-of-range scores structurally unrepresentable rather than post-hoc rejected. Cost: `verdict.ts` does
`Number(score)` and gains one test. Do the coercion there, not via `z.transform` — a transform is
invisible to `io:'input'` schema generation.

If A is kept instead, it must be paired with either `structuredOutputs: { strict: false }` on the model
construction (`dist/index.d.ts:186-205`, `:738-739`) or one live call inspecting `result.warnings`.
**Do not ship A with `strict: true` unverified.**

The AI SDK's own guidance points the same way: *"Complex Zod schemas with many nested and optional
elements, unions, etc. can be challenging for the model"*
(`node_modules/ai/docs/03-ai-sdk-core/20-prompt-engineering.mdx:18`), and *"optional parameters should
use `.nullable()` instead of `.optional()`"* (`:56-88`).

### 5. No repair, no retry on schema failure

`parseCompleteOutput` (`node_modules/ai/src/generate-text/output.ts:114-158`) throws
`NoObjectGeneratedError` on either a JSON parse failure or a validation failure. It runs at
`generate-text.ts:1521` — **after** the retry loop and outside the `retry()` wrapper at `:1009`.
`maxRetries` (default 2) covers `APICallError`/`GatewayError` only
(`node_modules/ai/src/util/retry-with-exponential-backoff.ts:1-20`).

`repairText`/`experimental_repairText` exist **only** on `generateObject`/`streamObject`
(`generate-object.ts:173-181`), which is itself deprecated —
*"@deprecated Use generateText with an output setting instead"* (`generate-object.ts:120`).
`repairToolCall` on `ToolLoopAgentSettings` repairs tool arguments, irrelevant with zero tools.

So: a schema miss is a failed action. Cheapest fix is a local catch-and-retry-once around `reviewDiff`
(~10 lines, no deprecated API). Note also that `cli.ts:35-39` collapses everything to `error.message`,
discarding `NoObjectGeneratedError`'s `text`/`response`/`usage`/`finishReason` payload — which is the
difference between a five-minute diagnosis and a blind re-prompt.

### 6. Determinism levers — currently all unset

`createReviewAgent` passes exactly three options — `model`, `instructions`, `output`
(`agent.ts:20-24`). No `temperature`, `seed`, `maxOutputTokens`, `timeout`, or `maxRetries`.

*"In AI SDK 5.0, temperature is no longer set to `0` by default"*
(`node_modules/ai/docs/03-ai-sdk-core/25-settings.mdx:47`), while the SDK's own prompt-engineering doc
says *"For tool calls and object generation, it's recommended to use `temperature: 0`"*
(`20-prompt-engineering.mdx:90-104`). Every review today runs at provider-default sampling.

These are **constructor-only** — `AgentCallParameters` (`node_modules/ai/src/agent/agent.ts:28-140`)
accepts no `temperature`/`seed`, so they must be threaded into the `ToolLoopAgent({...})` call the same
way `model` already is. OpenRouter forwards both `temperature` and `seed` to the wire
(`dist/index.js:3616,3620`), but Anthropic models expose no sampling seed — setting `seed` is harmless
and self-documenting, but no replay story should be built on it.

### 7. GitHub Actions surface — what is actually there

`.github/` contains exactly two files: `workflows/ci.yml` and `workflows/purge.yml`.

**Absent, verified**: any composite action (`find` for `action.yml`/`action.yaml` → zero),
any reusable workflow, `actions/github-script`, `gh` CLI in CI, any PR comment or label step,
any `permissions:` key, any `concurrency:` key, any `continue-on-error`, any `always()`,
any `timeout-minutes`. There is exactly **one** `if:` in the whole repo — `ci.yml:55`.

So `permissions:` and `concurrency:` are purely additive, and there is no local prior art to copy for
comments/labels.

**Pins in use**: `actions/checkout@v7` (`ci.yml:13`, `:62`), `actions/setup-node@v6` (`:14`, `:63`),
`supabase/setup-cli@v2` (`:22`, `:72`), `cloudflare/wrangler-action@v4` (`:89`).

#### 7a. The `.gitignore` trap — confirmed live

`.gitignore:51` is `.github/**/10x-*`. Verified with `git check-ignore -v`:

```
IGNORED: .gitignore:51  .github/workflows/10x-code-review.yml
IGNORED: .gitignore:51  .github/actions/10x-code-review/action.yml
tracked-ok:             .github/workflows/ai-code-review.yml
tracked-ok:             .github/actions/ai-code-review/action.yml
```

A `10x-`prefixed action **directory** takes its whole subtree with it. Compounding: `eslint.config.js:29`
calls `includeIgnoreFile(gitignorePath)`, so ignored files are invisible to lint too. Failure mode is
"the workflow simply never runs", with no error. **Do not use a `10x-` prefix under `.github/`.**

#### 7b. `--merge-base` is broken at the repo's current checkout defaults

`actions/checkout@v7` defaults to `fetch-depth: 1` and, on `pull_request`, checks out the merge ref
single-branch. `origin/master` therefore does not exist as a remote-tracking ref and `git merge-base`
has nothing to compute against. `ci.yml:13` has no `with:` block.

Fix: `fetch-depth: 0`. The repo is **179 commits / ~9.92 MiB**, so full history is effectively free.

The pathspec exclusion itself is verified working against real history:

```
$ git diff --merge-base 5fdce15^1 5fdce15 --stat | tail -1
 24 files changed, 2144 insertions(+), 114 deletions(-)
$ git diff --merge-base 5fdce15^1 5fdce15 --stat -- . ':(exclude)context/**' | tail -1
 19 files changed, 1457 insertions(+), 114 deletions(-)
```

It must be single-quoted — GHA `run:` uses `bash -e`, where bare `:(exclude)` is subject to paren
interpretation.

#### 7c. Measured diff sizes (full unified patch, bytes)

| Merge | All paths | Excluding `context/**` | Reduction |
| --- | --- | --- | --- |
| `5fdce15` (PR #8, tool-loop-agent) | 127,077 | 66,426 | 48% |
| `e276ca0` (PR #7, code-review-ai-sdk) | 82,567 | 82,567 | 0% (touched no `context/`) |
| `48fcbd7` (PR #6, node20 CI fix) | 17,863 | 1,164 | **93%** |

So 1 KB – 85 KB after exclusion, roughly 250 – 21,000 tokens. The exclusion earns its place on
doc-heavy PRs and does nothing on code-only ones — exactly as `requirements.md:12-16` predicts. Nothing
observed needs chunking, but a lockfile-touching PR would blow past this, so a size guard still earns
its place.

#### 7d. Repo and label facts (live, `gh` authenticated)

```
$ gh repo view --json owner,name,defaultBranchRef,visibility
{"defaultBranchRef":{"name":"master"},"name":"10xcards","owner":{"login":"tswiackiewicz"},"visibility":"PUBLIC"}
```

- Default branch is **`master`** — so `AGENTS.md:44`'s note that *"the default branch here is `main`"*
  is **stale and wrong**. Recorded under *Documentation drift* below.
- Repo is **PUBLIC**: fork PRs get a read-only token and **no secrets**, so an
  `OPENROUTER_API_KEY`-dependent review cannot run on them at all.
- `gh api .../labels` returns nine labels, all GitHub defaults (`bug`, `documentation`, `duplicate`,
  `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`). **No `ai-cr:*`
  label exists** — a `labeled` trigger cannot fire until they are created.

#### 7e. YAML has no safety net anywhere

| Layer | Covers `*.yml`? | Evidence |
| --- | --- | --- |
| lint-staged | No | `package.json:74-81` — only `*.{ts,tsx,astro}` and `*.{json,css,md}` |
| husky | No | `.husky/pre-commit:1` is just `npx lint-staged` |
| prettier | Not automatically | `.prettierrc.json` has no yaml override; `npm run format` is manual and not in CI |
| eslint | No | `eslint.config.js:15,42,63` — no yaml plugin |
| CI | No | no yaml-lint step in `ci.yml` |
| actionlint | **Not installed** | `command -v actionlint` → absent; zero hits in `.github/` |

A typo'd `secrets.X`, a bad `uses:` ref, or malformed indentation reaches `master` with zero feedback.

### 8. The five blocking categories, grounded in this repo

Only two app tables exist: `flashcards` and `account_deletions`
(`src/db/database.types.ts:37`, `:52`).

| Category | Surface here? | Where it lives | Signal in a diff |
| --- | --- | --- | --- |
| 1. GDPR retention/deletion | **Yes** (deletion); **no** (export) | `src/pages/api/cron/purge.ts:33-34,50,71-113`; cascade at `supabase/migrations/20260624185919_create_flashcards.sql:13` | A new user-scoped table without `on delete cascade` — the cascade *is* the purge; `RETENTION_DAYS` changed in `purge.ts:33` but not `src/components/account/AccountView.tsx:22`; removal of the compensating re-insert at `purge.ts:97-99` |
| 2. Authorization / ownership | **Yes, dense** | `src/middleware.ts:4` (pages only — never matches `/api/**`); RLS at `20260702154817_optimize_pending_deletion_rls.sql:15-38` | A new `src/pages/api/` route without the `getUser()` → `401` triple; **`createAdminClient()` imported anywhere but `purge.ts:3`**; an UPDATE policy with `using` but no `with check` |
| 3. Secret / PII egress | **Yes** | `src/pages/api/auth/signin.ts:16` and `signup.ts:16` (`?error=` redirect); the only four `console.*` in `src/`, all in `purge.ts:62,81,102,117` | A new `console.*` without its `eslint-disable` justification; `fail(status, code)` swapped for `{error: err.message}`; the submitted email appended to the `?error=` URL |
| 4. Unsurfaced destructive failure | **Yes** | `purge.ts:122-124` (`errors > 0 → 500`); `.github/workflows/purge.yml:25` (`curl -fsS`) | Reverting `purge.ts:122-124` to an unconditional 200; dropping `-f` from the curl, which is what makes the 500 actionable |
| 5. Consent / suppression / unsubscribe | **No surface at all** | — | — |

**Category 5 does not exist in this repository.** The app sends no mail of its own (the only mail is
Supabase GoTrue's confirmation, `src/pages/auth/confirm-email.astro:15-16`); there is no consent or
preferences table; grep for `consent`/`unsubscribe`/`suppress`/`opt-out`/`marketing` across `src/` and
`supabase/migrations/` returns nothing. The **export** half of category 1 is likewise absent — no route
produces a download. Both should be scored `n/a` unless a diff introduces the surface.

**Category 4's worked example is real and recorded.**
`context/archive/2026-07-02-account-deletion/reviews/impl-review.md:23-35` (F1, decision **FIXED**):
*"the route returns `200 {deleted, skipped}` regardless of `errors`, so the GitHub Action's `curl -fsS`
succeeds even when a user failed to delete. That user … is silently retained past the 30-day GDPR
window."* The current shape is `purge.ts:122-124`. This is precisely `requirements.md:139-146`'s
argument for named categories: the numeric gate would have scored it a 6 and passed it.

**Existing compliance tests worth knowing** (they are the regression guards a reviewer should not
duplicate): `tests/unit/risk4-purge-partial-failure-hermetic.test.ts:22` (the direct F1 guard, asserts
500 + `{deleted:1, skipped:0, errors:1}`), `tests/unit/risk9-purge-claim-hermetic.test.ts:71`
(guards the re-insert), `tests/integration/risk6-generation-error-hygiene.test.ts:40-56` (the **only**
automated error-body hygiene guard, and it covers `generate.ts` alone),
`tests/integration/risk1-api-route-ownership.test.ts:71,99,128`,
`tests/integration/risk3-idor-not-found-equivalence.test.ts:57,83,109`.

**Standing blind spot** recorded at
`context/archive/2026-07-05-testing-authorization-input-boundary-hardening/research.md:264-274`:
ownership is RLS-only — no route adds `.eq("user_id", user.id)` — so *"if any handler ever used a
non-session-bound client (e.g. service-role), the '0 rows ⇒ RLS hid it' assumption would silently stop
holding."* That makes `createAdminClient()` appearing outside `purge.ts` a category-2 block with no
visible change at the query itself.

### 9. Toolchain constraints that will bite the implementer

From `packages/code-review/tsconfig.json` and `eslint.config.js`:

- **`restrict-template-expressions` is configured `allowNumber: false`**
  (`node_modules/@typescript-eslint/eslint-plugin/dist/configs/flat/strict-type-checked.js:106-116`,
  overriding the rule's own permissive defaults). So a markdown renderer writing `` `${score}/10` ``
  **is a lint error**. Use `String(score)`. `restrict-plus-operands` blocks `"Score: " + score` too.
  Encoding D from §4 sidesteps this entirely, since scores are already strings.
- **`allowImportingTsExtensions`** (`tsconfig.json:11`) — every relative import carries `.ts`.
- **`verbatimModuleSyntax`** (`:10`) — type-only imports need `import type`.
- **`noUncheckedIndexedAccess`** (`:9`) — `arr[0]` is `T | undefined`, and
  `no-non-null-assertion` bans the obvious escape. `Object.values(scores)` is the ergonomic route.
- **No build step.** Scripts are `start`/`dev`/`test`/`typecheck`/`lint`/`lint:fix` only; `noEmit: true`;
  runtime is `tsx`.
- **Vitest does not typecheck** — a type error in a test file runs green under `npm test` and only
  surfaces under `npm run typecheck`. Run both.
- **`packages/code-review/vitest.config.ts` must not be deleted.** It is an empty `defineConfig({})`
  whose sole job is to shadow the repo-root config, whose `globalSetup` does not exist here — without
  it the run dies with `ERR_LOAD_URL` (`vitest.config.ts:3-10`,
  `context/archive/2026-08-14-tool-loop-agent/reviews/impl-review.md:89`).

### 10. Where the verdict must live

`installed-versions.ts` is the only module touching the filesystem and `model.ts` the only one reading
env (`context/archive/2026-08-14-tool-loop-agent/plan.md:75`). Dependency direction is strictly one-way,
`cli → index → agent → {...}`; nothing imports `cli.ts`.

A structural point the plan should state explicitly: **if `verdict` is a field in `reviewSchema`, the
model authors its own verdict, which defeats "derived mechanically" (`requirements.md:121-122`).** The
verdict must be computed from the scores in code — a `deriveVerdict(scores): Verdict` in
`src/agents/reviewer/verdict.ts`, called from `cli.ts` — and must **not** appear in the schema handed
to `Output.object`.

## Code References

- `packages/code-review/src/cli.ts:13-19,25,27-31,35-39` — stdin-only input, exit-code semantics
- `packages/code-review/src/agents/reviewer/agent.ts:20-24,31-37` — the three-option SDK call; `cwd` seam
- `packages/code-review/src/agents/reviewer/schema.ts:3-13` — current output shape
- `packages/code-review/src/agents/reviewer/prompts.ts:2-9,15-21` — instructions and prompt assembly
- `packages/code-review/src/providers/model.ts:5-8` — env schema, default model id
- `packages/code-review/tests/integration/agent.test.ts:38-52` — the injection guard
- `packages/code-review/tests/unit/schema.test.ts:19-25,27-29` — the four tests that go vacuous
- `packages/code-review/tests/unit/prompts.test.ts:20` — the one strict prompt equality
- `.github/workflows/ci.yml:13,54,55,83` — checkout defaults; `needs: ci`; the only `if:`; the redaction `sed`
- `.github/workflows/purge.yml:25-27` — direct secret interpolation into `run:` (the weaker pattern)
- `.gitignore:51` — the `.github/**/10x-*` trap
- `src/pages/api/cron/purge.ts:97-99,122-124` — the compensating re-insert and the `errors > 0` gate
- `src/middleware.ts:4,18-24` — page-only route protection; never matches `/api/**`
- `src/lib/supabase-admin.ts:11-18` — the only service-role client
- `src/pages/api/auth/signin.ts:16` — the `?error=` URL sink
- `AGENTS.md:44,47,51-55,59-61` — branch note (stale), CI coverage, package verification commands

## Architecture Insights

- **The gate is a transcription problem, not a design problem.** `requirements.md:119-160` defines it
  exhaustively. The only genuine design decisions left are the score *encoding* (§4) and where the
  verdict is computed (§10) — everything else is copying.
- **Two competing secret patterns exist in this repo.** `ci.yml:57-60` uses a job-level `env:` block;
  `purge.yml:25-27` interpolates `${{ secrets.X }}` straight into a `run:` body. The former is newer
  and safer (no secret in the rendered shell command). The recorded rule is stronger still:
  *"the safe pattern is piping a value directly from its source … never through an intermediate file
  or a display step"* (`context/archive/2026-07-09-ci-pipeline-warnings-cleanup/plan.md:120-124`).
- **Job-vs-step is a policy decision, not a style one.** *"Placing the e2e step inside the existing `ci`
  job … means it inherits whatever required-status-check configuration already applies to `ci`"*
  (`context/archive/2026-07-08-testing-quality-gates-wiring/plan.md:19`). The single required check on
  `master` is named `ci`. But `AGENTS.md:61` says a package that stops being throwaway *"needs its own
  CI **job**"* — and a new job is not blocking until branch protection is edited by hand. These two
  recorded rules point in opposite directions; the plan must pick one and name the tradeoff.
- **`needs:` does not propagate `if:`.** *"GitHub Actions does not propagate `if:` through `needs:`"*
  (`ci-pipeline-warnings-cleanup/plan.md:126-130`). Any new job gated on `pull_request` carries its own
  condition.
- **A composite action is the warning-free shape.** The repo already migrated *to* composite for
  exactly this reason — `supabase/setup-cli@v2` is *"a full rewrite to a Bun-based composite action …
  no Node runtime declaration at all, so the deprecation warning cannot fire"*
  (`context/archive/2026-07-05-node20-depracation-ci-fix/plan.md:9-10`). A `node20` JS action would
  reintroduce the class of warning a whole change was spent eliminating.
- **A zero-warnings-in-CI invariant exists and is actively maintained** (`node20-depracation-ci-fix`,
  then `ci-pipeline-warnings-cleanup`), and the sanctioned verification is a live PR run inspected via
  `gh api .../check-runs/{id}/annotations` — not local simulation.
- **Action versions are bumped reactively only.** *"Not auditing or bumping other actions … none are
  flagged, and doing so would expand scope"* (`node20-depracation-ci-fix/plan.md:29`). New files use
  current pins; `ci.yml`'s existing `uses:` lines stay untouched.

## Historical Context (from prior changes)

- `context/archive/2026-08-14-tool-loop-agent/plan.md:59` — *"**No CI wiring** … changing that is a
  separate decision."* **This change is that decision**, so there is no precedent step to copy.
- `context/archive/2026-08-14-tool-loop-agent/plan.md:58` — *"no build step, no `dist/`."* The action
  must run from source via `tsx`, after an `npm ci` inside `packages/code-review`.
- `context/archive/2026-08-14-tool-loop-agent/plan.md:52` — promptfoo/eval explicitly out of scope, and
  still is. Any success criterion phrased as "review quality is good" is unperformable.
- `context/archive/2026-08-14-tool-loop-agent/plan.md:56` — *"No prompt rewriting … Review quality is
  deliberately held constant so that any later quality change is attributable to the prompt edit."*
  This change **will** rewrite the prompt; that baseline is being spent deliberately, and it is worth
  isolating the rubric edit in its own commit.
- `context/archive/2026-08-14-tool-loop-agent/plan.md:169` and `plan-brief.md:26` — exit codes encode
  **tool failure only**, never review outcome. Making exit 1 mean "the gate failed" would make CI unable
  to distinguish a found bug from a dead API key. The already-triaged `reviews/plan-review.md:41-46,62`
  resolves this with a third action-level `error` state.
- `context/archive/2026-07-08-testing-quality-gates-wiring/plan.md:36` — branch protection requiring the
  `ci` check was configured live, with explicit consent. Current protection state is **unverified** here.
- `context/archive/2026-07-09-ci-pipeline-warnings-cleanup/plan.md:83-85` — no staging environment, and
  moving secrets to Environment scope silently breaks jobs lacking an `environment:` key.
- `AGENTS.md:47` — *"CI covers the root app only … a green CI says nothing about those packages."*
  This sentence becomes wrong the moment a package step lands and must be updated by this change.

### Open debt that lands here

**PENDING** — `context/archive/2026-08-14-tool-loop-agent/reviews/impl-review.md:69-77` (F4):
*"`allowImportingTsExtensions` … is a durable constraint, not a passing detail: with `.ts` specifiers
baked into every import, the package cannot emit JS later without rewriting all of them."* The
prescribed fix is a note in Migration Notes, and it was never applied. Since
`AGENTS.md:65` makes `context/archive/` immutable, the note must be carried forward into this change's
plan or into `AGENTS.md`. Practical effect: any idea of bundling a `dist/` into the action to avoid
`npm ci` + `tsx` on every PR requires a package-wide import rewrite first.

## Corrections to prior artifacts

1. **Superseded `research.md:135-137`** claimed `stopWhen` defaults to `stepCountIs(1)`. For
   `ToolLoopAgent` it is `isStepCount(20)` (`node_modules/ai/src/agent/tool-loop-agent.ts:132`);
   `isStepCount(1)` is the `generateText` default. Behaviorally identical with zero tools, but the note
   would mislead whoever adds the first tool.
2. **`plan.md:205`** commits to score encoding A without accounting for OpenRouter's `strict: true`
   default. See §4 — this is the highest-risk unexamined assumption in the plan.
3. **`plan.md` has no phase setting `temperature: 0`**, which undercuts the Phase 5 calibration replay
   it schedules (`plan.md:715-805`): scores are currently free to vary by sampling between runs.
4. **`reviews/plan-review.md:114-118` (F4)** named the merge-blocking cost of the `ci.yml` package step
   but not the deploy-blocking one — `deploy` has `needs: ci` (`.github/workflows/ci.yml:54`).

## Documentation Drift Found

- **`AGENTS.md:44`** — *"the default branch here is `main` but CI targets `master`"*. The live API says
  the default branch **is `master`** (`gh repo view` output in §7d). The warning is stale and should be
  deleted or corrected.
- **`AGENTS.md:47`** — *"Nothing under `packages/` is installed, linted, type-checked, built or tested
  by the pipeline"*. Becomes false the moment this change lands a package step.
- **`scripts/verify-rls.mjs` is not wired into `package.json` scripts** — it was superseded by
  `tests/integration/risk1-rls-isolation.test.ts:12` ("ported from scripts/verify-rls.mjs"). A diff
  citing it as verification is citing something CI never runs.

## Related Research

- `context/archive/2026-08-14-tool-loop-agent/research.md` — the package's own design research
- `context/archive/2026-07-08-testing-quality-gates-wiring/research.md:66,146` — required-check naming
- `context/archive/2026-07-05-testing-authorization-input-boundary-hardening/research.md:264-274` — the
  RLS-only ownership blind spot
- Superseded predecessor of this document, preserved outside the repo at
  `scratchpad/research-2026-08-14-superseded.md`

## Open Questions

1. **Does encoding A survive `strict: true` on the current model?** One live call answers it. Until
   then, encoding D is the choice that needs no answer. *(Blocking for Phase 1.)*
2. **Job or step for the package CI?** `AGENTS.md:61` says job; `testing-quality-gates-wiring/plan.md:19`
   says only a step inside `ci` is enforced. And a step inside `ci` blocks production deploys via
   `needs: ci`. Three-way tradeoff, unresolved.
3. **Is `master` branch protection still configured?** Recorded as configured on 2026-07-08; not
   re-queried here. Determines whether "advisory" is a real property or an accident.
4. **Can `claude-haiku-4.5` carry this rubric?** Six anchored criteria plus a classify-then-score
   procedure plus a self-check is a real instruction-following load for a small model. The five-PR
   replay is where this gets answered; budget for the answer being "use Sonnet", which
   `OPENROUTER_MODEL` makes a one-line change.
5. **What happens to the two dead blocking categories?** Consent/suppression and GDPR-export have no
   surface here. Keep them for forward-compatibility, or drop them and shrink the prompt?
6. **Fork PRs get no secrets on a PUBLIC repo.** Skip with an explanatory comment, or accept no review?
   `requirements.md:3` says "every new pull request" and this is a hard platform limit, not a choice.
