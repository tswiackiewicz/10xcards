import { test, expect } from "@playwright/test";
import { gotoAndWaitForHydration } from "./navigate";

// Risk #8 (context/foundation/test-plan.md): route-protection drift.
// tests/integration/risk8-protected-routes-oracle.test.ts already proves the full
// 6-protected/4-public/6-near-miss matrix by invoking `onRequest` (src/middleware.ts)
// directly with a fabricated APIContext. That test cannot prove the *live* server
// actually redirects a real, unauthenticated browser — this test drives one route
// from each of the three categories through a real navigation and confirms the
// running dev server's behavior matches the integration test's oracle.
//
// This file overrides storageState to an empty cookie/origin set, so its tests run
// as a genuinely signed-out browser — the project-level authenticated storageState
// (from auth.setup.ts) does not apply here, and does not leak into other spec files.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out: a protected route redirects to /auth/signin, a public route and an adversarial near-miss stay reachable", async ({
  page,
}) => {
  // --- Protected route: /cards (EXPECTED_PROTECTED in the integration test) ---
  await gotoAndWaitForHydration(page, "/cards");
  await expect(page).toHaveURL("/auth/signin");

  // --- Public route: / (EXPECTED_PUBLIC in the integration test) ---
  await gotoAndWaitForHydration(page, "/");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "10x Astro Starter" })).toBeVisible();

  // --- Adversarial near-miss: /cardsxyz (ADVERSARIAL_NEAR_MISSES in the integration
  // test) — not a real page, but must NOT be swept into the /cards redirect by a
  // substring/prefix match on PROTECTED_ROUTES.
  await gotoAndWaitForHydration(page, "/cardsxyz");
  await expect(page).toHaveURL("/cardsxyz");
});
