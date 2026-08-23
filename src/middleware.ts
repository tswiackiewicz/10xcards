import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/generate", "/create", "/cards", "/study", "/account"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (
    PROTECTED_ROUTES.some((route) => context.url.pathname === route || context.url.pathname.startsWith(`${route}/`))
  ) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  const response = await next();

  // astro.config.mjs's security.csp owns script-src and style-src. For a NON-prerendered
  // route Astro ships that policy as a real `content-security-policy` HEADER, not as the
  // <meta http-equiv> element it uses for prerendered pages — every route here is SSR, so
  // it is always the header. Append to it; a plain .set() would silently destroy the
  // hash-based script-src and leave the app with frame-ancestors and nothing else.
  // frame-ancestors is ours because Astro's CSP never emits it.
  // Not a _headers file: that only covers responses from Cloudflare's asset worker, and
  // every HTML page here is SSR.
  //
  // The style carve-outs are load-bearing and their cost is real, so state it plainly.
  // Opening the /account delete dialog makes Radix's scroll-lock (react-remove-scroll-bar)
  // inject a <style> ELEMENT at runtime whose text embeds the browser-measured scrollbar
  // width — verified against `astro preview` as a `style-src-elem` / `blockedURI: inline`
  // violation. That width differs per platform, so no build-time hash can cover it, and
  // Astro rejects 'unsafe-inline' inside `style-src` itself when hashes are present.
  // Naming style-src-elem and style-src-attr separately is the only way through; the
  // consequence is that Astro's two style hashes stop being enforced. What is NOT given up:
  // `script-src` stays fully hash-locked with no 'unsafe-inline', which is the half of the
  // policy that turns "an injected script steals the session" into "it is blocked".
  const EXTRA_DIRECTIVES = [
    "frame-ancestors 'none'",
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
  ];
  const astroCsp = response.headers.get("Content-Security-Policy");
  response.headers.set(
    "Content-Security-Policy",
    [astroCsp?.replace(/;\s*$/, ""), ...EXTRA_DIRECTIVES].filter(Boolean).join("; "),
  );
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  if (context.locals.user) {
    // @supabase/ssr hands these to setAll's second argument (applyServerStorage in
    // node_modules/@supabase/ssr/dist/main/cookies.js) precisely so an intermediary
    // cannot serve one user's session token to another. src/lib/supabase.ts drops
    // that argument, and this app sits behind Cloudflare — so set them here instead.
    response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
    response.headers.set("Expires", "0");
    response.headers.set("Pragma", "no-cache");
  }

  return response;
});
