// Risk #9 — the atomic claim query must be the sole source of truth for which rows
// purge.ts actually deletes. This mocked test proves deleteUser is called exactly once
// per row the claim's delete-and-return actually returned, and never for a row that was
// merely counted by the separate, advisory-only backlog count — the causal mechanism
// that closes the reactivation/purge race (a row cancelled between the advisory count
// and the claim must never be purged). Mirrors
// tests/unit/risk4-purge-partial-failure-hermetic.test.ts's mocked-admin-client pattern.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as PURGE } from "@/pages/api/cron/purge";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildContext } from "../helpers/api-context";

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("Risk #9 — purge claim hermetic regression guard", () => {
  afterEach(() => {
    vi.mocked(createAdminClient).mockReset();
  });

  it("deleteUser is called only for rows the claim actually returned, never for the stale advisory count", async () => {
    // Advisory count reports 3 eligible rows moments ago; by the time the claim runs, a
    // concurrent cancellation has already removed one — the claim returns only 2 rows.
    const advisoryQuery = {
      select: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ count: 3, error: null }),
    };
    const claimQuery = {
      delete: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [
          { user_id: "user-a", requested_at: "2026-01-01T00:00:00.000Z" },
          { user_id: "user-b", requested_at: "2026-01-02T00:00:00.000Z" },
        ],
        error: null,
      }),
    };
    let call = 0;
    const from = vi.fn().mockImplementation(() => {
      call++;
      return call === 1 ? advisoryQuery : claimQuery;
    });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const fakeAdmin = { from, auth: { admin: { deleteUser } } };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin as unknown as ReturnType<typeof createAdminClient>);

    const response = await PURGE(
      buildContext({
        method: "POST",
        url: "http://localhost/api/cron/purge",
        headers: { Authorization: "Bearer test-purge-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(deleteUser).toHaveBeenCalledWith("user-a");
    expect(deleteUser).toHaveBeenCalledWith("user-b");
    expect(deleteUser).not.toHaveBeenCalledWith("user-missing");

    const body = (await response.json()) as { deleted: number; skipped: number };
    expect(body.deleted).toBe(2);
    // skipped = advisory count (3) minus what the claim actually returned (2)
    expect(body.skipped).toBe(1);
  });

  it("re-inserts the claimed row when deleteUser fails, so a future run can retry it", async () => {
    // deleteUser failing after the claim already deleted the tracking row must not
    // permanently drop the user from the purge backlog — without a re-insert, the
    // account would silently lose its pending-deletion state (is_pending_deletion()
    // keys off the row's presence) despite never actually being deleted or reactivated.
    const advisoryQuery = {
      select: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ count: 1, error: null }),
    };
    const claimQuery = {
      delete: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ user_id: "user-c", requested_at: "2026-01-03T00:00:00.000Z" }],
        error: null,
      }),
    };
    const insert = vi.fn().mockResolvedValue({ error: null });
    const reinsertQuery = { insert };
    let call = 0;
    const from = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return advisoryQuery;
      if (call === 2) return claimQuery;
      return reinsertQuery;
    });
    const deleteUser = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const fakeAdmin = { from, auth: { admin: { deleteUser } } };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin as unknown as ReturnType<typeof createAdminClient>);

    const response = await PURGE(
      buildContext({
        method: "POST",
        url: "http://localhost/api/cron/purge",
        headers: { Authorization: "Bearer test-purge-secret" },
      }),
    );

    expect(response.status).toBe(500);
    expect(deleteUser).toHaveBeenCalledWith("user-c");
    expect(insert).toHaveBeenCalledWith({ user_id: "user-c", requested_at: "2026-01-03T00:00:00.000Z" });

    const body = (await response.json()) as { deleted: number; errors: number };
    expect(body.deleted).toBe(0);
    expect(body.errors).toBe(1);
  });
});
