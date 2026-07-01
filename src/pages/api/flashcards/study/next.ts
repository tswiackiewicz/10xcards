import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { previewGrades, type GradePreview } from "@/lib/flashcards/srs";
import type { ApiErrorCode, Flashcard } from "@/lib/flashcards/schemas";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(status: number, error: ApiErrorCode): Response {
  return json(status, { error });
}

export interface NextCardResponse {
  card: Flashcard | null;
  previews: GradePreview[] | null;
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

  const now = new Date();
  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .or(`due.is.null,due.lte.${now.toISOString()}`)
    .order("due", { ascending: true, nullsFirst: true })
    .limit(1);
  if (error) {
    return fail(500, "save_failed");
  }

  const card = data.length > 0 ? data[0] : null;
  const body: NextCardResponse = {
    card,
    previews: card ? previewGrades(card, now) : null,
  };
  return json(200, body);
};
