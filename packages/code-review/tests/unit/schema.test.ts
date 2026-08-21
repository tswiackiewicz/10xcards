import { describe, expect, it } from "vitest";

import { reviewSchema } from "../../src/agents/reviewer/schema.ts";

/** Every criterion scored, so a case can override exactly the one it is about. */
const criteria = {
  defect: { score: "7", note: "The changed lines hold no defect on the paths the diff exposes." },
  safety: { score: "8", note: "Input is validated at the boundary this diff touches." },
  blastRadius: { score: "9", note: "Nothing destructive here; the change reverts by the ordinary path." },
  verification: { score: "n/a", note: "Config-only change; the pipeline run is the test." },
  clarity: { score: "6", note: "One non-obvious decision left unexplained." },
};

const validReview = {
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
  ],
};

describe("reviewSchema", () => {
  it("accepts a well-formed review", () => {
    expect(reviewSchema.parse(validReview)).toEqual(validReview);
  });

  it("accepts a review with no findings", () => {
    expect(reviewSchema.parse({ summary: "Diff is fine.", criteria, findings: [] }).findings).toEqual([]);
  });

  it.each([
    ["an unknown severity", { ...validReview.findings[0], severity: "critical" }, ["findings", 0, "severity"]],
    ["a zero line number", { ...validReview.findings[0], line: 0 }, ["findings", 0, "line"]],
    ["a fractional line number", { ...validReview.findings[0], line: 5.5 }, ["findings", 0, "line"]],
    [
      "an unknown blocking category",
      { ...validReview.findings[0], blockingCategory: "vibes" },
      ["findings", 0, "blockingCategory"],
    ],
  ])("rejects %s on its own field", (_label, finding, path) => {
    const result = reviewSchema.safeParse({ ...validReview, findings: [finding] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(path);
  });

  it("rejects a review with no summary", () => {
    const result = reviewSchema.safeParse({ criteria, findings: [] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["summary"]);
  });

  it("rejects a review missing a criterion", () => {
    const { blastRadius: _blastRadius, ...incomplete } = criteria;

    const result = reviewSchema.safeParse({ ...validReview, criteria: incomplete });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["criteria", "blastRadius"]);
  });

  it.each([["0"], ["11"], ["7.5"], ["N/A"], ["good"]])("rejects %s as a score", (score) => {
    const result = reviewSchema.safeParse({
      ...validReview,
      criteria: { ...criteria, defect: { score, note: "…" } },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["criteria", "defect", "score"]);
  });

  it("accepts n/a as a score", () => {
    const parsed = reviewSchema.parse({
      ...validReview,
      criteria: { ...criteria, safety: { score: "n/a", note: "No trust boundary in the diff." } },
    });

    expect(parsed.criteria.safety.score).toBe("n/a");
  });

  it("accepts an empty note — non-emptiness is a prompt and renderer concern, not a schema one", () => {
    const parsed = reviewSchema.parse({
      ...validReview,
      criteria: { ...criteria, clarity: { score: "4", note: "" } },
    });

    expect(parsed.criteria.clarity.note).toBe("");
  });

  it("accepts a finding tagged with a blocking category", () => {
    const parsed = reviewSchema.parse({
      ...validReview,
      findings: [{ ...validReview.findings[0], blockingCategory: "secret-exposure" }],
    });

    expect(parsed.findings[0]?.blockingCategory).toBe("secret-exposure");
  });
});
