// Risk #1 / Risk #2 — two branches of POST /api/flashcards that real local Supabase cannot
// trigger on demand: a missing client factory (env misconfiguration) and a failed insert
// (partial-failure mid-sequence). Per the two-layer strategy, these are hermetic stub tests,
// not integration tests — mocking the client here doesn't lie about RLS, since neither
// branch depends on RLS/DB behavior, only on the route's own guard logic.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/flashcards/index";
import { createClient } from "@/lib/supabase";
import { buildContext } from "../helpers/api-context";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

describe("Risk #1/#2 — POST /api/flashcards hermetic branches", () => {
  afterEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 unauthorized when the client factory yields no client", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const response = await POST(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards",
        cookieHeader: "irrelevant=1",
        body: { cards: [{ question: "should never save", answer: "should never save" }] },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 500 save_failed when the insert fails, without saving anything", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "insert failed" } });
    const fakeClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn().mockReturnValue({ insert }),
    };
    vi.mocked(createClient).mockReturnValue(fakeClient as unknown as ReturnType<typeof createClient>);

    const response = await POST(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards",
        cookieHeader: "irrelevant=1",
        body: { cards: [{ question: "never persisted", answer: "never persisted" }] },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "save_failed" });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
