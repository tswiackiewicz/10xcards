import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { z } from "zod";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string("OPENROUTER_API_KEY is missing — copy .env.example to .env").min(1),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-haiku-4.5"),
});

/**
 * How a model is constructed, in one place. Callers that bring their own key and model id —
 * the eval sweep runs three models in one process — go through here rather than re-deriving
 * it, so a future change (baseURL, HTTP-Referer/X-Title headers, retry config) reaches every
 * call path instead of silently missing the ones that hand-rolled their own.
 */
export function createModel(apiKey: string, modelId: string): LanguageModel {
  return createOpenRouter({ apiKey })(modelId);
}

/**
 * The only place `src/` reads `process.env`. Parsing happens inside the call, never at
 * module scope, so importing the package never requires an API key — that is what
 * lets a caller inject its own model and skip env entirely. (`evals/provider.ts` reads the
 * key itself: promptfoo needs a returned `{ error }`, not a throw, and it supplies the model
 * id per provider — but it constructs the model through `createModel`.)
 */
export function resolveModel(): LanguageModel {
  const env = envSchema.parse(process.env);
  return createModel(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL);
}
