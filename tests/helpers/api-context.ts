import type { APIContext } from "astro";

interface BuildContextOptions {
  method: string;
  url: string;
  cookieHeader?: string;
  headers?: Record<string, string>;
  body?: unknown;
  formBody?: Record<string, string>;
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
export function buildContext({
  method,
  url,
  cookieHeader,
  headers: extraHeaders,
  body,
  formBody,
  params,
}: BuildContextOptions): APIContext {
  const headers = new Headers();
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (formBody !== undefined) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }

  const requestBody =
    formBody !== undefined
      ? new URLSearchParams(formBody).toString()
      : body !== undefined
        ? JSON.stringify(body)
        : undefined;

  const context = {
    request: new Request(url, {
      method,
      headers,
      body: requestBody,
    }),
    url: new URL(url),
    cookies: { set: () => undefined },
    params: params ?? {},
    locals: {},
    // Mirrors astro/dist/core/middleware/index.js's redirect(path, status) exactly —
    // signin.ts calls context.redirect(...) and relies on the real 302 default.
    redirect: (path: string, status?: number) =>
      new Response(null, { status: status ?? 302, headers: { Location: path } }),
  };

  return context as unknown as APIContext;
}
