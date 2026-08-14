// Public surface of the reviewer agent. Each agent owns its own barrel, so the
// package root re-exports one path per agent rather than reaching into internals.
// `collectInstalledVersions` stays internal — callers that want ground-truth
// versions in the prompt should use `reviewDiff`.
export { createReviewAgent, reviewDiff, type ReviewAgentConfig } from "./agent.ts";
export { buildReviewPrompt, reviewInstructions } from "./prompts.ts";
export { reviewSchema, type Review } from "./schema.ts";
