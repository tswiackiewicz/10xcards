import type { Criterion, Review } from "./schema.ts";

/**
 * A review outcome. The action-level `error` state — "no review outcome exists" — is
 * deliberately not part of this type: exit codes and workflow states encode tool
 * failure, never review outcome.
 */
export type Verdict = "passed" | "failed";

/**
 * The four gate thresholds, transcribed from requirements.md:119-137. Named because
 * requirements.md:136-137 pre-authorizes loosening the blocking threshold from 5 to 4
 * if the gate proves noisy — that must stay a one-line change.
 */
export const BLOCKING_MAX = 5;
export const SINGLE_FAIL_MAX = 3;
export const ACCUMULATION_MAX = 5;
/**
 * Three or more criteria at or below ACCUMULATION_MAX. Held at 3 across the six-to-five
 * criteria swap, which makes it a deliberate tightening from 3-of-6 to 3-of-5 — not an
 * oversight left behind by the rename. See docs/criteria.md, "The gate".
 */
export const ACCUMULATION_COUNT = 3;

/**
 * The three dimensions that fail on "unproven", not just on "bad" — a merged defect,
 * exposure or silent production failure costs far more than a re-review. Condition 1
 * reads this list and condition 2 reads its complement minus SINGLE_FAIL_EXEMPT, so the
 * three lists cannot drift apart.
 */
export const BLOCKING_CRITERIA = ["defect", "safety", "blastRadius"] as const satisfies readonly Criterion[];

/**
 * Criteria that cannot fail a PR on their own. Unclear code is real review feedback, but
 * it is not the kind of harm that should hold a merge — so `clarity` sits out of
 * condition 2 while still counting toward the accumulation in condition 3.
 */
export const SINGLE_FAIL_EXEMPT = ["clarity"] as const satisfies readonly Criterion[];

/** The only place the string score encoding is decoded. `n/a` becomes null, never 0. */
function parseScore(score: Review["criteria"][Criterion]["score"]): number | null {
  return score === "n/a" ? null : Number(score);
}

interface Scored {
  name: string;
  score: number;
}

/** Criteria with a numeric score, in rubric order. `n/a` is excluded here, once. */
function scored(review: Review): Scored[] {
  return Object.entries(review.criteria).flatMap(([name, { score }]) => {
    const parsed = parseScore(score);
    return parsed === null ? [] : [{ name, score: parsed }];
  });
}

function label({ name, score }: Scored): string {
  return `${name} (${String(score)})`;
}

/**
 * Walks the four-condition table once. `deriveVerdict` and `explainVerdict` are thin
 * projections over this, so a comment can never state reasons that contradict the
 * label it explains.
 */
function evaluateGate(review: Review): { verdict: Verdict; reasons: string[] } {
  const numeric = scored(review);
  const blocking = new Set<string>(BLOCKING_CRITERIA);
  const exempt = new Set<string>(SINGLE_FAIL_EXEMPT);
  const reasons: string[] = [];

  // 1 — a blocking dimension at or below the blocking threshold (requirements.md:124).
  const failedBlocking = numeric.filter((entry) => blocking.has(entry.name) && entry.score <= BLOCKING_MAX);
  if (failedBlocking.length > 0) {
    reasons.push(`Blocking criterion at or below ${String(BLOCKING_MAX)}: ${failedBlocking.map(label).join(", ")}`);
  }

  // 2 — any other non-exempt criterion at or below the single-fail threshold
  // (requirements.md:127). "Other" because condition 1 already fails the three blocking
  // dimensions at <= 5, which makes a <= 3 rule for them dead; "non-exempt" because
  // `clarity` must not fail a PR by itself. With three blocking criteria and `clarity`
  // exempt, this condition applies to `verification` alone — a consequence of those two
  // decisions, not an oversight (docs/criteria.md, "Which criteria block").
  const failedSingle = numeric.filter(
    (entry) => !blocking.has(entry.name) && !exempt.has(entry.name) && entry.score <= SINGLE_FAIL_MAX,
  );
  if (failedSingle.length > 0) {
    reasons.push(`Criterion at or below ${String(SINGLE_FAIL_MAX)}: ${failedSingle.map(label).join(", ")}`);
  }

  // 3 — accumulation across all five criteria, `clarity` included (requirements.md:128).
  const accumulated = numeric.filter((entry) => entry.score <= ACCUMULATION_MAX);
  if (accumulated.length >= ACCUMULATION_COUNT) {
    reasons.push(
      `${String(accumulated.length)} criteria at or below ${String(ACCUMULATION_MAX)}: ${accumulated
        .map(label)
        .join(", ")}`,
    );
  }

  // 4 — a concrete finding in a named blocking category, whatever the scores say
  // (requirements.md:130,148-160).
  const blockingFindings = review.findings.filter((finding) => finding.blockingCategory !== null);
  if (blockingFindings.length > 0) {
    reasons.push(
      `Blocking category finding: ${blockingFindings
        .map((finding) => `${String(finding.blockingCategory)} at ${finding.file}:${String(finding.line)}`)
        .join(", ")}`,
    );
  }

  return { verdict: reasons.length > 0 ? "failed" : "passed", reasons };
}

/** The label. Derived mechanically from the scores — the model never authors it. */
export function deriveVerdict(review: Review): Verdict {
  return evaluateGate(review).verdict;
}

/** The conditions that fired, in rubric order. Empty exactly when the verdict passes. */
export function explainVerdict(review: Review): string[] {
  return evaluateGate(review).reasons;
}
