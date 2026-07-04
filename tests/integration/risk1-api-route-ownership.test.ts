// Risk #1 — proves the application's own route handlers (not just the raw RLS policy)
// enforce ownership: a route using the wrong client, or forgetting the 0-row → 404
// translation, could silently bypass RLS even if the policy itself is correct. Covers the
// three routes that mutate an existing flashcard by id: PATCH/DELETE /api/flashcards/[id]
// and PATCH /api/flashcards/[id]/review. Route handlers are invoked directly (real Request,
// real @supabase/ssr client, real local Supabase instance) — only the outermost Astro HTTP
// transport is faked, via buildContext.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/pages/api/flashcards/index";
import { PATCH as PATCH_CARD, DELETE } from "@/pages/api/flashcards/[id]";
import { PATCH as PATCH_REVIEW } from "@/pages/api/flashcards/[id]/review";
import { buildContext } from "../helpers/api-context";
import { cleanupUser, getAuthCookieHeader, seedUser, signInDirect, type TestUser } from "../helpers/auth";

describe("Risk #1 — route-wiring ownership (by-id flashcard mutation routes)", () => {
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
  });

  afterAll(async () => {
    await cleanupUser(userA.id);
    await cleanupUser(userB.id);
  });

  it("user A can create a card via the real POST /api/flashcards handler", async () => {
    const response = await POST(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards",
        cookieHeader: cookieA,
        body: { cards: [{ question: "route-ownership question", answer: "route-ownership answer" }] },
      }),
    );
    expect(response.status).toBe(200);
    const saved = (await response.json()) as { saved: number };
    expect(saved.saved).toBe(1);

    // The route contract returns only a count, not the row — read it back via A's own
    // session (real DB call, not a mock) so later route tests have a real id to target.
    const asA = await signInDirect(userA);
    const { data } = await asA
      .from("flashcards")
      .select("id")
      .eq("question", "route-ownership question")
      .single()
      .throwOnError();
    cardId = data.id;
  });

  it("B's PATCH of A's card returns 404 not_found", async () => {
    const response = await PATCH_CARD(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}`,
        cookieHeader: cookieB,
        body: { question: "hacked by B", answer: "hacked by B" },
        params: { id: cardId },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("A's PATCH of its own card returns 200 with updated:1", async () => {
    const response = await PATCH_CARD(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}`,
        cookieHeader: cookieA,
        body: { question: "edited question", answer: "edited answer" },
        params: { id: cardId },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1 });
  });

  it("B's review PATCH of A's card returns 404 not_found", async () => {
    const response = await PATCH_REVIEW(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}/review`,
        cookieHeader: cookieB,
        body: { rating: 3 },
        params: { id: cardId },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("A's review PATCH of its own card returns 200 with a due date", async () => {
    const response = await PATCH_REVIEW(
      buildContext({
        method: "PATCH",
        url: `http://localhost/api/flashcards/${cardId}/review`,
        cookieHeader: cookieA,
        body: { rating: 3 },
        params: { id: cardId },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { due: string };
    expect(typeof body.due).toBe("string");
  });

  it("B's DELETE of A's card returns 404 not_found", async () => {
    const response = await DELETE(
      buildContext({
        method: "DELETE",
        url: `http://localhost/api/flashcards/${cardId}`,
        cookieHeader: cookieB,
        params: { id: cardId },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("A's DELETE of its own card returns 200 with deleted:1", async () => {
    const response = await DELETE(
      buildContext({
        method: "DELETE",
        url: `http://localhost/api/flashcards/${cardId}`,
        cookieHeader: cookieA,
        params: { id: cardId },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
  });
});
