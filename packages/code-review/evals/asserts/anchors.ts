/**
 * Deterministic assert: does every finding point at a file that is actually in the diff?
 *
 * A finding anchored to a file the diff never touches is a hallucination regardless of how
 * sensible its message reads, and no judge is needed to say so.
 */
import type { Review } from "../../src/index.ts";

interface AssertContext {
  vars: Record<string, unknown>;
}

interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

/** `+++ b/<path>` is the post-image path of every hunk header in a unified diff. */
function changedFiles(diff: string): Set<string> {
  const paths = new Set<string>();
  for (const match of diff.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
    const captured = match[1];
    if (captured !== undefined) {
      paths.add(captured.trim());
    }
  }
  return paths;
}

// `output` is whatever the provider returned — see the note in verdict.ts.
export default function assertAnchors(output: unknown, context: AssertContext): GradingResult {
  // Harness and config errors get their own reason strings. A score of 0 is only trustworthy
  // as "the model hallucinated" if every other way of reaching 0 says so out loud.
  const diff: unknown = context.vars.diff;
  if (typeof diff !== "string") {
    return {
      pass: false,
      score: 0,
      reason: "HARNESS ERROR: vars.diff is not a string — cannot resolve the diff's file list",
    };
  }

  if (output === null || typeof output !== "object" || !("findings" in output) || !Array.isArray(output.findings)) {
    return { pass: false, score: 0, reason: "HARNESS ERROR: provider output is not a Review object" };
  }

  const files = changedFiles(diff);
  if (files.size === 0) {
    return {
      pass: false,
      score: 0,
      reason:
        "HARNESS ERROR: no `+++ b/<path>` headers in vars.diff — the fixture is not a prefixed unified diff, so every finding would read as fabricated",
    };
  }

  const { findings } = output as Review;

  // Zero findings scores 0 rather than a vacuous 1: the fixture demonstrably contains
  // defects, so an empty review is the worst outcome, not a perfectly precise one.
  if (findings.length === 0) {
    return { pass: false, score: 0, reason: "review reported no findings, but the fixture contains planted defects" };
  }

  const fabricated = findings.filter((finding) => !files.has(finding.file));
  const score = (findings.length - fabricated.length) / findings.length;

  return {
    pass: fabricated.length === 0,
    score,
    reason:
      fabricated.length === 0
        ? `all ${String(findings.length)} finding(s) anchored to a file in the diff`
        : `${String(fabricated.length)} of ${String(findings.length)} finding(s) point at files absent from the diff: ${[
            ...new Set(fabricated.map((finding) => finding.file)),
          ].join(", ")}`,
  };
}
