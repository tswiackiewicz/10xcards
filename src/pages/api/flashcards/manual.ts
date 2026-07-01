import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { manualCardSchema, type ApiErrorCode } from "@/lib/flashcards/schemas";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(status: number, error: ApiErrorCode): Response {
  return json(status, { error });
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return fail(400, "invalid_input");
  }

  const parsed = manualCardSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "invalid_input");
  }

  // user_id comes from the verified session (auth.getUser), never the request body;
  // RLS additionally pins the row to auth.uid().
  const { error } = await supabase.from("flashcards").insert({
    question: parsed.data.question,
    answer: parsed.data.answer,
    source: "manual",
    user_id: user.id,
  });
  if (error) {
    return fail(500, "save_failed");
  }

  return json(200, { saved: 1 });
};
