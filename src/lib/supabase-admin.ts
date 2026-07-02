import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

// S-05: the privileged, RLS-bypassing plane. This is the ONLY module that touches
// the service-role key. Used exclusively by the scheduled purge to permanently
// delete auth users (which cascades to their flashcards and account_deletions row).
// No cookie wiring and no session persistence — it acts as the service role, not a
// user. Returns null when the key is unset (mirrors the src/lib/supabase.ts guard),
// so the purge route can respond 503 rather than crash.
export function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
