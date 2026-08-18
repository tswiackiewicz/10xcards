---
change_id: ci-cd-code-review
title: Introduce first CI/CD workflow for PR code reviews
status: implementing
created: 2026-08-14
updated: 2026-08-18
archived_at: null
---

## Notes

introducing first ci/cd workflow for pr code reviews

## Calibration record — 2026-08-18

Five merged PRs replayed through the implemented CLI with the workflow's own pathspec
(`git diff --merge-base <base> <head> -- . ':(exclude)context/**'`), each with its real PR
title and body. Model: `anthropic/claude-haiku-4.5` at `temperature: 0`.

| PR  | Diff (post-exclusion) | Hand-scored | Replay | Scores (corr/idio/cplx/test/docs/sec) | Findings |
| --- | --------------------- | ----------- | ------ | ------------------------------------- | -------- |
| #1  | 2.6 KB                | passed      | passed | 10 / 10 / 10 / **n/a** / 10 / 10      | 0        |
| #6  | 1.2 KB                | passed      | passed | 10 / 10 / 10 / **n/a** / 10 / 10      | 0        |
| #3  | 10.1 KB               | failed      | passed | 9 / 9 / 9 / 5 / 8 / 10                | 1        |
| #5  | 34.8 KB               | passed      | failed | 8 / 9 / 9 / 9 / 9 / 7                 | 4 (1 blocking) |
| #7  | 82.6 KB               | failed      | passed | 10 / 9 / 10 / **n/a** / 10 / 10       | 1        |

**The load-bearing amendment holds.** Both `chore` PRs score `test / risk coverage` as
`n/a`, not a low number — the exact case `requirements.md:100-104` says the whole gate
depends on. Scored as a 3 they would have failed on condition 2.

**Three divergences, none of them systematic.** The failure modes the plan named as real
defects — every criterion scoring high, `n/a` never appearing, the blocking-category field
never populated — did not occur: `n/a` appears on three of five, scores span 5-10, and a
blocking category did fire.

- **#3 (failed → passed).** The baseline was a recorded false positive (no test
  infrastructure existed at that commit). The replay scored `testCoverage` 5 with a note
  naming the missing tests, which trips no condition. Arguably better than the baseline.
- **#5 (passed → failed).** A `data-retention` tag on the purge route: "purge failures
  return 500 but rely on `curl -fsS` to surface the error; if the Actions job fails to
  report, a missed purge silently retains user data past the 30-day window." The concern is
  real but the failure path is speculative — `requirements.md:159-160` says that is a low
  score, not a tag. This is the model under-applying the "concrete and located" bar, and it
  is the one calibration finding worth watching.
- **#7 (failed → passed).** `testCoverage` scored `n/a` with the note "the tool makes real
  paid API calls and is not wired into CI" — coherent reasoning, but wrong: the PR added 15
  tests. The baseline expected `correctness` and `testCoverage` to fire.

**Determinism confirmed.** PR #3 replayed twice produced a byte-identical `criteria` object
and verdict, so `temperature: 0` is in effect.

**Keep the model.** `anthropic/claude-haiku-4.5` carries the rubric: it uses the eleven-value
enum correctly, places `n/a` where the default cases say it should, populates
`blockingCategory`, and never tagged `consent-handling` (a category with no surface in this
repo). Its bias is generous scores plus occasional over-tagging of blocking categories —
both cheap to live with under `requirements.md:135-137`'s "a false failed costs one retry".
Escalate to a Sonnet-class model via `OPENROUTER_MODEL` only if the over-tagging turns out
to fire on more than the odd PR.

### Size-cap calibration

| Constant          | Setting   | Largest observed        | Verdict |
| ----------------- | --------- | ----------------------- | ------- |
| `MAX_DIFF_BYTES`  | 400,000   | 82,567 B (PR #7)        | Keep — ~4.8x headroom; only a deliberately generated 512 KB fixture ever tripped it |
| `MAX_BODY_CHARS`  | 4,000     | ~1.8 KB (longest body)  | Keep — never reached in practice |

**Output ceiling measured.** The largest real diff (82,567 B / 42,059 input tokens) finished
with `finishReason: "stop"` at 609 output tokens, no `warnings`. `length` never fired.
Output size is roughly flat in diff size — six notes plus a handful of findings — so the
provider's own `max_tokens` default is not a practical risk, which retroactively supports
leaving `maxOutputTokens` unset. Cost signal: ~42k input tokens on the largest review.

