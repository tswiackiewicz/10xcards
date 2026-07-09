import type { Page } from "@playwright/test";
import { waitForAstroHydration } from "./wait-for-hydration";

export async function gotoAndWaitForHydration(
  page: Page,
  url: string,
  options?: Parameters<Page["goto"]>[1],
): Promise<void> {
  await page.goto(url, options);
  await waitForAstroHydration(page);
}

export async function reloadAndWaitForHydration(page: Page, options?: Parameters<Page["reload"]>[0]): Promise<void> {
  await page.reload(options);
  await waitForAstroHydration(page);
}
