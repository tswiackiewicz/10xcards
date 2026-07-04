// Risk #1 — a user's flashcards must never be visible or mutable by a different account.
// Ported from scripts/verify-rls.mjs (lines 69-129): two-user insert/select/update/delete
// isolation, cross-user insert rejection, signed-out anon read denial, and post-attack data
// integrity. Uses the same real anon-key + JWT-session pattern — no client is mocked, since
// a mocked Supabase client would lie about RLS by construction. SRS-column (verify-rls.mjs
// 131-170) and purge-cascade (216-258) sections are Risk #4/#5 and intentionally not ported here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { anonClient, cleanupUser, seedUser, signInDirect, type TestUser } from "../helpers/auth";

describe("Risk #1 — flashcard RLS isolation (ported from scripts/verify-rls.mjs)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let asA: SupabaseClient<Database>;
  let asB: SupabaseClient<Database>;
  let cardId: string;

  beforeAll(async () => {
    userA = await seedUser();
    userB = await seedUser();
    asA = await signInDirect(userA);
    asB = await signInDirect(userB);

    const insA = await asA
      .from("flashcards")
      .insert({ user_id: userA.id, question: "A question", answer: "A answer", source: "manual" })
      .select()
      .single()
      .throwOnError();
    cardId = insA.data.id;
  });

  afterAll(async () => {
    await cleanupUser(userA.id);
    await cleanupUser(userB.id);
  });

  it("A can create and read a card it owns", async () => {
    const { data, error } = await asA.from("flashcards").select("*").eq("id", cardId).single();
    expect(error).toBeNull();
    expect(data?.answer).toBe("A answer");
  });

  it("B does not see A's card in its own select", async () => {
    const { data, error } = await asB.from("flashcards").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("B's update of A's card affects zero rows", async () => {
    const { data, error } = await asB.from("flashcards").update({ answer: "hacked by B" }).eq("id", cardId).select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("B's delete of A's card affects zero rows", async () => {
    const { data, error } = await asB.from("flashcards").delete().eq("id", cardId).select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("B cannot insert a card stamped with A's user_id", async () => {
    const { error } = await asB
      .from("flashcards")
      .insert({ user_id: userA.id, question: "spoofed", answer: "spoofed" })
      .select();
    expect(error).not.toBeNull();
  });

  it("a signed-out (anon) client reads zero flashcards", async () => {
    // anon has no GRANT on flashcards at all (harness-smoke.test.ts), so this can surface
    // as a permission-denied error rather than an empty result set — either way, zero rows
    // are readable, which is the actual guarantee this test exists to prove.
    const { data } = await anonClient().from("flashcards").select("*");
    expect(data?.length ?? 0).toBe(0);
  });

  it("A's card is unchanged after B's and the anon client's attempts", async () => {
    const { data, error } = await asA.from("flashcards").select("*").eq("id", cardId).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(cardId);
    expect(data?.answer).toBe("A answer");
  });
});
