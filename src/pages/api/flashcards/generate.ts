import type { APIRoute } from "astro";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { ZodError } from "zod";
import { createClient } from "@/lib/supabase";
import { generateRequestSchema, type ApiErrorCode } from "@/lib/flashcards/schemas";
import { generateCandidates, GenerationError } from "@/lib/flashcards/generation";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(status: number, error: ApiErrorCode): Response {
  return json(status, { error });
}

/** Map a request-body validation failure to a specific typed error code. */
function mapInputError(error: ZodError): ApiErrorCode {
  const issue = error.issues.find((i) => i.path[0] === "text") ?? error.issues[0];
  if (issue.code === "too_small") return "empty_input";
  if (issue.code === "too_big") return "too_long";
  return "invalid_input";
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(401, "unauthorized");
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail(401, "unauthorized");
  }

  if (!OPENROUTER_API_KEY) {
    return fail(503, "ai_unavailable");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return fail(400, "invalid_input");
  }

  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, mapInputError(parsed.error));
  }

  let candidates;
  try {
    candidates = await generateCandidates(parsed.data.text, OPENROUTER_API_KEY);
  } catch (err) {
    if (err instanceof GenerationError && err.status === 429) {
      return fail(429, "rate_limited");
    }
    return fail(502, "ai_unavailable");
  }

  if (candidates.length === 0) {
    return fail(422, "no_cards");
  }

  return json(200, { candidates });
};
