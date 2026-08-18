// Public surface of the reviewer agent. Each agent owns its own barrel, so the
// package root re-exports one path per agent rather than reaching into internals.
// `collectInstalledVersions` stays internal — callers that want ground-truth
// versions in the prompt should use `reviewDiff`.
export { createReviewAgent, reviewDiff, type ReviewAgentConfig, type ReviewOptions } from "./agent.ts";
export { buildReviewPrompt, MAX_BODY_CHARS, reviewInstructions } from "./prompts.ts";
export { COMMENT_MARKER, renderMarkdown } from "./render.ts";
export {
  BLOCKING_CATEGORIES,
  reviewSchema,
  SCORE_VALUES,
  type BlockingCategory,
  type Criterion,
  type Review,
} from "./schema.ts";
export {
  ACCUMULATION_COUNT,
  ACCUMULATION_MAX,
  BLOCKING_CRITERIA,
  BLOCKING_MAX,
  deriveVerdict,
  explainVerdict,
  SINGLE_FAIL_MAX,
  type Verdict,
} from "./verdict.ts";
