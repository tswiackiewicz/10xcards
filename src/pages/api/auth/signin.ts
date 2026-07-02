import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  // S-05: a flagged (pending-deletion) account still signs in — the live session is
  // what powers self-service reactivation — but is diverted to /account instead of
  // the app. RLS keeps their data hidden meanwhile, so the diverted session is safe.
  const { data: pending, error: pendingError } = await supabase
    .from("account_deletions")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  // Fail safe: if we can't confirm the account is clean, divert to /account rather
  // than into the app. RLS hides a pending user's data either way, so an over-divert
  // is harmless; an under-divert would drop a pending user into an empty-looking app.
  if (pendingError || pending) {
    return context.redirect("/account");
  }

  return context.redirect("/");
};
