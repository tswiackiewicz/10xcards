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

  // Both the header and the hero render a "Log in" link, and both the hero and the
  // bottom CTA band render "Start learning free". Scope each click to its region so
  // the spec asserts *which* control it exercised, instead of taking whatever came
  // first in the DOM.
  const hero = page.getByRole("region", { name: "Paste your notes. Remember them forever." });
  // The brand mark doubles as the home link; its accessible name comes from the
  // wordmark text inside it, which is what a screen-reader user actually hears.
  await expect(page.getByRole("link", { name: "10xCards" })).toBeVisible();

  // --- Header "Log in" → /auth/signin ---
  await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
  await page.waitForURL("/auth/signin");

  // --- Hero primary CTA → /auth/signup ---
  await gotoAndWaitForHydration(page, "/");
  await hero.getByRole("link", { name: "Start learning free" }).click();
  await page.waitForURL("/auth/signup");
});
