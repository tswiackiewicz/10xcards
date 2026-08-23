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
