import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { AccountErrorCode } from "@/lib/account/schemas";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(status: number, error: AccountErrorCode): Response {
  return json(status, { error });
}

// S-05: record a deletion request for the session user, then sign them out.
// Idempotent — a duplicate/pending row is treated as success (upsert, ignore
// conflict). The account_deletions row makes the user "pending deletion"; RLS
// (is_pending_deletion) immediately hides their flashcards. Sign-out revokes the
// session on the requesting device.
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

  // user_id comes from the verified session, never the request body; RLS also
  // pins the row to auth.uid(). ignoreDuplicates makes a repeat request a no-op.
  const { error } = await supabase
    .from("account_deletions")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) {
    return fail(500, "server_error");
  }

  await supabase.auth.signOut();
  return json(200, { ok: true });
};
