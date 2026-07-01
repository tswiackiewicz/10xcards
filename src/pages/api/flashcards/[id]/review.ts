import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { reviewSchema, type ApiErrorCode } from "@/lib/flashcards/schemas";
import { applyGrade } from "@/lib/flashcards/srs";

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

const SRS_COLUMNS = "due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review";

// Record a recall grade for a card: reschedule via ts-fsrs and persist the new FSRS state.
// A never-studied card (NULL due) is lazily initialized on its first grade.
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
    return fail(400, "invalid_rating");
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "invalid_rating");
  }

  // Read current SRS state (RLS-scoped). A missing row is not-found, not an error.
  const { data: current, error: readError } = await supabase
    .from("flashcards")
    .select(SRS_COLUMNS)
    .eq("id", id.data)
    .maybeSingle();
  if (readError) {
    return fail(500, "save_failed");
  }
  if (!current) {
    return fail(404, "not_found");
  }

  const nextState = applyGrade(current, parsed.data.rating, new Date());

  // RLS pins the update to auth.uid(); a 0-row result means the row vanished (deleted
  // elsewhere / RLS-hidden) between read and write — that's not-found, not success.
  const { data, error } = await supabase.from("flashcards").update(nextState).eq("id", id.data).select("due");
  if (error) {
    return fail(500, "save_failed");
  }
  if (data.length === 0) {
    return fail(404, "not_found");
  }

  return json(200, { due: data[0].due });
};
