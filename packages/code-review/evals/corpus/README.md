# Calibration corpus

The five merged PRs the reviewer was originally calibrated against, persisted as fixtures so a
rubric change can be regression-checked instead of hand-scored once. Their absence is what made the
2026-08-18 calibration (`context/archive/2026-08-14-ci-cd-code-review/change.md:14-107`) a one-shot.

Nothing here is wired into CI or into `npm run eval`. This is a hand-run A/B harness; the replay
below spends real money.

## Files

Per PR `n ∈ {1, 3, 5, 6, 7}`:

| File         | Contents                                                            |
| ------------ | ------------------------------------------------------------------- |
| `pr-n.diff`  | The reviewable diff, with the workflow's own `context/**` exclusion |
| `pr-n.title` | PR title, for `--title-file`                                        |
| `pr-n.body`  | PR body, for `--body-file`                                          |
| `pr-n.json`  | `{ number, title, body, handScored, citation, note }`               |

`pr-n.title` and `pr-n.body` are extracted from `pr-n.json` purely so the CLI can be fed without a
`jq` step; the JSON is the record.

## Reconstruction

The diffs are generated, not stored by hand. Each calibration PR is a merge commit, so the
workflow's pathspec reproduces its reviewable diff byte-for-byte:

```bash
declare -A M=( [1]=d155801 [3]=1fd7b1e [5]=12b612f [6]=48fcbd7 [7]=e276ca0 )
for n in 1 3 5 6 7; do
  git diff --merge-base "${M[$n]}^1" "${M[$n]}^2" -- . ':(exclude)context/**' > "pr-$n.diff"
done
```

Titles and bodies come from `gh pr view <n> --json title,body`.

**Expected byte sizes — check these before trusting a replay.** They match the sizes recorded in
`context/archive/2026-08-14-ci-cd-code-review/change.md:19-25`, which is how you know the fixtures
were not hand-edited:

| PR  | Bytes |
| --- | ----- |
| #1  | 2581  |
| #3  | 10129 |
| #5  | 34831 |
| #6  | 1164  |
| #7  | 82567 |

```bash
for n in 1 3 5 6 7; do printf '%s %s\n' "$n" "$(wc -c < "pr-$n.diff")"; done
```

## Hand-scored baseline

`handScored` in each JSON is the baseline verdict from `change.md:19-25`, **with one correction**:
#1 passed, #3 **passed**, #5 passed, #6 passed, #7 failed.

#3's raw baseline was `failed`, but `change.md:37-39` records that verdict as a false positive
itself — no test infrastructure existed at that commit, and the replay's `passed` was "arguably
better than the baseline". Scoring a new rubric against the raw table would penalise correct
behavior on one of five cases. Each JSON carries the citation for its verdict, and #3's carries the
correction, so nobody silently reverts it.

`pr-7.json` additionally carries a `baselineCorrection`: `change.md:46-48` asserts that PR #7 "added
15 tests". It did not — the diff has nine files and no test file. The `failed` baseline stands, but
not for that reason. See `../../docs/criteria.md`, "The `n/a` rule".

## Replay procedure (A/B across two rubrics)

`src/cli.ts` already _is_ the tool, so the A/B is a shell procedure over two worktrees rather than a
new script. That is deliberate: a script typed against the current criterion keys could not run at a
pre-change commit at all, where `Review["criteria"]` has different keys.

```bash
R=$(git rev-parse --show-toplevel)
WT=/tmp/ab
git worktree add "$WT/pre"  <pre-change-commit>
git worktree add "$WT/post" <post-change-commit>

# Standalone package with its own lockfile — a fresh worktree has no node_modules.
# .env is gitignored, so carry it across, or export OPENROUTER_API_KEY instead.
for t in pre post; do
  cp "$R/packages/code-review/.env" "$WT/$t/packages/code-review/.env"
  (cd "$WT/$t/packages/code-review" && npm ci && npm run typecheck && npm test)
done

# Two runs per PR per tree. One reading is not evidence — see below.
for t in pre post; do for n in 1 3 5 6 7; do for run in 1 2; do
  (cd "$WT/$t/packages/code-review" && npm start --silent -- \
     --title-file "$R/packages/code-review/evals/corpus/pr-$n.title" \
     --body-file  "$R/packages/code-review/evals/corpus/pr-$n.body" \
     --cwd "$WT/$t" < "$R/packages/code-review/evals/corpus/pr-$n.diff") \
   > "$WT/$t-pr$n-r$run.json"
done; done; done
```

Then collect `.verdict` and `.review.criteria` from each JSON into a comparison table, and record it
in the change folder.

Four things worth knowing before reading the output:

- **Both trees must be green before any replay call.** An A/B across one broken build is not a
  comparison.
- **`OPENROUTER_MODEL` must resolve to the same value in both trees**, and that value belongs in the
  recorded result. It is read from `.env` via `--env-file-if-exists`.
- **`evals/ground-truth.ts:27-46` falls back to the root `package-lock.json`**, so the React-version
  ground truth still resolves in a worktree that was never built.
- **`agent.ts:14-19` records that the provider ignores `seed`** — "no replay story may be built on
  the seed alone". Read every cell from at least two runs. In practice `temperature: 0` has given
  byte-identical output within a session, but the 2026-08-21 replay found the _same_ rubric
  disagreeing with a three-day-old recorded table on PR #5, so a cited old table is not a valid
  comparison arm. Re-run both.

## Recorded replays

- **2026-08-21**, six criteria vs five: `context/changes/code-review-criteria/change.md`.
