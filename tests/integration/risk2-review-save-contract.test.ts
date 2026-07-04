// Risk #2 — the AI-review human-gating decision (accept vs. reject/pending) is enforced
// entirely client-side, before this request is ever constructed (GenerateView.tsx's
// accept-filter, lines 86-94). This test proves the save endpoint persists exactly the
// accepted (possibly edited) subset it's given — it is NOT a server-side invariant: the
// endpoint has no concept of accept/reject/pending and would happily save an extra,
// unexpected card if one were included in the request body (see plan Phase 3 manual
// verification step for a direct `curl` confirmation of that caveat).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/pages/api/flashcards/index";
import { buildContext } from "../helpers/api-context";
import { cleanupUser, getAuthCookieHeader, seedUser, signInDirect, type TestUser } from "../helpers/auth";

describe("Risk #2 — AI review human-gating: save endpoint persists exactly the accepted set", () => {
  let user: TestUser;
  let cookie: string;

  beforeAll(async () => {
    user = await seedUser();
    cookie = await getAuthCookieHeader(user.email, user.password);
  });

  afterAll(async () => {
    await cleanupUser(user.id);
  });

  it("saves exactly the accepted (verbatim + edited) subset — not the rejected/pending ones", async () => {
    // Mirrors what GenerateView.tsx's accept-filter constructs: only cards whose review
    // status is "accepted" ever reach this body. A rejected and a pending candidate from
    // the same review batch are deliberately never included — their absence here IS the
    // human-gating proof; the server never sees them at all.
    const response = await POST(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards",
        cookieHeader: cookie,
        body: {
          cards: [
            { question: "verbatim-accepted question", answer: "verbatim-accepted answer" },
            { question: "edited-accepted question", answer: "edited answer (post-review edit)" },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: 2 });

    const asUser = await signInDirect(user);
    const { data, error } = await asUser.from("flashcards").select("*");
    expect(error).toBeNull();

    // Exactly the accepted set for this user — nothing beyond it leaked in.
    expect(data).toHaveLength(2);

    const byQuestion = new Map((data ?? []).map((row) => [row.question, row]));
    expect(byQuestion.get("verbatim-accepted question")).toMatchObject({
      answer: "verbatim-accepted answer",
      source: "ai",
    });
    expect(byQuestion.get("edited-accepted question")).toMatchObject({
      answer: "edited answer (post-review edit)",
      source: "ai",
    });
  });
});
