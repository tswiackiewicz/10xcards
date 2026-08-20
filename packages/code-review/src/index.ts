// One line per agent. Adding an agent means adding its directory under agents/
// and one re-export here — nothing else in the package moves.
export {
  ACCUMULATION_COUNT,
  ACCUMULATION_MAX,
  BLOCKING_CATEGORIES,
  BLOCKING_CRITERIA,
  BLOCKING_MAX,
  buildReviewPrompt,
  COMMENT_MARKER,
  createReviewAgent,
  deriveVerdict,
  explainVerdict,
  MAX_BODY_CHARS,
  renderMarkdown,
  reviewDiff,
  reviewInstructions,
  reviewSchema,
  SCORE_VALUES,
  SINGLE_FAIL_MAX,
  type BlockingCategory,
  type Criterion,
  type Review,
  type ReviewAgentConfig,
  type ReviewOptions,
  type Verdict,
} from "./agents/reviewer/index.ts";

// Not an agent: how a model is built, shared with `evals/provider.ts` so the sweep exercises
// the same construction the shipped path does.
export { createModel } from "./providers/model.ts";
// The readable-error path. Every entry point that reports a failure to a human goes through
// it, `evals/` included — a swallowed `NoObjectGeneratedError.finishReason` is the whole
// diagnostic budget for a failed review.
export { toMessage } from "./cli.ts";
