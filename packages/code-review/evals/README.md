# Model sweep for the code reviewer

This directory runs the **same review prompt across three models** against one hard fixture
and scores each model on whether it found each planted flaw. It is a decision-support tool,
not a CI gate: read its output when you are choosing a model or considering a prompt edit.

Nothing here runs in CI. The `code-review-package` job still runs exactly
`lint → typecheck → test`, and `vitest.config.ts` excludes `evals/**` so no file added here
can ever join `npm test` and make billed calls in a job that has no API key.

## Running it

```bash
cd packages/code-review
npm run eval
```

which is:

```bash
npx -y promptfoo@0.122.0 eval -c evals/promptfooconfig.yaml \
  -o evals/out/results.csv -o evals/out/results.json
```

Requires `OPENROUTER_API_KEY` — the same variable the package already uses. promptfoo picks
it up from `.env` in the package directory, and it pays for **both** the three candidate
models and the judge. **This run costs real money every time.** promptfoo's disk cache wraps
its own HTTP client and never fires for a custom provider, so a second identical run
re-executes every call in full.

`promptfoo` is deliberately **not** a dependency of this package. It is 500–825 transitive
packages / ~1.7 GB, and `--omit=optional` makes it refuse to start (missing
`@libsql/<platform>`). It runs via a pinned `npx` instead. Nothing under `evals/` imports
promptfoo — `provider.ts` declares the two interfaces it needs locally — so typecheck and
lint work without it installed.

The eval exits non-zero whenever any assert fails. With all-must-pass semantics a
three-model sweep will usually have at least one model missing at least one flaw, so **the
exit code is not the signal — the CSV is.**

## What is being measured

One fixture: `fixtures/react19-migration.diff`, a React 16 → 19 component migration with
three planted flaws buried in otherwise-correct migration work. `fixtures/react19-migration.flaws.ts`
is the single source of truth for what was planted and carries the rubric text used verbatim
in `promptfooconfig.yaml`.

Six metrics per model:

| Metric              | Kind          | Asks                                                           |
| ------------------- | ------------- | -------------------------------------------------------------- |
| `verdict`           | deterministic | Does the mechanical gate actually fail on this review?         |
| `anchors`           | deterministic | Does every finding point at a file that is really in the diff? |
| `flaw_cleanup`      | LLM judge     | Was the dropped `useEffect` cleanup reported?                  |
| `flaw_authz`        | LLM judge     | Was the removed owner check reported?                          |
| `flaw_defaultprops` | LLM judge     | Was `defaultProps` on a function component reported?           |
| `precision`         | LLM judge     | Does every finding describe a defect the diff actually has?    |

The judge is `openrouter:openai/gpt-5` at `temperature: 0` — a vendor none of the three
candidates share.

## Costs (OpenRouter, per 1M tokens, verified 2026-08-19)

The harness does not measure cost: `reviewDiff` discards `usage`, so per-review spend is not
available without changing the package's public surface. Do the math by hand:

| Model                        | Input  | Output |
| ---------------------------- | ------ | ------ |
| `anthropic/claude-haiku-4.5` | $1.00  | $5.00  |
| `z-ai/glm-5.1`               | $0.97  | $3.04  |
| `deepseek/deepseek-v4-flash` | $0.083 | $0.165 |
| `openai/gpt-5` (judge)       | $1.25  | $10.00 |

Per full run: 3 review calls (~2–4k input tokens each — the fixture plus a ~1.6k-token
system prompt) and 12 judge calls (4 rubrics × 3 models). Total well under a dollar.

## Reading the results

**Read the CSV.** `evals/out/results.csv` carries one `Metric: <name>` column per metric per
labelled provider. That is the intended read and the only clean per-metric artifact —
`junit.xml` carries no metric data at all.

If you go into `results.json`, the two `namedScores` shapes are easy to confuse:

- `results.results[i].namedScores` — **raw per-run values**. This is what you want.
- `results.prompts[i].metrics.namedScores` — **weight-multiplied sums** across tests and
  repeats, not means. Divide by the matching `namedScoreWeights` entry to get a mean.

**Rule out a dead judge before believing an all-zero row.** A grader transport failure (401,
rate limit, model unavailable) presents as an ordinary assertion failure scoring 0. The only
signal is `metadata.graderError: true`. Any run where one model scores 0 on all four rubrics
should be checked for it first — three "bad models" and one dead judge look identical.

**`metadata.renderedGradingPrompt`** holds the exact text sent to the judge for every
model-graded component. It is the audit trail when a rubric misfires, and the place to start
when calibrating rubric wording.

## Diagnostics

```bash
node --env-file-if-exists=.env --import tsx evals/check-fixture.ts
```

pipes the fixture through `reviewDiff` once with the incumbent model and prints the parsed
review plus the derived verdict. No promptfoo involved — use it when a sweep failure might be
a fixture or prompt problem rather than a harness problem.

## Adding a fixture: the Nunjucks trap

**A `.diff` fixture must not contain `{{` or `{%`.** promptfoo renders a `file://` var's
contents through Nunjucks before handing them to the provider, so those sequences are parsed
as template syntax, not as code. Hit during Phase 3 with a perfectly ordinary JSX line —

```jsx
render(<DeckSettingsPanel deck={deck} currentUser={{ id: "user-2" }} />);
```

— which failed all three providers with `Template render error: expected variable end` before
a single model was called. The same trap is waiting in any Vue, Angular, Handlebars or Jinja
diff.

The fix used here was to hoist the inline object to a named const, which keeps the file a
valid unified diff. `{% raw %}` would also work but would have to live inside the `.diff`
itself and would break `git apply`. Check a new fixture with:

```bash
grep -n '{{\|{%' evals/fixtures/<name>.diff   # must print nothing
```

## Known knobs, deliberately not turned

- `--repeat 3` averages out run-to-run variance. It triples the bill; one run per model is
  the current setting.
- A clean-diff (true-negative) case would measure false-positive rate directly. There is one
  fixture today, and `src/main.jsx` inside it is the only false-positive bait.
- A test-level `threshold` would silently absorb hard assert failures into a weighted mean.
  It is deliberately absent — the thresholds live on the individual `llm-rubric` asserts.
