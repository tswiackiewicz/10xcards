import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    // The auth cookie pair carries both the access and the 400-day refresh token, and
    // nothing in the browser needs to read it — every island talks to /api/*, and the
    // app never instantiates a browser-side Supabase client. `sameSite: "lax"` is a
    // second CSRF defence alongside astro.config.mjs's `checkOrigin` and must stay.
    cookieOptions: {
      httpOnly: true,
      secure: true,
      path: "/",
      sameSite: "lax",
    },
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}
