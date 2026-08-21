import { describe, expect, it } from "vitest";

import type { Review } from "../../src/agents/reviewer/schema.ts";
import {
  ACCUMULATION_COUNT,
  ACCUMULATION_MAX,
  BLOCKING_CRITERIA,
  BLOCKING_MAX,
  deriveVerdict,
  explainVerdict,
  SINGLE_FAIL_EXEMPT,
  SINGLE_FAIL_MAX,
} from "../../src/agents/reviewer/verdict.ts";

type Score = Review["criteria"]["defect"]["score"];

/** A review that passes every condition, so each case overrides only what it is about. */
function reviewWith(scores: Partial<Record<keyof Review["criteria"], Score>>, findings: Review["findings"] = []) {
  const criterion = (score: Score) => ({ score, note: "…" });
  return {
    summary: "…",
    criteria: {
      defect: criterion(scores.defect ?? "9"),
      safety: criterion(scores.safety ?? "9"),
      blastRadius: criterion(scores.blastRadius ?? "9"),
      verification: criterion(scores.verification ?? "9"),
      clarity: criterion(scores.clarity ?? "9"),
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

  // Condition 1 — the three blocking dimensions fail on "unproven", at <= BLOCKING_MAX.
  { label: "defect at the blocking threshold", review: reviewWith({ defect: "5" }), verdict: "failed" },
  { label: "defect one above it", review: reviewWith({ defect: "6" }), verdict: "passed" },
  { label: "safety at the blocking threshold", review: reviewWith({ safety: "5" }), verdict: "failed" },
  { label: "safety one above it", review: reviewWith({ safety: "6" }), verdict: "passed" },
  { label: "blastRadius at the blocking threshold", review: reviewWith({ blastRadius: "5" }), verdict: "failed" },
  { label: "blastRadius one above it", review: reviewWith({ blastRadius: "6" }), verdict: "passed" },

  // Condition 2 — any other non-exempt criterion <= SINGLE_FAIL_MAX. With three blocking
  // criteria and clarity exempt, `verification` is the only criterion this applies to.
  {
    label: "verification at the single-fail threshold",
    review: reviewWith({ verification: "3" }),
    verdict: "failed",
  },
  { label: "verification one above it", review: reviewWith({ verification: "4" }), verdict: "passed" },

  // The clarity exemption: unclear code is review feedback, not a merge blocker, so a
  // clarity of 1 on its own must not fail the PR (docs/criteria.md, "Which criteria block").
  { label: "clarity at 1 with everything else at 9", review: reviewWith({ clarity: "1" }), verdict: "passed" },

  // Condition 3 — accumulation, counting all five criteria including clarity. With three
  // blocking criteria, any set of three at <= 5 necessarily includes one of them, so
  // condition 1 fires alongside; explainVerdict below is where clarity's contribution to
  // the accumulation reason is actually pinned.
  {
    label: "exactly three criteria at the accumulation threshold",
    review: reviewWith({ blastRadius: "5", verification: "5", clarity: "5" }),
    verdict: "failed",
  },
  {
    label: "only clarity and verification at the accumulation threshold",
    review: reviewWith({ verification: "5", clarity: "5" }),
    verdict: "passed",
  },

  // Condition 4 — a concrete blocking-category finding, whatever the scores say.
  {
    label: "a blocking-category finding with otherwise perfect scores",
    review: reviewWith({ defect: "10", safety: "10", blastRadius: "10" }, blockingFinding),
    verdict: "failed",
  },

  // n/a is excluded from all three numeric conditions.
  {
    label: "n/a on all three blocking criteria",
    review: reviewWith({ defect: "n/a", safety: "n/a", blastRadius: "n/a" }),
    verdict: "passed",
  },
  {
    label: "n/a on three criteria",
    review: reviewWith({ blastRadius: "n/a", verification: "n/a", clarity: "n/a" }),
    verdict: "passed",
  },
  {
    // Documents a real hole, not an endorsement: an all-n/a review passes because n/a is
    // excluded from every numeric condition and there is no n/a floor. Adding one is a gate
    // mechanics change, explicitly out of scope for the criteria swap — see
    // context/changes/code-review-criteria/research.md and the plan's "What We're NOT Doing".
    // `defect` having no default n/a case (docs/criteria.md) mitigates it partially.
    label: "an all-n/a review",
    review: reviewWith({
      defect: "n/a",
      safety: "n/a",
      blastRadius: "n/a",
      verification: "n/a",
      clarity: "n/a",
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
    const reasons = explainVerdict(reviewWith({ defect: "5", safety: "4", verification: "2" }, blockingFinding));

    expect(reasons).toHaveLength(4);
    expect(reasons[0]).toContain("defect");
    expect(reasons[0]).toContain("safety");
    expect(reasons[1]).toContain("verification");
    expect(reasons[2]).toContain("3");
    expect(reasons[3]).toContain("data-retention");
    expect(reasons[3]).toContain("src/purge.ts");
  });

  it("names only the condition that fired", () => {
    expect(explainVerdict(reviewWith({ defect: "5" }))).toEqual([expect.stringContaining("defect")]);
  });

  it("says nothing about a low clarity on its own", () => {
    expect(explainVerdict(reviewWith({ clarity: "1" }))).toEqual([]);
  });

  it("counts clarity toward the accumulation reason even though it is single-fail exempt", () => {
    const reasons = explainVerdict(reviewWith({ blastRadius: "5", verification: "5", clarity: "5" }));

    const accumulation = reasons.find((reason) => reason.startsWith("3 criteria"));
    expect(accumulation).toContain("clarity (5)");
  });
});

describe("thresholds", () => {
  it("are the named constants requirements.md pre-authorizes loosening", () => {
    expect([BLOCKING_MAX, SINGLE_FAIL_MAX, ACCUMULATION_MAX, ACCUMULATION_COUNT]).toEqual([5, 3, 5, 3]);
    expect(BLOCKING_CRITERIA).toEqual(["defect", "safety", "blastRadius"]);
    expect(SINGLE_FAIL_EXEMPT).toEqual(["clarity"]);
  });
});
