import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup } from "@playwright/test";
import { seedUser } from "../helpers/auth";
import { gotoAndWaitForHydration } from "./navigate";
import { SEEDED_USER_PATH, STORAGE_STATE_PATH } from "./paths";

setup("authenticate", async ({ page }) => {
  const user = await seedUser();

  // Persist the seeded user id before attempting login, so teardown can still
  // clean it up even if sign-in fails below.
  mkdirSync(dirname(SEEDED_USER_PATH), { recursive: true });
  writeFileSync(SEEDED_USER_PATH, JSON.stringify({ id: user.id }));

  await gotoAndWaitForHydration(page, "/auth/signin");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // src/pages/api/auth/signin.ts (a real <form method="POST"> — no fetch
  // interception in SignInForm.tsx, so the browser follows the server's
  // redirect natively) sends a normal, non-pending-deletion account to
  // "/dashboard". A freshly seeded user is never in account_deletions, so
  // "/dashboard" is the deterministic, verified target — wait for that
  // navigation, not a timeout.
  await page.waitForURL("/dashboard");

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
