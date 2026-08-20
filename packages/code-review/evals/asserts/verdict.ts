/**
 * Deterministic assert: does the mechanical gate actually fail on this review?
 *
 * This is half of what the sweep exists to answer. It needs no judge, so it is trustworthy
 * even in a run where the grader is dead — see the `graderError` note in evals/README.md.
 */
import { deriveVerdict, type Review, type Verdict } from "../../src/index.ts";

interface AssertContext {
  vars: Record<string, unknown>;
}

interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

function isVerdict(value: unknown): value is Verdict {
  return value === "passed" || value === "failed";
}

// `output` is whatever the provider returned, so it is typed as `unknown` rather than
// `Review`: promptfoo cannot enforce the shape, and pretending it can is what let the old
// `typeof output !== "object"` guard pass `null` through to a TypeError.
export default function assertVerdict(output: unknown, context: AssertContext): GradingResult {
  // Harness and config errors get their own reason strings. A score of 0 is only trustworthy
  // as "the model missed something" if every other way of reaching 0 says so out loud.
  const expected: unknown = context.vars.expected_verdict;
  if (!isVerdict(expected)) {
    return {
      pass: false,
      score: 0,
      reason: `HARNESS ERROR: vars.expected_verdict is ${JSON.stringify(expected)}, expected "passed" or "failed" — this is a config bug, not a model result`,
    };
  }

  // A malformed output would make `deriveVerdict` throw, which promptfoo reports as a
  // harness error rather than a model result. Failing cleanly keeps the two distinguishable.
  if (
    output === null ||
    typeof output !== "object" ||
    !("criteria" in output) ||
    !("findings" in output) ||
    !Array.isArray(output.findings)
  ) {
    return { pass: false, score: 0, reason: "HARNESS ERROR: provider output is not a Review object" };
  }

  const actual = deriveVerdict(output as Review);
  const pass = actual === expected;

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `gate verdict is ${actual}, as expected`
      : `gate verdict is ${actual}, expected ${expected} — the fixture's planted defects did not trip the gate`,
  };
}
