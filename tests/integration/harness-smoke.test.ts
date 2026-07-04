import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { requireEnv } from "../helpers/require-env";

describe("test harness bootstrap", () => {
  it("sources local Supabase credentials via globalSetup", () => {
    expect(process.env.SUPABASE_URL).toMatch(/^http/);
    expect(process.env.SUPABASE_ANON_KEY).toBeTruthy();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });

  it("can reach the local Supabase instance with the anon key", async () => {
    // Uses the auth endpoint, not a table query: `anon` has no GRANT on `flashcards`
    // (by design — see supabase/migrations/20260624185919_create_flashcards.sql), so a
    // table query would fail with a permission error unrelated to connectivity.
    const client = createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    const { error } = await client.auth.getSession();
    expect(error).toBeNull();
  });
});
