import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// S-05: cancel a pending deletion for the session user. Deleting the
// account_deletions row clears the pending state; RLS immediately restores the
// user's flashcards. RLS pins the delete to auth.uid(), so a 0-row delete (no
// pending request) is still success.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(401, { error: "unauthorized" });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json(401, { error: "unauthorized" });
  }

  const { error } = await supabase.from("account_deletions").delete().eq("user_id", user.id);
  if (error) {
    return json(500, { error: "server_error" });
  }

  return json(200, { ok: true });
};
