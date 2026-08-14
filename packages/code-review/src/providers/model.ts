import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { z } from "zod";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string("OPENROUTER_API_KEY is missing — copy .env.example to .env").min(1),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-haiku-4.5"),
});

/**
 * The only place `process.env` is read. Parsing happens inside the call, never at
 * module scope, so importing the package never requires an API key — that is what
 * lets a caller inject its own model and skip env entirely.
 */
export function resolveModel(): LanguageModel {
  const env = envSchema.parse(process.env);
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })(env.OPENROUTER_MODEL);
}
