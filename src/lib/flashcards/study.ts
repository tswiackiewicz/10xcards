import type { createClient } from "@/lib/supabase";
import type { NextCardResponse } from "@/lib/flashcards/schemas";
import { previewGrades } from "@/lib/flashcards/srs";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/**
 * The single "which card to study next" query, shared by the study page (server-load)
 * and GET /api/flashcards/study/next (after each grade) so the two never diverge.
 * Returns the oldest due-or-never-studied card (RLS-scoped) plus its grade previews,
 * or `card: null` when the deck is all caught up. `null` return means a DB error.
 */
export async function getNextCard(supabase: SupabaseClient, now: Date): Promise<NextCardResponse | null> {
  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    // `now` is interpolated into a PostgREST filter string — callers must always pass a
    // server-generated Date, never a client-supplied timestamp.
    .or(`due.is.null,due.lte.${now.toISOString()}`)
    .order("due", { ascending: true, nullsFirst: true })
    .limit(1);
  if (error) {
    return null;
  }
  const card = data.length > 0 ? data[0] : null;
  return { card, previews: card ? previewGrades(card, now) : null };
}
