import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getNextCard } from "@/lib/flashcards/study";
import type { ApiErrorCode } from "@/lib/flashcards/schemas";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(status: number, error: ApiErrorCode): Response {
  return json(status, { error });
}

// Returns the single card to study now: due (due <= now) or never-studied (NULL due),
// oldest-first, scoped to the owner by RLS. `card: null` means the deck is all caught up.
export const GET: APIRoute = async (context) => {
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

  const next = await getNextCard(supabase, new Date());
  if (!next) {
    return fail(500, "save_failed");
  }
  return json(200, next);
};
