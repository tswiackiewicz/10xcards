import { test, expect } from "@playwright/test";
import type { Candidate } from "@/lib/flashcards/schemas";
import { gotoAndWaitForHydration } from "./navigate";

// Risk #2 (context/foundation/test-plan.md:45): "A rejected or un-actioned AI
// candidate is silently saved to the deck, or an explicitly accepted one is
// lost, in the review flow." Accept/reject/pending filtering is enforced
// entirely client-side in GenerateView.tsx (see
// tests/integration/risk2-review-save-contract.test.ts's header comment) — the
// save endpoint has no concept of accepted/rejected. Only a real browser can
// catch a UI regression that fails to filter before calling save. Two
// candidates are mocked so the same run proves both halves of the risk: the
// accepted one is saved, AND the rejected one is never silently saved.
//
// Real: auth (storageState from auth.setup.ts), routing, the real
// POST /api/flashcards save endpoint + DB insert, the /cards SSR read.
// Mocked: POST /api/flashcards/generate — the only external-AI-backed,
// non-deterministic call — intercepted at the network layer.
test("accepted AI candidate persists to the saved deck; rejected candidate does not", async ({ page }) => {
  const suffix = Date.now();
  const acceptedQuestion = `What is the capital of Testland ${suffix}?`;
  const rejectedQuestion = `What is the capital of Rejectland ${suffix}?`;
  const mockCandidates: Candidate[] = [
    { question: acceptedQuestion, answer: `Testville ${suffix}` },
    { question: rejectedQuestion, answer: `Rejectville ${suffix}` },
  ];

  await page.route("**/api/flashcards/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: mockCandidates }),
    });
  });

  await gotoAndWaitForHydration(page, "/generate");

  const sourceText = "Any source text — the generate call is mocked above, so content doesn't matter.";
  await page.getByRole("textbox", { name: "Paste your source text here…" }).fill(sourceText);
  await expect(page.getByText(`${sourceText.length} / 10,000`)).toBeVisible();

  await page.getByRole("button", { name: "Generate" }).click();

  // Wait for both mocked candidates to actually render — state, not time.
  // Each candidate is its own <li> (CandidateCard.tsx), and the per-card
  // Accept/Reject accessible names are identical across cards (there's also
  // an "Accept all"/"Reject all" pair), so scope by list-item index, not name.
  const cards = page.getByRole("listitem");
  await expect(cards).toHaveCount(2);

  await cards.nth(0).getByRole("button", { name: "Accept", exact: true }).click();
  await cards.nth(1).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("1 accepted")).toBeVisible();

  await page.getByRole("button", { name: "Save accepted" }).click();

  // This is the real save request (POST /api/flashcards) — the exact
  // behavior Risk #2 is about. Wait for its success banner, not a timeout.
  await expect(page.getByText("1 card saved to your deck.")).toBeVisible();

  // /generate itself never refetches the saved list — prove real persistence
  // (and real omission) via /cards, which is server-rendered fresh on every
  // request.
  await gotoAndWaitForHydration(page, "/cards");
  await expect(page.getByText(acceptedQuestion)).toBeVisible();
  await expect(page.getByText(rejectedQuestion)).not.toBeVisible();

  // --- Cleanup: delete the saved card via the real UI delete flow ---
  const card = page.getByRole("listitem").filter({ hasText: acceptedQuestion });
  await card.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Delete this card?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText(acceptedQuestion)).not.toBeVisible();
});
