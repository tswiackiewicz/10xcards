import { describe, expect, it } from "vitest";

import { reviewSchema } from "./schema.ts";

const validReview = {
  summary: "One real defect in the changed lines.",
  findings: [{ file: "src/cart.ts", line: 5, severity: "error", message: "Off-by-one in the loop bound." }],
};

describe("reviewSchema", () => {
  it("accepts a well-formed review", () => {
    expect(reviewSchema.parse(validReview)).toEqual(validReview);
  });

  it("accepts a review with no findings", () => {
    expect(reviewSchema.parse({ summary: "Diff is fine.", findings: [] }).findings).toEqual([]);
  });

  it.each([
    ["an unknown severity", { ...validReview.findings[0], severity: "critical" }],
    ["a zero line number", { ...validReview.findings[0], line: 0 }],
    ["a fractional line number", { ...validReview.findings[0], line: 5.5 }],
  ])("rejects %s", (_label, finding) => {
    expect(reviewSchema.safeParse({ ...validReview, findings: [finding] }).success).toBe(false);
  });

  it("rejects a review with no summary", () => {
    expect(reviewSchema.safeParse({ findings: [] }).success).toBe(false);
  });
});
