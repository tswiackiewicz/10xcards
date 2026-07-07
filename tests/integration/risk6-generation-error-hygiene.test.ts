// Risk #6 — no AI-generation error response may leak the user's raw source text or
// provider internals. Closes the two acknowledged coverage gaps from Phase 2's
// mutation-testing pass (rate_limited, the generic ai_unavailable catch-all) and locks
// in the allowed-fields-shape guarantee across every reachable branch of
// src/pages/api/flashcards/generate.ts. MSW mocks only the OpenRouter HTTP edge — the
// route's own auth check still hits real local Supabase, so the server's lifecycle is
// driven locally (not via vitest.config.ts's global setupFiles) with
// onUnhandledRequest: "bypass", or it would intercept that real Supabase call too.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { POST as GENERATE } from "@/pages/api/flashcards/generate";
import { MAX_INPUT_CHARS } from "@/lib/flashcards/schemas";
import { server } from "../setup/msw";
import { cleanupUser, getAuthCookieHeader, seedUser, type TestUser } from "../helpers/auth";
import { buildContext } from "../helpers/api-context";

// Mirrors the private OPENROUTER_URL constant in src/lib/flashcards/generation.ts.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function openRouterSuccess(cards: { question: string; answer: string }[]) {
  return HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ cards }) } }] });
}

describe("Risk #6 — generation endpoint error-response data hygiene", () => {
  let user: TestUser;
  let cookie: string;

  beforeAll(async () => {
    server.listen({ onUnhandledRequest: "bypass" });
    user = await seedUser();
    cookie = await getAuthCookieHeader(user.email, user.password);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await cleanupUser(user.id);
  });

  it("returns 429 rate_limited exactly when OpenRouter responds 429", async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.json({}, { status: 429 })));

    const response = await GENERATE(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards/generate",
        cookieHeader: cookie,
        body: { text: "some source material" },
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  it("returns 502 ai_unavailable exactly on a network failure, with no leaked error message (also covers timeout collapse — same bare catch, see plan.md)", async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.error()));

    const response = await GENERATE(
      buildContext({
        method: "POST",
        url: "http://localhost/api/flashcards/generate",
        cookieHeader: cookie,
        body: { text: "some source material" },
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "ai_unavailable" });
  });

  const branchCases: {
    name: string;
    status: number;
    error: string;
    cookie: boolean;
    text?: unknown;
    mock?: () => void;
  }[] = [
    { name: "no session cookie", status: 401, error: "unauthorized", cookie: false },
    { name: "non-string text", status: 400, error: "invalid_input", cookie: true, text: 123 },
    { name: "empty text", status: 400, error: "empty_input", cookie: true, text: "" },
    { name: "over-cap text", status: 400, error: "too_long", cookie: true, text: "a".repeat(MAX_INPUT_CHARS + 1) },
    {
      name: "well-formed empty result",
      status: 422,
      error: "no_cards",
      cookie: true,
      text: "valid text",
      mock: () => {
        server.use(http.post(OPENROUTER_URL, () => openRouterSuccess([])));
      },
    },
    {
      name: "provider rate limit",
      status: 429,
      error: "rate_limited",
      cookie: true,
      text: "valid text",
      mock: () => {
        server.use(http.post(OPENROUTER_URL, () => HttpResponse.json({}, { status: 429 })));
      },
    },
    {
      name: "provider network failure",
      status: 502,
      error: "ai_unavailable",
      cookie: true,
      text: "valid text",
      mock: () => {
        server.use(http.post(OPENROUTER_URL, () => HttpResponse.error()));
      },
    },
  ];

  it.each(branchCases)(
    "every branch ($name) returns only { error } — no extra fields, no leaked internals",
    async ({ status, error, cookie: withCookie, text, mock }) => {
      mock?.();

      const response = await GENERATE(
        buildContext({
          method: "POST",
          url: "http://localhost/api/flashcards/generate",
          cookieHeader: withCookie ? cookie : undefined,
          body: text !== undefined ? { text } : undefined,
        }),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    },
  );
});
