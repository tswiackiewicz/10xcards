import type { Criterion, Review } from "./schema.ts";
import { explainVerdict, type Verdict } from "./verdict.ts";

/** The sticky-comment anchor. The workflow finds its own comment by this string. */
export const COMMENT_MARKER = "<!-- ai-code-review -->";

/** Criterion keys are terse for the model; the comment uses the names docs/criteria.md uses. */
const CRITERION_LABELS: Record<Criterion, string> = {
  correctness: "implementation correctness",
  idiomaticity: "idiomaticity",
  complexity: "complexity",
  testCoverage: "test / risk coverage",
  documentation: "documentation",
  security: "security and safety",
};

const SEVERITY_ORDER = ["error", "warning", "info"] as const;

/**
 * The schema permits an empty note by design (`minLength` is outside the provider's
 * strict-mode subset), so the renderer is the layer that makes its absence visible.
 */
const NO_NOTE = "— no justification given";

/**
 * Renders the PR comment body. Scores are already strings, so nothing here interpolates
 * a number into a template — which is what keeps `restrict-template-expressions` with
 * `allowNumber: false` satisfied without `String(...)` wrappers around every cell.
 */
export function renderMarkdown(review: Review, verdict: Verdict): string {
  const sections = [
    `${COMMENT_MARKER}\n## AI code review — ${verdict === "passed" ? "✅ passed" : "❌ failed"}`,
    reasons(review, verdict),
    scoreTable(review),
    `### Summary\n\n${review.summary}`,
    blockingFindings(review),
    ordinaryFindings(review),
  ];

  return `${sections.filter((section) => section !== null).join("\n\n")}\n`;
}

function reasons(review: Review, verdict: Verdict): string | null {
  if (verdict === "passed") {
    return null;
  }

  const fired = explainVerdict(review).map((reason) => `- ${reason}`);
  return `### Gate conditions that fired\n\n${fired.join("\n")}`;
}

function scoreTable(review: Review): string {
  const rows = Object.entries(review.criteria).map(([key, { score, note }]) => {
    const label = CRITERION_LABELS[key as Criterion];
    return `| ${label} | ${score} | ${note.trim() === "" ? NO_NOTE : note} |`;
  });

  return ["### Scores", "", "| Criterion | Score | Note |", "| --- | --- | --- |", ...rows].join("\n");
}

function blockingFindings(review: Review): string | null {
  const blocking = review.findings.filter((finding) => finding.blockingCategory !== null);
  if (blocking.length === 0) {
    return null;
  }

  const rows = blocking.map(
    (finding) => `- **${String(finding.blockingCategory)}** — \`${location(finding)}\` — ${finding.message}`,
  );
  return `### Blocking findings\n\n${rows.join("\n")}`;
}

function ordinaryFindings(review: Review): string | null {
  const ordinary = review.findings.filter((finding) => finding.blockingCategory === null);
  if (ordinary.length === 0) {
    return null;
  }

  const groups = SEVERITY_ORDER.flatMap((severity) => {
    const matching = ordinary.filter((finding) => finding.severity === severity);
    if (matching.length === 0) {
      return [];
    }
    return [
      `**${severity}**\n\n${matching.map((finding) => `- \`${location(finding)}\` — ${finding.message}`).join("\n")}`,
    ];
  });

  return `### Findings\n\n${groups.join("\n\n")}`;
}

function location(finding: Review["findings"][number]): string {
  return `${finding.file}:${String(finding.line)}`;
}
