import type { Page } from "@playwright/test";

/**
 * Astro's client:load islands render server-side with an `ssr` attribute on
 * their <astro-island> wrapper; the astro-island custom element removes that
 * attribute the instant client-side hydration completes (see
 * astro/dist/runtime/server/astro-island.js's hydrate()). Interacting with a
 * controlled React field before this fires can update the DOM without ever
 * notifying React's state — this is the reliable state signal to wait on
 * first, not a fixed delay.
 */
export async function waitForAstroHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('astro-island[client="load"][ssr]'));
}
