/**
 * Keyless guards for the eval harness. Nothing here calls a model, so it runs in the
 * `code-review-package` CI job exactly like every other unit test — see the `evals/**`
 * exclusion in vitest.config.ts, which this file deliberately sits outside of.
 *
 * Two jobs:
 *  1. The two deterministic asserts are pure functions with real edge cases. Every path that
 *     reaches score 0 for a *harness* reason must say so, or a config typo reads as a model
 *     failure across the whole sweep.
 *  2. `flaws.ts` claims to be the single source of truth for the rubric text, but promptfoo
 *     reads YAML, so the invariant is transcription-by-hand. A drifted rubric still scores —
 *     it just silently judges something else. This asserts the two copies are identical.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import assertAnchors from "../../evals/asserts/anchors.ts";
import assertVerdict from "../../evals/asserts/verdict.ts";
import { EXPECTED_VERDICT, PLANTED_FLAWS } from "../../evals/fixtures/react19-migration.flaws.ts";
import type { Review } from "../../src/agents/reviewer/schema.ts";

const DIFF = ["diff --git a/src/app.ts b/src/app.ts", "--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1 +1 @@", "+x"].join(
  "\n",
);

function reviewWith(findings: Review["findings"]): Review {
  const criterion = { score: "9", note: "…" } as Review["criteria"]["defect"];
  return {
    summary: "…",
    criteria: {
      defect: criterion,
      safety: criterion,
      blastRadius: criterion,
      verification: criterion,
      clarity: criterion,
    },
    findings,
  };
}

const blocking: Review["findings"] = [
  { file: "src/app.ts", line: 1, severity: "warning", message: "…", blockingCategory: "data-retention" },
];

describe("assertVerdict", () => {
  it("passes when the derived verdict matches the expected one", () => {
    const result = assertVerdict(reviewWith(blocking), { vars: { expected_verdict: "failed" } });
    expect(result).toMatchObject({ pass: true, score: 1 });
  });

  it("blames the model, not the harness, when the gate does not trip", () => {
    const result = assertVerdict(reviewWith([]), { vars: { expected_verdict: "failed" } });
    expect(result.pass).toBe(false);
    expect(result.reason).not.toContain("HARNESS ERROR");
    expect(result.reason).toContain("did not trip the gate");
  });

  // A one-word YAML typo used to fail a weight-2 assert on every model with the reason
  // "the fixture's planted defects did not trip the gate".
  it.each([undefined, "Failed", 1, null])("names the harness when expected_verdict is %p", (expected) => {
    const result = assertVerdict(reviewWith(blocking), { vars: { expected_verdict: expected } });
    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain("HARNESS ERROR");
  });

  // `typeof null === "object"`, so the old guard let null through to `"criteria" in output`.
  it.each([null, undefined, "a string", { findings: [] }])("names the harness for output %p", (output) => {
    const result = assertVerdict(output, { vars: { expected_verdict: "failed" } });
    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain("HARNESS ERROR");
  });
});

describe("assertAnchors", () => {
  it("scores 1 when every finding anchors to a file in the diff", () => {
    const result = assertAnchors(reviewWith(blocking), { vars: { diff: DIFF } });
    expect(result).toMatchObject({ pass: true, score: 1 });
  });

  it("scores the fabricated fraction and names the files", () => {
    const [anchored] = blocking;
    const findings = anchored === undefined ? blocking : [...blocking, { ...anchored, file: "src/ghost.ts" }];
    const result = assertAnchors(reviewWith(findings), { vars: { diff: DIFF } });
    expect(result).toMatchObject({ pass: false, score: 0.5 });
    expect(result.reason).toContain("src/ghost.ts");
  });

  it("blames the model for an empty review", () => {
    const result = assertAnchors(reviewWith([]), { vars: { diff: DIFF } });
    expect(result.pass).toBe(false);
    expect(result.reason).not.toContain("HARNESS ERROR");
  });

  // A fixture regenerated with `--no-prefix` (or plain `diff -u`) has no `+++ b/` headers, so
  // every finding counts as fabricated — indistinguishable from total hallucination.
  it("names the harness when the diff carries no b/-prefixed paths", () => {
    const result = assertAnchors(reviewWith(blocking), { vars: { diff: DIFF.replaceAll("b/", "") } });
    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain("HARNESS ERROR");
  });

  it.each([undefined, 42, null])("names the harness when vars.diff is %p", (diff) => {
    const result = assertAnchors(reviewWith(blocking), { vars: { diff } });
    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain("HARNESS ERROR");
  });

  it.each([null, "a string", {}])("names the harness for output %p", (output) => {
    const result = assertAnchors(output, { vars: { diff: DIFF } });
    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain("HARNESS ERROR");
  });
});

describe("promptfooconfig.yaml transcription", () => {
  const config = readFileSync(path.join(import.meta.dirname, "../../evals/promptfooconfig.yaml"), "utf8");

  /**
   * Pulls one `value: |` block scalar out of the YAML by indentation, so the comparison is
   * against the exact text the judge receives. Hand-rolled rather than parsed: adding a YAML
   * dependency to this package to read one file is not worth the surface.
   */
  function blockScalarAfter(metric: string): string {
    const lines = config.split("\n");
    const start = lines.findIndex((line) => line.trim() === `metric: ${metric}`);
    expect(start, `metric: ${metric} not found in promptfooconfig.yaml`).toBeGreaterThan(-1);

    const valueAt = lines.findIndex((line, index) => index > start && line.trim() === "value: |");
    expect(valueAt, `no "value: |" after metric: ${metric}`).toBeGreaterThan(start);

    const indent = /^ */.exec(lines[valueAt + 1] ?? "")?.[0].length ?? 0;
    const body: string[] = [];
    for (const line of lines.slice(valueAt + 1)) {
      if (line.trim() !== "" && !line.startsWith(" ".repeat(indent))) {
        break;
      }
      body.push(line.slice(indent));
    }
    return body.join("\n").trimEnd();
  }

  it.each(PLANTED_FLAWS)("$metric rubric matches flaws.ts verbatim", (flaw) => {
    expect(blockScalarAfter(flaw.metric)).toBe(flaw.rubric.trimEnd());
  });

  it("expected_verdict matches EXPECTED_VERDICT", () => {
    const match = /^\s*expected_verdict:\s*(\S+)\s*$/m.exec(config);
    expect(match?.[1]).toBe(EXPECTED_VERDICT);
  });
});
