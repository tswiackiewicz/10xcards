// Risk #8 — every real page under src/pages/** that should require a session actually
// redirects an unauthenticated visitor to /auth/signin, every other real page stays
// reachable, and fabricated near-miss paths (e.g. /studying) aren't swept in by a raw
// substring match on PROTECTED_ROUTES (src/middleware.ts). EXPECTED_PROTECTED/
// EXPECTED_PUBLIC below are hand-authored independently of PROTECTED_ROUTES — not
// copied from it — and cross-checked against a real filesystem walk, so a route added
// without a matching entry here fails this test instead of silently drifting.
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onRequest } from "@/middleware";
import { seedUser, cleanupUser, getAuthCookieHeader, type TestUser } from "../helpers/auth";
import { buildContext } from "../helpers/api-context";

const PAGES_DIR = "src/pages";

function toRoute(relPath: string): string {
  const segments = relPath.replace(/\.astro$/, "").split("/");
  if (segments[segments.length - 1] === "index") segments.pop();
  return `/${segments.join("/")}`;
}

const DISCOVERED_ROUTES = new Set(
  readdirSync(PAGES_DIR, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry.endsWith(".astro") && !entry.startsWith("api/"))
    .map(toRoute),
);

// Hand-authored expectations, independently derived from the app's routes — not copied
// from src/middleware.ts's PROTECTED_ROUTES array.
const EXPECTED_PROTECTED = new Set(["/dashboard", "/generate", "/create", "/cards", "/study", "/account"]);
const EXPECTED_PUBLIC = new Set(["/", "/auth/confirm-email", "/auth/signin", "/auth/signup"]);

// One fabricated near-miss per protected prefix — none are real pages.
const ADVERSARIAL_NEAR_MISSES = ["/dashboards", "/generated", "/created", "/cardsxyz", "/studying", "/accountant"];

const SENTINEL_BODY = "next-called";

function invokeMiddleware(path: string, cookieHeader?: string): Promise<Response> {
  const context = buildContext({ method: "GET", url: `http://localhost${path}`, cookieHeader });
  // onRequest's MiddlewareHandler type allows `void` for handlers that never call redirect/next
  // themselves; this one always returns one or the other, so casting narrows it back to Response.
  return onRequest(context, () => Promise.resolve(new Response(SENTINEL_BODY, { status: 200 }))) as Promise<Response>;
}

describe("Risk #8 — protected-routes oracle", () => {
  let user: TestUser;
  let cookieHeader: string;

  beforeAll(async () => {
    user = await seedUser();
    cookieHeader = await getAuthCookieHeader(user.email, user.password);
  });

  afterAll(async () => {
    await cleanupUser(user.id);
  });

  it("the filesystem's real page list matches the independently-authored expected list", () => {
    expect(DISCOVERED_ROUTES).toEqual(new Set([...EXPECTED_PROTECTED, ...EXPECTED_PUBLIC]));
  });

  it("signed-out: only real protected pages redirect to /auth/signin; public pages and fabricated near-misses stay reachable", async () => {
    for (const route of DISCOVERED_ROUTES) {
      const response = await invokeMiddleware(route);
      if (EXPECTED_PROTECTED.has(route)) {
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe("/auth/signin");
      } else {
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(SENTINEL_BODY);
      }
    }

    for (const nearMiss of ADVERSARIAL_NEAR_MISSES) {
      const response = await invokeMiddleware(nearMiss);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(SENTINEL_BODY);
    }
  });

  it("signed-in: every real page, including all six protected ones, stays reachable", async () => {
    for (const route of DISCOVERED_ROUTES) {
      const response = await invokeMiddleware(route, cookieHeader);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(SENTINEL_BODY);
    }
  });
});
