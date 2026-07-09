// Risk #4 — a per-row auth.admin.deleteUser failure mid-batch must be counted and
// surfaced as a non-2xx response, not masked. Real Supabase can't produce this state on
// demand: account_deletions.user_id has an ON DELETE CASCADE FK to auth.users, so
// deleting the auth user out-of-band also deletes its account_deletions row before purge
// ever sees it. Hermetic, mocked admin-client stub only — mirrors the precedent in
// tests/unit/risk1-risk2-save-endpoint-hermetic.test.ts for branches that don't depend
// on RLS/DB behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as PURGE } from "@/pages/api/cron/purge";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildContext } from "../helpers/api-context";

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("Risk #4 — purge partial-batch-failure reporting (hermetic)", () => {
  afterEach(() => {
    vi.mocked(createAdminClient).mockReset();
  });

  it("returns 500 with correct deleted/errors counts when one row's deleteUser fails", async () => {
    const advisoryQuery = {
      select: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ count: 2, error: null }),
    };
    const claimQuery = {
      delete: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [
          { user_id: "user-fails", requested_at: "2026-01-01T00:00:00.000Z" },
          { user_id: "user-succeeds", requested_at: "2026-01-02T00:00:00.000Z" },
        ],
        error: null,
      }),
    };
    const reinsertQuery = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const deleteUser = vi
      .fn()
      .mockImplementation((id: string) =>
        id === "user-fails" ? Promise.resolve({ error: { message: "boom" } }) : Promise.resolve({ error: null }),
      );
    let call = 0;
    const fakeAdmin = {
      from: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) return advisoryQuery;
        if (call === 2) return claimQuery;
        return reinsertQuery;
      }),
      auth: { admin: { deleteUser } },
    };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin as unknown as ReturnType<typeof createAdminClient>);

    const response = await PURGE(
      buildContext({
        method: "POST",
        url: "http://localhost/api/cron/purge",
        headers: { Authorization: "Bearer test-purge-secret" },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ deleted: 1, skipped: 0, errors: 1 });
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });
});
