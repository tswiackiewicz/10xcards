import { test, expect } from "@playwright/test";
import { gotoAndWaitForHydration } from "./navigate";

// The landing page has exactly one job for a logged-out visitor: explain what
// 10xCards does, and route them into the funnel. This spec guards that job —
// the pitch is on screen, and both entry points actually go where they claim.
//
// Colors, copy details, and layout are deliberately NOT asserted (the plan ships
// no visual-regression tests); only the heading that identifies the page and the
// two navigations that would silently strand a visitor if they broke.
//
// storageState is overridden to an empty set so this runs as a genuinely
// signed-out browser — the project-level authenticated state from auth.setup.ts
// would otherwise render the "Open dashboard" hero variant instead.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out landing: the pitch is visible and both entry points route into the funnel", async ({ page }) => {
  await gotoAndWaitForHydration(page, "/");

  await expect(page.getByRole("heading", { name: "Paste your notes. Remember them forever." })).toBeVisible();
  // The brand mark doubles as the home link; Logo.astro carries the accessible name.
  await expect(page.getByLabel("10xCards").first()).toBeVisible();

  // --- Header "Log in" → /auth/signin ---
  await page.getByRole("link", { name: "Log in" }).first().click();
  await page.waitForURL("/auth/signin");

  // --- Hero primary CTA → /auth/signup ---
  await gotoAndWaitForHydration(page, "/");
  await page.getByRole("link", { name: "Start learning free" }).first().click();
  await page.waitForURL("/auth/signup");
});
