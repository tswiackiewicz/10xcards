import type { APIRoute } from "astro";
import { z } from "zod";
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

const idSchema = z.uuid();

export const PATCH: APIRoute = async (context) => {
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

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return fail(400, "invalid_input");
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

  // RLS pins the row to auth.uid(); updated_at auto-touches via trigger. A 0-row result
  // means the id doesn't exist or isn't ours (RLS-hidden) — that's not-found, not success.
  const { data, error } = await supabase
    .from("flashcards")
    .update({ question: parsed.data.question, answer: parsed.data.answer })
    .eq("id", id.data)
    .select("id");
  if (error) {
    return fail(500, "save_failed");
  }
  if (data.length === 0) {
    return fail(404, "not_found");
  }

  return json(200, { updated: 1 });
};

export const DELETE: APIRoute = async (context) => {
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

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return fail(400, "invalid_input");
  }

  // RLS pins the delete to auth.uid(); a 0-row result means the id doesn't exist or
  // isn't ours (RLS-hidden) — that's not-found, not a silent success.
  const { data, error } = await supabase.from("flashcards").delete().eq("id", id.data).select("id");
  if (error) {
    return fail(500, "save_failed");
  }
  if (data.length === 0) {
    return fail(404, "not_found");
  }

  return json(200, { deleted: 1 });
};
