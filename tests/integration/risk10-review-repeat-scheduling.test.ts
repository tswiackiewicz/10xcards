// Risk #10 — catches a regression in review.ts's SRS_COLUMNS select-list specifically:
// Phase 1's mutation testing found a mutant truncating that literal to "" survived
// undetected (context/foundation/test-plan.md §6.7). Calls the real PATCH endpoint twice
// for the same card, real Supabase, real session, then reads `reps` directly via the
// admin client to prove the endpoint's actual DB round-trip — not just the pure
// function — correctly reloads and persists prior state across two real reviews.
// Setup mirrors risk1-api-route-ownership.test.ts's review-PATCH precedent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/pages/api/flashcards/index";
import { PATCH as PATCH_REVIEW } from "@/pages/api/flashcards/[id]/review";
import { adminClient, cleanupUser, getAuthCookieHeader, seedUser, signInDirect, type TestUser } from "../helpers/auth";
import { buildContext } from "../helpers/api-context";

describe("Risk #10 — repeat review through the real endpoint", () => {
  let user: TestUser;
  let cookieHeader: string;
  let cardId: string;

  beforeAll(async () => {
    user = await seedUser();
    cookieHeader = await getAuthCookieHeader(user.email, user.password);

    const createResponse = await POST(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards",
        cookieHeader,
        body: { cards: [{ question: "repeat-review question", answer: "repeat-review answer" }] },
      }),
    );
    expect(createResponse.status).toBe(200);

    const asUser = await signInDirect(user);
    const { data } = await asUser
      .from("flashcards")
      .select("id")
      .eq("question", "repeat-review question")
      .single()
      .throwOnError();
    cardId = data.id;
  });

  afterAll(async () => {
    await cleanupUser(user.id);
  });

  it("two real sequential reviews of the same card correctly increment reps in the DB", async () => {
    const firstReview = await PATCH_REVIEW(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}/review`,
        cookieHeader,
        body: { rating: 3 },
        params: { id: cardId },
      }),
    );
    expect(firstReview.status).toBe(200);

    const secondReview = await PATCH_REVIEW(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}/review`,
        cookieHeader,
        body: { rating: 3 },
        params: { id: cardId },
      }),
    );
    expect(secondReview.status).toBe(200);

    const { data, error } = await adminClient().from("flashcards").select("reps").eq("id", cardId).single();
    expect(error).toBeNull();
    expect(data?.reps).toBe(2);
  });
});
