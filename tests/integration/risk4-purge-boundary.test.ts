// Risk #4 — the purge route (src/pages/api/cron/purge.ts) must erase exactly the
// accounts past the 30-day retention boundary, and only when called with the correct
// bearer secret. Boundary rows are seeded at 29d23h/30d5m — not exactly 29/30 days —
// so the test doesn't race the few-ms gap between seeding "now" and the route's own
// `Date.now()` cutoff (see plan.md's Critical Implementation Details).
import { afterAll, describe, expect, it } from "vitest";
import { POST as PURGE } from "@/pages/api/cron/purge";
import { adminClient, cleanupUser, seedUser, type TestUser } from "../helpers/auth";
import { seedAccountDeletion } from "../helpers/account-deletion";
import { buildContext } from "../helpers/api-context";

const VALID_AUTH = { Authorization: "Bearer test-purge-secret" };

async function userExists(id: string): Promise<boolean> {
  const { error } = await adminClient().auth.admin.getUserById(id);
  return !error;
}

describe("Risk #4 — purge route boundary and auth gate", () => {
  const seededUsers: TestUser[] = [];

  afterAll(async () => {
    await Promise.all(seededUsers.map((u) => cleanupUser(u.id)));
  });

  it("a row just short of 30 days old is NOT purged", async () => {
    const user = await seedUser();
    seededUsers.push(user);
    await seedAccountDeletion(user.id, 29, 23 * 60); // 29 days + 23 hours ago

    const response = await PURGE(
      buildContext({ method: "POST", url: "http://localhost/api/cron/purge", headers: VALID_AUTH }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; skipped: number };
    expect(body.deleted).toBe(0);
    expect(await userExists(user.id)).toBe(true);
  });

  it("a row just past 30 days old IS purged", async () => {
    const user = await seedUser();
    seededUsers.push(user);
    await seedAccountDeletion(user.id, 30, 5); // 30 days + 5 minutes ago

    const response = await PURGE(
      buildContext({ method: "POST", url: "http://localhost/api/cron/purge", headers: VALID_AUTH }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; skipped: number };
    expect(body.deleted).toBeGreaterThanOrEqual(1);
    expect(await userExists(user.id)).toBe(false);
  });

  it("a missing/incorrect bearer token is rejected and touches nothing", async () => {
    const user = await seedUser();
    seededUsers.push(user);
    await seedAccountDeletion(user.id, 31, 0); // clearly eligible, to prove it's untouched

    const noAuth = await PURGE(buildContext({ method: "POST", url: "http://localhost/api/cron/purge" }));
    expect(noAuth.status).toBe(401);
    expect(await noAuth.json()).toEqual({ error: "unauthorized" });

    const wrongAuth = await PURGE(
      buildContext({
        method: "POST",
        url: "http://localhost/api/cron/purge",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(wrongAuth.status).toBe(401);
    expect(await userExists(user.id)).toBe(true);
  });
});
