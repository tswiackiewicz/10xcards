import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/db/database.types";
import { requireEnv } from "./require-env";

function adminClient() {
  return createSupabaseClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Seeds a throwaway, pre-confirmed user via the service-role client — mirrors scripts/verify-rls.mjs's seedUser. */
export async function seedUser(): Promise<TestUser> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `test-${suffix}@example.com`;
  const password = "Password123!";

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    throw new Error(`Failed to seed test user ${email}: ${error.message}`);
  }
  return { id: data.user.id, email, password };
}

/** Deletes a seeded user via the service-role client — mirrors scripts/verify-rls.mjs's cleanup. */
export async function cleanupUser(id: string): Promise<void> {
  await adminClient()
    .auth.admin.deleteUser(id)
    .catch(() => undefined);
}

/**
 * Signs in as (email, password) and returns a `Cookie` header string that a real
 * flashcard route handler will accept as an authenticated session — without hand-encoding
 * @supabase/ssr's internal session format. Sign in once with a plain client to get real
 * tokens, then replay them through a throwaway SSR client whose `setAll` records into an
 * in-memory jar instead of writing real cookies; the jar ends up holding exactly what the
 * app's own `createClient()` would have written, because it's the same library doing the encoding.
 */
export async function getAuthCookieHeader(email: string, password: string): Promise<string> {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  const plain = createSupabaseClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await plain.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  }

  const jar: { name: string; value: string }[] = [];
  const ssrClient = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => jar.push({ name, value }));
      },
    },
  });
  await ssrClient.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  return jar.map(({ name, value }) => `${name}=${value}`).join("; ");
}
