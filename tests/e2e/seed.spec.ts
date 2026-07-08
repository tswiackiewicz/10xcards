import { test, expect } from "@playwright/test";
import type { Candidate } from "@/lib/flashcards/schemas";
import { waitForAstroHydration } from "./wait-for-hydration";

// Risk #2 (context/foundation/test-plan.md:45): "A rejected or un-actioned AI
// candidate is silently saved to the deck, or an explicitly accepted one is
// lost, in the review flow." Accept/reject/pending filtering is enforced
// entirely client-side in GenerateView.tsx (see
// tests/integration/risk2-review-save-contract.test.ts's header comment) — the
// save endpoint has no concept of accepted/rejected. Only a real browser can
// catch a UI regression that fails to filter before calling save.
//
// Real: auth (storageState from auth.setup.ts), routing, the real
// POST /api/flashcards save endpoint + DB insert, the /cards SSR read.
// Mocked: POST /api/flashcards/generate — the only external-AI-backed,
// non-deterministic call — intercepted at the network layer.
test("accepted AI candidate persists to the saved deck", async ({ page }) => {
  const suffix = Date.now();
  const uniqueQuestion = `What is the capital of Testland ${suffix}?`;
  const mockCandidate: Candidate = { question: uniqueQuestion, answer: `Testville ${suffix}` };

  await page.route("**/api/flashcards/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [mockCandidate] }),
    });
  });

  await page.goto("/generate");
  await waitForAstroHydration(page);

  const sourceText = "Any source text — the generate call is mocked above, so content doesn't matter.";
  await page.getByRole("textbox", { name: "Paste your source text here…" }).fill(sourceText);
  await expect(page.getByText(`${sourceText.length} / 10,000`)).toBeVisible();

  await page.getByRole("button", { name: "Generate" }).click();

  // Wait for the mocked candidate to actually render — state, not time.
  // Exactly one mocked candidate keeps the per-card "Accept" button
  // unambiguous (there's also an "Accept all" button, hence exact: true).
  const acceptButton = page.getByRole("button", { name: "Accept", exact: true });
  await expect(acceptButton).toBeVisible();
  await acceptButton.click();
  await expect(page.getByText("1 accepted")).toBeVisible();

  await page.getByRole("button", { name: "Save accepted" }).click();

  // This is the real save request (POST /api/flashcards) — the exact
  // behavior Risk #2 is about. Wait for its success banner, not a timeout.
  await expect(page.getByText("1 card saved to your deck.")).toBeVisible();

  // /generate itself never refetches the saved list — prove real persistence
  // via /cards, which is server-rendered fresh on every request.
  await page.goto("/cards");
  await expect(page.getByText(uniqueQuestion)).toBeVisible();
});
