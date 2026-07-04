import type { APIContext } from "astro";

interface BuildContextOptions {
  method: string;
  url: string;
  cookieHeader?: string;
  body?: unknown;
  params?: Record<string, string | undefined>;
}

/**
 * Builds a minimal fake APIContext for invoking a route handler's exported function
 * directly, without booting an Astro/HTTP server. Only `request`, `cookies.set`, and
 * `params` are implemented — the flashcard routes under test never touch anything else
 * on the context. `request` and its `Cookie` header are real Web APIs; `createClient()`
 * (src/lib/supabase.ts) reads sessions from `request.headers.get("Cookie")` and persists
 * refreshes via `cookies.set(...)`, so this is enough to exercise the real handler code,
 * the real @supabase/ssr client, and a real local Supabase instance.
 */
export function buildContext({ method, url, cookieHeader, body, params }: BuildContextOptions): APIContext {
  const headers = new Headers();
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const context = {
    request: new Request(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    cookies: { set: () => undefined },
    params: params ?? {},
    locals: {},
  };

  return context as unknown as APIContext;
}
