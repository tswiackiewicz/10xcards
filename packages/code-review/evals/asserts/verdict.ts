/**
 * Deterministic assert: does the mechanical gate actually fail on this review?
 *
 * This is half of what the sweep exists to answer. It needs no judge, so it is trustworthy
 * even in a run where the grader is dead — see the `graderError` note in evals/README.md.
 */
import { deriveVerdict, type Review } from "../../src/index.ts";

interface AssertContext {
  vars: Record<string, unknown>;
}

interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

export default function assertVerdict(output: Review, context: AssertContext): GradingResult {
  // A malformed output would make `deriveVerdict` throw, which promptfoo reports as a
  // harness error rather than a model result. Failing cleanly keeps the two distinguishable.
  if (typeof output !== "object" || !("criteria" in output) || !Array.isArray(output.findings)) {
    return { pass: false, score: 0, reason: "provider output is not a Review object" };
  }

  const expected = context.vars.expected_verdict;
  const actual = deriveVerdict(output);
  const pass = actual === expected;

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `gate verdict is ${actual}, as expected`
      : `gate verdict is ${actual}, expected ${String(expected)} — the fixture's planted defects did not trip the gate`,
  };
}
