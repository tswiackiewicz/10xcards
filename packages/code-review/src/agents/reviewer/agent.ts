import type { LanguageModel } from "ai";
import { Output, ToolLoopAgent } from "ai";

import { collectInstalledVersions } from "./installed-versions.ts";
import { resolveModel } from "../../providers/model.ts";
import { buildReviewPrompt, reviewInstructions } from "./prompts.ts";
import { reviewSchema, type Review } from "./schema.ts";

export interface ReviewAgentConfig {
  /** Omit to resolve from the environment. Inject a pinned or mock model for evals and tests. */
  model?: LanguageModel;
}

/**
 * Fixed so two reviews of the same diff are comparable. Anthropic models expose no
 * sampling seed — OpenRouter forwards it and the model ignores it — so `temperature: 0`
 * is doing the real work here and no replay story may be built on the seed alone.
 */
const REVIEW_SEED = 1;

/**
 * The reviewer as a reusable agent. No tools by design: the diff is semi-untrusted
 * input, and the agent exists for reusable configuration and a single object evals
 * can target — not for filesystem agency.
 *
 * `temperature` and `seed` are constructor-only: `AgentCallParameters` accepts neither,
 * so they cannot be passed at `generate()` time. `maxOutputTokens` is deliberately unset
 * — with no retry on this path, a cap that truncates mid-JSON raises
 * `NoObjectGeneratedError` and the only recovery re-runs into the identical cap.
 */
export function createReviewAgent(config: ReviewAgentConfig = {}) {
  return new ToolLoopAgent({
    model: config.model ?? resolveModel(),
    instructions: reviewInstructions,
    output: Output.object({ schema: reviewSchema }),
    temperature: 0,
    seed: REVIEW_SEED,
  });
}

export interface ReviewOptions extends ReviewAgentConfig {
  /** Where the ground-truth dependency versions are read from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** PR title — untrusted, travels as user content. */
  title?: string;
  /** PR description — untrusted, travels as user content, capped at `MAX_BODY_CHARS`. */
  body?: string;
}

/**
 * Reviews one unified diff. Builds its agent per call — never a module-level
 * singleton, since `options.model` varies per call and construction does no I/O.
 */
export async function reviewDiff(diff: string, options: ReviewOptions = {}): Promise<Review> {
  const versions = await collectInstalledVersions(options.cwd ?? process.cwd());
  const prompt = buildReviewPrompt({ diff, versions, title: options.title, body: options.body });

  const { output } = await createReviewAgent(options).generate({ prompt });
  return output;
}
