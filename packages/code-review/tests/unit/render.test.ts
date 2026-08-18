import { describe, expect, it } from "vitest";

import { COMMENT_MARKER, renderMarkdown } from "../../src/agents/reviewer/render.ts";
import type { Review } from "../../src/agents/reviewer/schema.ts";
import { deriveVerdict, explainVerdict } from "../../src/agents/reviewer/verdict.ts";

const criteria: Review["criteria"] = {
  correctness: { score: "4", note: "Off-by-one ships in the changed loop." },
  idiomaticity: { score: "8", note: "Matches surrounding code." },
  complexity: { score: "9", note: "Minimal and direct." },
  testCoverage: { score: "n/a", note: "Config-only change; the pipeline run is the test." },
  documentation: { score: "6", note: "The bound change is unexplained." },
  security: { score: "8", note: "No trust boundary crossed." },
};

const review: Review = {
  summary: "One real defect in the changed lines.",
  criteria,
  findings: [
    {
      file: "src/cart.ts",
      line: 5,
      severity: "error",
      message: "Off-by-one in the loop bound.",
      blockingCategory: null,
    },
    { file: "src/log.ts", line: 9, severity: "info", message: "Noisy log line.", blockingCategory: null },
    {
      file: "src/purge.ts",
      line: 12,
      severity: "warning",
      message: "Returns 200 even when the hard delete failed.",
      blockingCategory: "data-retention",
    },
  ],
};

const render = (input: Review) => renderMarkdown(input, deriveVerdict(input));

describe("renderMarkdown", () => {
  it("starts with the sticky-comment marker", () => {
    expect(render(review).startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("names the verdict", () => {
    expect(render(review)).toContain("failed");
    expect(
      render({ ...review, criteria: { ...criteria, correctness: { score: "9", note: "Fine." } }, findings: [] }),
    ).toContain("passed");
  });

  it("lists every criterion with its score and note", () => {
    const markdown = render(review);

    for (const [label, note] of [
      ["implementation correctness", criteria.correctness.note],
      ["idiomaticity", criteria.idiomaticity.note],
      ["complexity", criteria.complexity.note],
      ["test / risk coverage", criteria.testCoverage.note],
      ["documentation", criteria.documentation.note],
      ["security and safety", criteria.security.note],
    ]) {
      expect(markdown).toContain(label);
      expect(markdown).toContain(note);
    }
  });

  it("renders n/a as n/a, never as a number or a blank cell", () => {
    const markdown = render(review);

    expect(markdown).toMatch(/test \/ risk coverage \| n\/a/);
    expect(markdown).not.toContain("| 0 |");
  });

  it("substitutes a placeholder for an empty note", () => {
    const markdown = render({ ...review, criteria: { ...criteria, complexity: { score: "7", note: "" } } });

    expect(markdown).toContain("— no justification given");
  });

  it("lists every gate condition that fired on a failed verdict", () => {
    const markdown = render(review);

    for (const reason of explainVerdict(review)) {
      expect(markdown).toContain(reason);
    }
  });

  it("carries no reasons section when the verdict passes", () => {
    const passing: Review = {
      ...review,
      criteria: { ...criteria, correctness: { score: "9", note: "Fine." } },
      findings: [],
    };

    expect(render(passing)).not.toContain("Gate conditions");
  });

  it("calls blocking-category findings out ahead of the severity groups", () => {
    const markdown = render(review);

    expect(markdown.indexOf("data-retention")).toBeLessThan(markdown.indexOf("Off-by-one in the loop bound."));
    expect(markdown).toContain("src/purge.ts:12");
  });

  it("anchors ordinary findings to file and line, grouped by severity", () => {
    const markdown = render(review);

    expect(markdown).toContain("src/cart.ts:5");
    expect(markdown).toContain("src/log.ts:9");
    expect(markdown.indexOf("Off-by-one in the loop bound.")).toBeLessThan(markdown.indexOf("Noisy log line."));
  });

  it("renders no findings section at all when there are none", () => {
    const markdown = render({ ...review, findings: [] });

    expect(markdown).not.toContain("Findings");
    expect(markdown).toContain(review.summary);
  });
});
