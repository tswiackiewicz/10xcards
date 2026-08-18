import { describe, expect, it } from "vitest";

import type { Review } from "../../src/agents/reviewer/schema.ts";
import {
  ACCUMULATION_COUNT,
  ACCUMULATION_MAX,
  BLOCKING_CRITERIA,
  BLOCKING_MAX,
  deriveVerdict,
  explainVerdict,
  SINGLE_FAIL_MAX,
} from "../../src/agents/reviewer/verdict.ts";

type Score = Review["criteria"]["correctness"]["score"];

/** A review that passes every condition, so each case overrides only what it is about. */
function reviewWith(scores: Partial<Record<keyof Review["criteria"], Score>>, findings: Review["findings"] = []) {
  const criterion = (score: Score) => ({ score, note: "…" });
  return {
    summary: "…",
    criteria: {
      correctness: criterion(scores.correctness ?? "9"),
      idiomaticity: criterion(scores.idiomaticity ?? "9"),
      complexity: criterion(scores.complexity ?? "9"),
      testCoverage: criterion(scores.testCoverage ?? "9"),
      documentation: criterion(scores.documentation ?? "9"),
      security: criterion(scores.security ?? "9"),
    },
    findings,
  } satisfies Review;
}

const blockingFinding: Review["findings"] = [
  {
    file: "src/purge.ts",
    line: 12,
    severity: "warning",
    message: "Returns 200 even when the hard delete failed.",
    blockingCategory: "data-retention",
  },
];

const cases: { label: string; review: Review; verdict: "passed" | "failed" }[] = [
  { label: "a clean review", review: reviewWith({}), verdict: "passed" },

  // Condition 1 — the two blocking dimensions fail on "unproven", at <= BLOCKING_MAX.
  { label: "correctness at the blocking threshold", review: reviewWith({ correctness: "5" }), verdict: "failed" },
  { label: "correctness one above it", review: reviewWith({ correctness: "6" }), verdict: "passed" },
  { label: "security at the blocking threshold", review: reviewWith({ security: "5" }), verdict: "failed" },
  { label: "security one above it", review: reviewWith({ security: "6" }), verdict: "passed" },

  // Condition 2 — any other criterion <= SINGLE_FAIL_MAX.
  {
    label: "documentation at the single-fail threshold",
    review: reviewWith({ documentation: "3" }),
    verdict: "failed",
  },
  { label: "documentation one above it", review: reviewWith({ documentation: "4" }), verdict: "passed" },
  { label: "testCoverage at the single-fail threshold", review: reviewWith({ testCoverage: "3" }), verdict: "failed" },

  // Condition 3 — accumulation, counting all six criteria.
  {
    label: "exactly three criteria at the accumulation threshold",
    review: reviewWith({ idiomaticity: "5", complexity: "5", documentation: "5" }),
    verdict: "failed",
  },
  {
    label: "exactly two criteria at the accumulation threshold",
    review: reviewWith({ idiomaticity: "5", complexity: "5" }),
    verdict: "passed",
  },

  // Condition 4 — a concrete blocking-category finding, whatever the scores say.
  {
    label: "a blocking-category finding with otherwise perfect scores",
    review: reviewWith({ correctness: "10", security: "10" }, blockingFinding),
    verdict: "failed",
  },

  // n/a is excluded from all three numeric conditions.
  {
    label: "n/a on both blocking criteria",
    review: reviewWith({ correctness: "n/a", security: "n/a" }),
    verdict: "passed",
  },
  {
    label: "n/a on three criteria",
    review: reviewWith({ idiomaticity: "n/a", complexity: "n/a", documentation: "n/a" }),
    verdict: "passed",
  },
  {
    label: "an all-n/a review",
    review: reviewWith({
      correctness: "n/a",
      idiomaticity: "n/a",
      complexity: "n/a",
      testCoverage: "n/a",
      documentation: "n/a",
      security: "n/a",
    }),
    verdict: "passed",
  },

  // severity deliberately no longer gates.
  {
    label: "an error-severity finding with no blocking category and passing scores",
    review: reviewWith({}, [
      { file: "src/cart.ts", line: 5, severity: "error", message: "Off by one.", blockingCategory: null },
    ]),
    verdict: "passed",
  },
];

describe("the gate", () => {
  it.each(cases)("returns $verdict for $label", ({ review, verdict }) => {
    expect(deriveVerdict(review)).toBe(verdict);
  });

  it("has reasons exactly when the verdict is failed", () => {
    for (const { label, review } of cases) {
      const failed = deriveVerdict(review) === "failed";
      expect(explainVerdict(review).length > 0, label).toBe(failed);
    }
  });
});

describe("explainVerdict", () => {
  it("names every condition that fired", () => {
    const reasons = explainVerdict(
      reviewWith({ correctness: "5", security: "4", documentation: "2" }, blockingFinding),
    );

    expect(reasons).toHaveLength(4);
    expect(reasons[0]).toContain("correctness");
    expect(reasons[0]).toContain("security");
    expect(reasons[1]).toContain("documentation");
    expect(reasons[2]).toContain("3");
    expect(reasons[3]).toContain("data-retention");
    expect(reasons[3]).toContain("src/purge.ts");
  });

  it("names only the condition that fired", () => {
    expect(explainVerdict(reviewWith({ correctness: "5" }))).toEqual([expect.stringContaining("correctness")]);
  });
});

describe("thresholds", () => {
  it("are the named constants requirements.md pre-authorizes loosening", () => {
    expect([BLOCKING_MAX, SINGLE_FAIL_MAX, ACCUMULATION_MAX, ACCUMULATION_COUNT]).toEqual([5, 3, 5, 3]);
    expect(BLOCKING_CRITERIA).toEqual(["correctness", "security"]);
  });
});
