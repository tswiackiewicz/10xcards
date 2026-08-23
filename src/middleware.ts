import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/generate", "/create", "/cards", "/study", "/account"];

/**
 * Decorates one outgoing response with the app's security headers.
 *
 * Every path out of the middleware must go through here. The unauthenticated redirect
 * returns before `next()`, so when these were inlined after it that response — six
 * protected routes' worth of signed-out traffic — was the one shipping bare. HSTS is the
 * one that stings: a plain-HTTP first contact with a bookmarked protected path never
 * armed it.
 */
function applySecurityHeaders(source: Response): Response {
  // A Response produced by `Response.redirect()` or returned straight from `fetch()` has
  // immutable headers, and `.set()` on one throws — 500-ing the route rather than failing a
  // header. Nothing in src/ returns such a response today; copying through the constructor is
  // the cheap insurance that keeps that from becoming a landmine for whoever adds the first one.
  const response = new Response(source.body, source);

  // astro.config.mjs's security.csp owns everything Astro will merge — script-src, style-src
  // and the three directives listed there. For a NON-prerendered route Astro ships that policy
  // as a real `content-security-policy` HEADER, not as the <meta http-equiv> element it uses
  // for prerendered pages — every route here is SSR, so it is always the header. Append to it;
  // a plain .set() would silently destroy the hash-based script-src.
  // Not a _headers file: that only covers responses from Cloudflare's asset worker, and
  // every HTML page here is SSR.
  //
  // Only `style-src*` is appended, and only because it is the one family Astro's directive
  // allowlist rejects. Anything Astro *would* accept must be configured there instead: CSP
  // honours the FIRST occurrence of a directive, so an appended copy of a directive Astro
  // also emits is dead code that still reads as protection.
  //
  // The style carve-outs are load-bearing and their cost is real, so state it plainly.
  // Opening the /account delete dialog makes Radix's scroll-lock (react-remove-scroll-bar)
  // inject a <style> ELEMENT at runtime whose text embeds the browser-measured scrollbar
  // width — verified against `astro preview` as a `style-src-elem` / `blockedURI: inline`
  // violation. That width differs per platform, so no build-time hash can cover it, and a
  // hash in `style-src` makes the browser ignore 'unsafe-inline' there.
  // Naming style-src-elem and style-src-attr separately is the only way through; the
  // consequence is that Astro's two style hashes stop being enforced. What is NOT given up:
  // `script-src` stays fully hash-locked with no 'unsafe-inline', which is the half of the
  // policy that turns "an injected script steals the session" into "it is blocked".
  const STYLE_CARVE_OUTS = ["style-src-elem 'self' 'unsafe-inline'", "style-src-attr 'unsafe-inline'"];

  // In a production build Astro attaches a policy to the HTML it renders and to nothing else —
  // API routes and the 404 fallback arrive here bare. Appending the carve-outs to nothing would
  // hand them a policy whose every other directive is unconstrained. Those responses carry JSON
  // or a static error body and never hydrate an island, so they can afford a strict floor.
  //
  // PROD-gated, and that gate is load-bearing rather than cosmetic: `astro dev` emits no CSP at
  // all, so an ungated floor lands on every dev page instead and `default-src 'none'` blocks
  // every script — islands stop hydrating and the whole e2e suite times out on the first
  // `waitForAstroHydration`. Verified both ways against a real dev server. The cost is that the
  // e2e suite, which runs on `astro dev`, can never see this branch; check it on `astro preview`.
  const BASELINE_DIRECTIVES = [
    "default-src 'none'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ];

  const astroCsp = response.headers.get("Content-Security-Policy");
  response.headers.set(
    "Content-Security-Policy",
    [
      ...(astroCsp ? [astroCsp.replace(/;\s*$/, "")] : import.meta.env.PROD ? BASELINE_DIRECTIVES : []),
      ...STYLE_CARVE_OUTS,
    ].join("; "),
  );
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

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
      return applySecurityHeaders(context.redirect("/auth/signin"));
    }
  }

  const response = applySecurityHeaders(await next());

  // locals.user comes from the INCOMING request, so on the sign-in response itself the caller is
  // still anonymous — the one response that actually transmits the token would miss the block
  // below. Nor is `response.headers.has("Set-Cookie")` enough: @supabase/ssr writes the session
  // through `context.cookies.set()`, and Astro only serializes those into a Set-Cookie header
  // AFTER the middleware chain returns, so at this point the header is not there yet. Verified
  // against `astro preview` — a successful POST /api/auth/signin shipped no Cache-Control until
  // this condition read the cookie jar directly. `headers()` is the non-consuming generator
  // (`consume()` is the one that would break the adapter downstream).
  const writesCookie = response.headers.has("Set-Cookie") || !context.cookies.headers().next().done;

  if (context.locals.user || writesCookie) {
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
