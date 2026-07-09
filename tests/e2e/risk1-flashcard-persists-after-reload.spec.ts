import { test, expect } from "@playwright/test";
import { gotoAndWaitForHydration, reloadAndWaitForHydration } from "./navigate";

// Risk #1 (context/foundation/test-plan.md): "A user's saved flashcards
// silently disappear, or become visible/editable by a different account."
// (Impact: High, Likelihood: High.) The cross-user-visibility half of this
// risk is already proven by integration tests
// (tests/integration/risk1-rls-isolation.test.ts,
// tests/integration/risk1-api-route-ownership.test.ts), which call route
// handlers directly. What those tests cannot prove is that a saved card is
// actually persisted to the DB rather than merely sitting in client-side
// React state — that requires a real browser doing a real SSR page reload,
// which only re-renders from a fresh `select("*")` against Postgres (see
// src/pages/cards.astro). This test is modeled on seed.spec.ts (Risk #2):
// role-based locators, own setup/action/assertion/cleanup, unique
// timestamp-suffixed data, wait-for-state not time.
//
// Real: auth (storageState from auth.setup.ts), routing, the real
// POST /api/flashcards/manual save endpoint, the real DB write, and the real
// SSR read on /cards. Nothing is mocked — unlike seed.spec.ts's AI-generate
// call, this flow has no external/non-deterministic dependency.
test("a manually saved flashcard survives a real SSR page reload on /cards", async ({ page }) => {
  const suffix = Date.now();
  const question = `What is the SI unit of resistance ${suffix}?`;
  const answer = `Ohm ${suffix}`;

  // --- Setup + action: create the card via the real manual-save flow ---
  await gotoAndWaitForHydration(page, "/create");

  // ManualCardForm's textareas have no <label htmlFor>/id association — like
  // seed.spec.ts's generate-page textarea, their accessible name comes from
  // the placeholder, so getByRole(..., { name: <placeholder> }) is the
  // correct locator here, not getByLabel (which would find nothing).
  await page.getByRole("textbox", { name: "e.g. What does RLS stand for?" }).fill(question);
  await page.getByRole("textbox", { name: "e.g. Row-Level Security." }).fill(answer);
  await page.getByRole("button", { name: "Save card" }).click();

  // This is the real save request (POST /api/flashcards/manual) completing.
  await expect(page.getByText("Card saved to your deck.")).toBeVisible();

  // --- Assertion: visible on /cards before reload ---
  await gotoAndWaitForHydration(page, "/cards");
  await expect(page.getByText(question)).toBeVisible();

  // --- The real regression check: a fresh SSR request must still render it ---
  await reloadAndWaitForHydration(page);
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText(answer)).toBeVisible();

  // --- Cleanup: delete via the real UI delete flow ---
  const card = page.getByRole("listitem").filter({ hasText: question });
  await card.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Delete this card?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText(question)).not.toBeVisible();
});
