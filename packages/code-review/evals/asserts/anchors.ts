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

export default function assertAnchors(output: Review, context: AssertContext): GradingResult {
  const diff = context.vars.diff;
  if (typeof diff !== "string") {
    return { pass: false, score: 0, reason: "vars.diff is not a string — cannot resolve the diff's file list" };
  }

  const findings = Array.isArray(output.findings) ? output.findings : [];

  // Zero findings scores 0 rather than a vacuous 1: the fixture demonstrably contains
  // defects, so an empty review is the worst outcome, not a perfectly precise one.
  if (findings.length === 0) {
    return { pass: false, score: 0, reason: "review reported no findings, but the fixture contains planted defects" };
  }

  const files = changedFiles(diff);
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
