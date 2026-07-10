import { test, expect, request as playwrightRequest } from "@playwright/test";
import { adminClient, cleanupUser, getAuthCookieHeader, seedUser } from "../helpers/auth";
import { gotoAndWaitForHydration } from "./navigate";

// Risk #3 (context/foundation/test-plan.md): cross-user direct-ID access to a flashcard.
// tests/integration/risk3-idor-not-found-equivalence.test.ts already proves 404-equivalence
// for all three by-id routes by invoking the route handlers directly with a hand-built
// APIContext. That test cannot prove the *live* server is wired the same way — this test
// drives one representative route (DELETE) through a real HTTP request, authenticated as a
// second real user, against a card actually owned by the storageState user (userA), and
// confirms the running dev server itself returns the same 404 the integration test asserts.
//
// Real: auth (storageState user = userA; a freshly seeded userB via seedUser()/
// getAuthCookieHeader()), routing, the real DELETE /api/flashcards/{id} endpoint, RLS, and
// the DB. Nothing is mocked. userA's card id is looked up via adminClient() purely to obtain
// the id for the cross-user attempt — the UI never surfaces raw card ids — not to bypass or
// assert anything about RLS itself.
test("a real HTTP DELETE, authenticated as a second user, against another user's card returns 404 from the live server", async ({
  page,
  baseURL,
}) => {
  const suffix = Date.now();
  const question = `What is the IDOR-equivalence question ${suffix}?`;
  const answer = `IDOR-equivalence answer ${suffix}`;

  // --- Setup: userA (storageState) creates a card via the real /create UI flow ---
  await gotoAndWaitForHydration(page, "/create");
  await page.getByRole("textbox", { name: "e.g. What does RLS stand for?" }).fill(question);
  await page.getByRole("textbox", { name: "e.g. Row-Level Security." }).fill(answer);
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.getByText("Card saved to your deck.")).toBeVisible();

  const { data, error } = await adminClient().from("flashcards").select("id").eq("question", question).single();
  if (error) throw error;
  const cardId = data.id;

  // --- Action + assertion: a fresh second user (userB) DELETEs userA's card over real HTTP ---
  const userB = await seedUser();
  try {
    const cookieB = await getAuthCookieHeader(userB.email, userB.password);
    // Astro's security.checkOrigin (astro.config.mjs) rejects unsafe-method requests whose
    // Origin doesn't match the request URL — a fresh APIRequestContext sends no Origin by
    // default, so it must be set explicitly to reach the app's actual 404 logic instead of
    // its CSRF guard.
    const apiContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: cookieB, Origin: baseURL },
    });
    try {
      const response = await apiContext.delete(`/api/flashcards/${cardId}`);
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    } finally {
      await apiContext.dispose();
    }
  } finally {
    await cleanupUser(userB.id);
  }

  // --- Cleanup: delete userA's card via the real UI delete flow ---
  await gotoAndWaitForHydration(page, "/cards");
  const card = page.getByRole("listitem").filter({ hasText: question });
  await card.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Delete this card?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText(question)).not.toBeVisible();
});
