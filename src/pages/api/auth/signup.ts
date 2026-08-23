import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isUserAlreadyExists, toGenericAuthError } from "@/lib/auth/errors";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error && !isUserAlreadyExists(error)) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(toGenericAuthError("signup", error))}`);
  }

  // An already-registered address lands here too: the observable response must match a fresh
  // signup, or the redirect target is itself the oracle the generic copy was meant to close.
  // GoTrue validates the password before it looks the address up (verified against the local
  // stack), so a weak-password probe still fails on both branches and distinguishes nothing.
  return context.redirect("/auth/confirm-email");
};
