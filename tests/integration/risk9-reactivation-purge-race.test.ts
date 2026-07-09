// Risk #9 — a user cancels a pending account deletion, but a purge run concurrent with
// or immediately after the cancellation must not still erase their data. Proves both real,
// sequential orderings against a real local Supabase instance: cancellation-before-purge
// always survives, and purge-before-cancellation is a deterministic, documented no-op for
// the late reactivation, not data loss in either direction. Mirrors
// tests/integration/risk4-purge-boundary.test.ts's userExists helper pattern.
import { afterAll, describe, expect, it } from "vitest";
import { POST as PURGE } from "@/pages/api/cron/purge";
import { POST as REACTIVATE } from "@/pages/api/account/reactivate";
import { adminClient, cleanupUser, getAuthCookieHeader, seedUser, type TestUser } from "../helpers/auth";
import { seedAccountDeletion } from "../helpers/account-deletion";
import { buildContext } from "../helpers/api-context";

const VALID_AUTH = { Authorization: "Bearer test-purge-secret" };

async function userExists(id: string): Promise<boolean> {
  const { error } = await adminClient().auth.admin.getUserById(id);
  return !error;
}

describe("Risk #9 — reactivation/purge ordering", () => {
  const seededUsers: TestUser[] = [];

  afterAll(async () => {
    await Promise.all(seededUsers.map((u) => cleanupUser(u.id)));
  });

  it("cancellation before purge always survives", async () => {
    const user = await seedUser();
    seededUsers.push(user);
    await seedAccountDeletion(user.id, 31, 0); // clearly eligible

    const cookieHeader = await getAuthCookieHeader(user.email, user.password);
    const cancelResponse = await REACTIVATE(
      buildContext({ method: "POST", url: "http://localhost/api/account/reactivate", cookieHeader }),
    );
    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.json()).toEqual({ ok: true });

    const purgeResponse = await PURGE(
      buildContext({ method: "POST", url: "http://localhost/api/cron/purge", headers: VALID_AUTH }),
    );
    expect(purgeResponse.status).toBe(200);
    expect(await userExists(user.id)).toBe(true);
  });

  it("purge before a late cancellation is a deterministic no-op, not an error", async () => {
    const user = await seedUser();
    seededUsers.push(user);
    await seedAccountDeletion(user.id, 31, 0); // clearly eligible

    // Mint the session cookie before purge erases the auth user — mirrors a request that
    // was already in flight when the purge ran.
    const cookieHeader = await getAuthCookieHeader(user.email, user.password);

    const purgeResponse = await PURGE(
      buildContext({ method: "POST", url: "http://localhost/api/cron/purge", headers: VALID_AUTH }),
    );
    expect(purgeResponse.status).toBe(200);
    expect(await userExists(user.id)).toBe(false);

    // Deterministic no-op, but not the shape the plan assumed: purge deleting the auth
    // user invalidates the session before reactivate.ts's own delete-and-check-0-rows
    // logic is ever reached — supabase.auth.getUser() itself now fails against GoTrue
    // (the user record is gone), so the route 401s at the auth gate. There's no window
    // where a late cancellation could even attempt to act on an already-purged account.
    const lateCancelResponse = await REACTIVATE(
      buildContext({ method: "POST", url: "http://localhost/api/account/reactivate", cookieHeader }),
    );
    expect(lateCancelResponse.status).toBe(401);
    expect(await lateCancelResponse.json()).toEqual({ error: "unauthorized" });
    expect(await userExists(user.id)).toBe(false);
  });
});
