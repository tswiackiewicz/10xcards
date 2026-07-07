import { setupServer } from "msw/node";

/**
 * A reusable MSW Node server for mocking an external HTTP provider edge (e.g. OpenRouter).
 * Deliberately NOT wired into vitest.config.ts's global `setupFiles` — its lifecycle must be
 * driven locally (beforeAll/afterEach/afterAll) by the one test file that needs it, with
 * `server.listen({ onUnhandledRequest: "bypass" })`, so it never intercepts other integration
 * tests' real Supabase calls. No default handlers — each test registers its own via
 * `server.use(...)` and resets via `server.resetHandlers()`.
 */
export const server = setupServer();
