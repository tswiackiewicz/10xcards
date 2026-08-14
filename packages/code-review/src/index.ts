// One line per agent. Adding an agent means adding its directory under agents/
// and one re-export here — nothing else in the package moves.
export {
  buildReviewPrompt,
  createReviewAgent,
  reviewDiff,
  reviewInstructions,
  reviewSchema,
  type Review,
  type ReviewAgentConfig,
} from "./agents/reviewer/index.ts";
