// Risk #4 — a pending-deletion account's flashcards must become invisible/immutable
// immediately (via the is_pending_deletion() RLS gate), regardless of how young the
// deletion request is; sign-in itself must still succeed and merely redirect to
// /account, per the corrected test-plan.md §2 Risk #4 guidance. No client is mocked —
// this exercises the real RLS policy and the real signin route handler.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { POST as SIGNIN } from "@/pages/api/auth/signin";
import { cleanupUser, seedUser, signInDirect, type TestUser } from "../helpers/auth";
import { seedAccountDeletion } from "../helpers/account-deletion";
import { buildContext } from "../helpers/api-context";

describe("Risk #4 — pending-deletion RLS lockout", () => {
  let user: TestUser;
  let asUser: SupabaseClient<Database>;
  let cardId: string;

  beforeAll(async () => {
    user = await seedUser();
    asUser = await signInDirect(user);

    const inserted = await asUser
      .from("flashcards")
      .insert({
        user_id: user.id,
        question: "pending-deletion question",
        answer: "pending-deletion answer",
        source: "manual",
      })
      .select()
      .single()
      .throwOnError();
    cardId = inserted.data.id;

    // Age 0 — deliberately not aged, to prove the lock is immediate, not tied to the
    // 30-day purge boundary.
    await seedAccountDeletion(user.id, 0);
  });

  afterAll(async () => {
    await cleanupUser(user.id);
  });

  it("the user's own signed-in client sees zero flashcards once pending deletion", async () => {
    const { data, error } = await asUser.from("flashcards").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("the user's own update of its card affects zero rows once pending deletion", async () => {
    const { data, error } = await asUser
      .from("flashcards")
      .update({ answer: "should not apply" })
      .eq("id", cardId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("the user's own delete of its card affects zero rows once pending deletion", async () => {
    const { data, error } = await asUser.from("flashcards").delete().eq("id", cardId).select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("sign-in still succeeds but redirects to /account, not blocked", async () => {
    const response = await SIGNIN(
      buildContext({
        method: "POST",
        url: "http://localhost/api/auth/signin",
        formBody: { email: user.email, password: user.password },
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/account");
  });
});
