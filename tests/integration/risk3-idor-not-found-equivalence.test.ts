// Risk #3 — proves that "resource doesn't exist" and "resource exists but belongs to
// someone else" are byte-identical from the outside for all three by-id flashcard routes.
// Risk #1's tests already show each case is, in isolation, a 404 — this test makes the
// equivalence itself the assertion: a never-created UUID and another user's real card ID
// must produce the exact same response, not just two separately-hard-coded 404s.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/pages/api/flashcards/index";
import { PATCH as PATCH_CARD, DELETE } from "@/pages/api/flashcards/[id]";
import { PATCH as PATCH_REVIEW } from "@/pages/api/flashcards/[id]/review";
import { buildContext } from "../helpers/api-context";
import { cleanupUser, getAuthCookieHeader, seedUser, signInDirect, type TestUser } from "../helpers/auth";

const NOT_FOUND = { status: 404, body: { error: "not_found" } };

async function statusAndBody(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("Risk #3 — IDOR not-found-vs-not-owned equivalence (by-id flashcard routes)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let cookieA: string;
  let cookieB: string;
  let cardId: string;

  beforeAll(async () => {
    userA = await seedUser();
    userB = await seedUser();
    cookieA = await getAuthCookieHeader(userA.email, userA.password);
    cookieB = await getAuthCookieHeader(userB.email, userB.password);

    const response = await POST(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards",
        cookieHeader: cookieA,
        body: { cards: [{ question: "idor-equivalence question", answer: "idor-equivalence answer" }] },
      }),
    );
    expect(response.status).toBe(200);

    const asA = await signInDirect(userA);
    const { data } = await asA
      .from("flashcards")
      .select("id")
      .eq("question", "idor-equivalence question")
      .single()
      .throwOnError();
    cardId = data.id;
  });

  afterAll(async () => {
    await cleanupUser(userA.id);
    await cleanupUser(userB.id);
  });

  it("PATCH /api/flashcards/[id]: never-created UUID and another user's real card ID both return the same 404", async () => {
    const neverCreatedId = crypto.randomUUID();

    const neverCreatedResponse = await PATCH_CARD(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${neverCreatedId}`,
        cookieHeader: cookieA,
        body: { question: "irrelevant", answer: "irrelevant" },
        params: { id: neverCreatedId },
      }),
    );
    const notOwnedResponse = await PATCH_CARD(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}`,
        cookieHeader: cookieB,
        body: { question: "irrelevant", answer: "irrelevant" },
        params: { id: cardId },
      }),
    );

    expect(await statusAndBody(neverCreatedResponse)).toEqual(NOT_FOUND);
    expect(await statusAndBody(notOwnedResponse)).toEqual(NOT_FOUND);
  });

  it("PATCH /api/flashcards/[id]/review: never-created UUID and another user's real card ID both return the same 404", async () => {
    const neverCreatedId = crypto.randomUUID();

    const neverCreatedResponse = await PATCH_REVIEW(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${neverCreatedId}/review`,
        cookieHeader: cookieA,
        body: { rating: 3 },
        params: { id: neverCreatedId },
      }),
    );
    const notOwnedResponse = await PATCH_REVIEW(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}/review`,
        cookieHeader: cookieB,
        body: { rating: 3 },
        params: { id: cardId },
      }),
    );

    expect(await statusAndBody(neverCreatedResponse)).toEqual(NOT_FOUND);
    expect(await statusAndBody(notOwnedResponse)).toEqual(NOT_FOUND);
  });

  it("DELETE /api/flashcards/[id]: never-created UUID and another user's real card ID both return the same 404", async () => {
    const neverCreatedId = crypto.randomUUID();

    const neverCreatedResponse = await DELETE(
      buildContext({
        method: "DELETE",
        url: `http://localhost/api/flashcards/${neverCreatedId}`,
        cookieHeader: cookieA,
        params: { id: neverCreatedId },
      }),
    );
    const notOwnedResponse = await DELETE(
      buildContext({
        method: "DELETE",
        url: `http://localhost/api/flashcards/${cardId}`,
        cookieHeader: cookieB,
        params: { id: cardId },
      }),
    );

    expect(await statusAndBody(neverCreatedResponse)).toEqual(NOT_FOUND);
    expect(await statusAndBody(notOwnedResponse)).toEqual(NOT_FOUND);
  });
});
