import type { LanguageModel } from "ai";
import { Output, ToolLoopAgent } from "ai";

import { collectInstalledVersions } from "./installed-versions.ts";
import { resolveModel } from "./model.ts";
import { buildReviewPrompt, reviewInstructions } from "./prompts.ts";
import { reviewSchema, type Review } from "./schema.ts";

export interface ReviewAgentConfig {
  /** Omit to resolve from the environment. Inject a pinned or mock model for evals and tests. */
  model?: LanguageModel;
}

/**
 * The reviewer as a reusable agent. No tools by design: the diff is semi-untrusted
 * input, and the agent exists for reusable configuration and a single object evals
 * can target — not for filesystem agency.
 */
export function createReviewAgent(config: ReviewAgentConfig = {}) {
  return new ToolLoopAgent({
    model: config.model ?? resolveModel(),
    instructions: reviewInstructions,
    output: Output.object({ schema: reviewSchema }),
  });
}

/**
 * Reviews one unified diff. Builds its agent per call — never a module-level
 * singleton, since `options.model` varies per call and construction does no I/O.
 */
export async function reviewDiff(diff: string, options: ReviewAgentConfig & { cwd?: string } = {}): Promise<Review> {
  const versions = await collectInstalledVersions(options.cwd ?? process.cwd());
  const prompt = buildReviewPrompt({ diff, versions });

  const { output } = await createReviewAgent(options).generate({ prompt });
  return output;
}
